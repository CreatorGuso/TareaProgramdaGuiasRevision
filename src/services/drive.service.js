const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');

class DriveService {
  constructor() {
    this.credencialesPath = config.drive.credenciales;
    this.drive = null;
  }

  /**
   * Valida el id de carpeta. No hay una carpeta por defecto: la de cada guía la
   * trae spPyOValidaGuia en la columna DriveID, y varias empresas pueden tener
   * la misma. Sin esto, un DriveID vacío armaría una consulta contra la carpeta
   * 'undefined' y el error de Google no diría de dónde salió.
   * @param {string} folderId
   * @returns {string}
   */
  carpeta(folderId) {
    const id = String(folderId ?? '').trim();
    if (!id) throw new Error('la guía no trae DriveID (id de la carpeta de Drive)');
    return id;
  }

  async autenticar() {
    if (this.drive) return this.drive;

    const credenciales = JSON.parse(fs.readFileSync(this.credencialesPath, 'utf8'));
    const auth = new google.auth.JWT({
      email: credenciales.client_email,
      key: credenciales.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    await auth.authorize();

    this.drive = google.drive({ version: 'v3', auth });
    logger.info('Conectado a Google Drive (service account)');
    return this.drive;
  }

  /**
   * Lista archivos de una carpeta. Recorre todas las páginas: las carpetas de
   * estas empresas tienen miles de archivos y la API devuelve 1000 por llamada,
   * así que sin paginar el listado parecería completo cuando no lo está (y se
   * concluiría que a un PDF le falta su CDR cuando en realidad está en la
   * página 2).
   * @param {string} folderId - id de la carpeta (DriveID de la guía)
   * @param {string} [filtroNombre] - texto que debe contener el nombre (opcional)
   */
  async listar(folderId, filtroNombre = '') {
    const drive = await this.autenticar();

    const q = `'${this.carpeta(folderId)}' in parents and trashed = false`;
    const nombreQ = filtroNombre
      ? ` and name contains '${filtroNombre.replace(/'/g, "\\'")}'`
      : '';

    const archivos = [];
    let pageToken;
    do {
      const response = await drive.files.list({
        q: `${q}${nombreQ}`,
        pageSize: 1000,
        pageToken,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
        orderBy: 'name',
      });
      archivos.push(...(response.data.files || []));
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return archivos;
  }

  /**
   * Busca un archivo por nombre exacto dentro de la carpeta
   * @param {string} nombre
   * @param {string} folderId - id de la carpeta (DriveID de la guía)
   */
  async buscarPorNombre(nombre, folderId) {
    const drive = await this.autenticar();
    const response = await drive.files.list({
      q: `'${this.carpeta(folderId)}' in parents and trashed = false and name = '${nombre.replace(/'/g, "\\'")}'`,
      pageSize: 10,
      fields: 'files(id, name, mimeType, size, modifiedTime)',
    });
    return (response.data.files || [])[0] || null;
  }

  /**
   * Busca archivos cuyo nombre contenga el texto
   * @param {string} texto
   * @param {string} folderId - id de la carpeta (DriveID de la guía)
   */
  async buscarContiene(texto, folderId) {
    const drive = await this.autenticar();
    const response = await drive.files.list({
      q: `'${this.carpeta(folderId)}' in parents and trashed = false and name contains '${texto.replace(/'/g, "\\'")}'`,
      pageSize: 10,
      fields: 'files(id, name, mimeType, size, modifiedTime)',
    });
    const archivos = response.data.files || [];
    return archivos.length === 1 ? archivos[0] : archivos;
  }

  /**
   * Descarga el contenido de un archivo de Drive
   * @param {string} fileId - id del archivo
   * @param {string} destino - ruta local donde guardar
   */
  async descargar(fileId, destino) {
    const drive = await this.autenticar();
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    await fs.promises.writeFile(destino, Buffer.from(response.data));
    return destino;
  }

  /**
   * Elimina un archivo de la carpeta
   * @param {string} fileId - id del archivo a eliminar
   */
  async eliminar(fileId) {
    const drive = await this.autenticar();
    await drive.files.delete({ fileId });
    logger.info(`Eliminado de Drive [${fileId}]`);
  }

  /**
   * Traduce un error de la API de Google Drive a una causa conocida. Sirve para
   * distinguir "este PDF no está" de "no puedo ver la carpeta": lo primero se
   * reintenta en la próxima corrida, lo segundo hay que avisarlo una sola vez.
   * @param {any} error
   * @returns {{tipo:'no-existe'|'sin-permisos'|'transitorio'|'otro', mensaje:string}}
   */
  clasificarError(error) {
    const status =
      (error.response && error.response.status) ||
      error.code ||
      error.status ||
      null;
    const texto = String(error.message || error);
    const bajo = texto.toLowerCase();

    if (status === 404 || /not found|no such file|file not found/.test(bajo)) {
      return { tipo: 'no-existe', mensaje: 'el archivo o la carpeta no existe o no es visible' };
    }
    if (
      status === 401 ||
      status === 403 ||
      /insufficient permissions|sufficient permissions|forbidden|not authorized|unauthorized|cannot access|access denied|permission/.test(
        bajo
      )
    ) {
      return { tipo: 'sin-permisos', mensaje: `sin permisos de acceso (HTTP ${status ?? '?'})` };
    }
    if (status === 429 || status >= 500) {
      return { tipo: 'transitorio', mensaje: `servicio de Drive no disponible (HTTP ${status})` };
    }
    return { tipo: 'otro', mensaje: texto.trim() };
  }

  /**
   * Ejecuta una operación de Drive y, si falla por que el archivo no existe o no
   * hay permisos, devuelve `null` en vez de propagar el error. El llamador lo
   * trata como "documento omitido" y sigue con el siguiente.
   * @param {() => Promise<any>} operacion
   * @param {{porDefecto?:any}} [opciones]
   */
  async tolerante(operacion, opciones = {}) {
    try {
      return await operacion();
    } catch (error) {
      const clasificado = this.clasificarError(error);
      if (clasificado.tipo === 'no-existe' || clasificado.tipo === 'sin-permisos') return opciones.porDefecto ?? null;
      throw error;
    }
  }

  /**
   * Sube o actualiza un archivo en la carpeta de la guía. Si ya existe uno con
   * el mismo nombre lo reemplaza con files.update (permite editar sin ser
   * propietario); si no existe lo crea. No borra nada.
   * @param {string} rutaLocal - ruta del archivo local
   * @param {string} nombre - nombre con el que se guardará en Drive
   * @param {string} folderId - id de la carpeta (DriveID de la guía)
   */
  async subir(rutaLocal, nombre, folderId) {
    const drive = await this.autenticar();
    const carpetaId = this.carpeta(folderId);
    const mimeType = /\.pdf$/i.test(nombre)
      ? 'application/pdf'
      : /\.xml$/i.test(nombre)
        ? 'application/xml'
        : 'application/octet-stream';
    const media = { mimeType, body: fs.createReadStream(rutaLocal) };

    const existente = await this.buscarPorNombre(nombre, carpetaId);
    if (existente) {
      const response = await drive.files.update({
        fileId: existente.id,
        media,
        fields: 'id, name, size',
      });
      logger.info(`Actualizado en Drive: ${nombre} [${response.data.id}]`);
      return response.data;
    }

    const response = await drive.files.create({
      requestBody: { name: nombre, parents: [carpetaId] },
      media,
      fields: 'id, name, size',
    });
    logger.info(`Subido a Drive: ${nombre} [${response.data.id}]`);
    return response.data;
  }
}

module.exports = new DriveService();