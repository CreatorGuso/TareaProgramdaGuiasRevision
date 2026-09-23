const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');

class DriveService {
  constructor() {
    this.credencialesPath = config.drive.credenciales;
    this.folderId = this.leerFolderId();
    this.drive = null;
  }

  leerFolderId() {
    try {
      const contenido = fs.readFileSync(config.drive.folderIdFile, 'utf8').trim();
      if (!contenido) throw new Error('archivo vacío');
      return contenido;
    } catch (error) {
      throw new Error(
        `No se pudo leer el id de la carpeta de Drive (${config.drive.folderIdFile}): ${error.message}`
      );
    }
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
   * Lista archivos de la carpeta compartida (id en driveid.txt)
   * @param {string} [filtroNombre] - texto que debe contener el nombre (opcional)
   */
  async listar(filtroNombre = '') {
    const drive = await this.autenticar();

    const q = `'${this.folderId}' in parents and trashed = false`;
    const nombreQ = filtroNombre
      ? ` and name contains '${filtroNombre.replace(/'/g, "\\'")}'`
      : '';

    const response = await drive.files.list({
      q: `${q}${nombreQ}`,
      pageSize: 1000,
      fields: 'files(id, name, mimeType, size, modifiedTime)',
      orderBy: 'name',
    });

    return response.data.files || [];
  }

  /**
   * Busca un archivo por nombre exacto dentro de la carpeta
   */
  async buscarPorNombre(nombre) {
    const drive = await this.autenticar();
    const response = await drive.files.list({
      q: `'${this.folderId}' in parents and trashed = false and name = '${nombre.replace(/'/g, "\\'")}'`,
      pageSize: 10,
      fields: 'files(id, name, mimeType, size, modifiedTime)',
    });
    return (response.data.files || [])[0] || null;
  }

  /**
   * Busca archivos cuyo nombre contenga el texto
   */
  async buscarContiene(texto) {
    const drive = await this.autenticar();
    const response = await drive.files.list({
      q: `'${this.folderId}' in parents and trashed = false and name contains '${texto.replace(/'/g, "\\'")}'`,
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
   * Sube un archivo local a la carpeta de Drive. No borra nada (la cuenta de
   * Drive no tiene permisos de borrado por ahora).
   * @param {string} rutaLocal - ruta del archivo local
   * @param {string} nombre - nombre con el que se guardará en Drive
   */
  async subir(rutaLocal, nombre) {
    const drive = await this.autenticar();
    const mimeType = /\.pdf$/i.test(nombre)
      ? 'application/pdf'
      : /\.xml$/i.test(nombre)
        ? 'application/xml'
        : 'application/octet-stream';

    const response = await drive.files.create({
      requestBody: { name: nombre, parents: [this.folderId] },
      media: { mimeType, body: fs.createReadStream(rutaLocal) },
      fields: 'id, name, size',
    });
    logger.info(`Subido a Drive: ${nombre} [${response.data.id}]`);
    return response.data;
  }
}

module.exports = new DriveService();