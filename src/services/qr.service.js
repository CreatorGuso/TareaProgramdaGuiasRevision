const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SCRIPT = path.join(__dirname, '../../reemplazar-qr/src/index.js');

/**
 * Corre un comando y devuelve su stdout. No falla por código de salida: `zbarimg`
 * devuelve 4 cuando no encuentra ningún código, y eso es un resultado, no un error.
 * @param {string} comando
 * @param {string[]} args
 * @returns {Promise<{salida:string, codigo:number}>}
 */
function correr(comando, args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile(comando, args, { timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code === 'string') {
        reject(new Error(`${comando}: ${error.message}`));
        return;
      }
      resolve({ salida: (stdout || '').trim(), codigo: error ? error.code || 1 : 0, stderr: (stderr || '').trim() });
    });
  });
}

class QrService {
  /**
   * Detecta el QR de un PDF y lo reemplaza por uno nuevo con el contenido indicado.
   * Delega en el proyecto reemplazar-qr/ (requiere pdftoppm / poppler-utils).
   * @param {string} entrada - ruta del PDF original
   * @param {string} contenidoQr - texto/URL del QR nuevo (típicamente el qrUrl del CDR)
   * @param {string} [salida] - ruta del PDF resultante (por defecto <entrada>-qr.pdf)
   * @returns {Promise<string>} ruta del PDF generado
   */
  async reemplazar({ entrada, contenidoQr, salida }) {
    if (!entrada || !contenidoQr) {
      throw new Error('Faltan entrada o contenidoQr para reemplazar el QR');
    }
    if (!fs.existsSync(entrada)) {
      throw new Error(`No existe el PDF de entrada: ${entrada}`);
    }
    const destino = salida || entrada.replace(/\.pdf$/i, '') + '-qr.pdf';

    await new Promise((resolve, reject) => {
      execFile(
        'node',
        [SCRIPT, '--entrada', entrada, '--qr', contenidoQr, '--salida', destino],
        { timeout: 120000, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`reemplazar-qr falló: ${(stderr || stdout || error.message).trim()}`));
            return;
          }
          resolve();
        }
      );
    });

    logger.info(`QR reemplazado en: ${destino}`);
    return destino;
  }

  /**
   * Lee el QR que quedó impreso en un PDF, para comprobar que el reemplazo puso
   * lo que debía. Solo se usa en la prueba de punta a punta (`probar`): rasteriza
   * la página con pdftoppm y la decodifica con zbarimg, así que necesita
   * poppler-utils y zbar-tools, que en producción no hacen falta.
   * @param {string} rutaPdf
   * @param {{pagina?:number, dpi?:number}} [opciones]
   * @returns {Promise<string|null>} el texto del QR, o null si no se pudo leer
   */
  async leerQr(rutaPdf, { pagina = 1, dpi = 200 } = {}) {
    const prefijo = rutaPdf.replace(/\.pdf$/i, '') + '-lectura';
    let imagenes = [];
    try {
      await correr('pdftoppm', [
        '-png',
        '-r', String(dpi),
        '-f', String(pagina),
        '-l', String(pagina),
        rutaPdf,
        prefijo,
      ]);

      const base = path.basename(prefijo);
      imagenes = (await fs.promises.readdir(path.dirname(rutaPdf)))
        .filter((f) => f.startsWith(base) && f.endsWith('.png'))
        .map((f) => path.join(path.dirname(rutaPdf), f));

      for (const imagen of imagenes) {
        // zbarimg sale con código 4 cuando la imagen no tiene código de barras.
        const { salida } = await correr('zbarimg', ['--quiet', '--raw', imagen]);
        if (salida) return salida;
      }
      return null;
    } catch (error) {
      throw new Error(
        `no se pudo leer el QR del PDF (hacen falta pdftoppm y zbarimg): ${error.message}`
      );
    } finally {
      await Promise.all(
        imagenes.map((imagen) => fs.promises.rm(imagen, { force: true }).catch(() => {}))
      );
    }
  }
}

module.exports = new QrService();