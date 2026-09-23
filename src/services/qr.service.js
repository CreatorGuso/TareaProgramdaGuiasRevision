const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SCRIPT = path.join(__dirname, '../../reemplazar-qr/src/index.js');

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
}

module.exports = new QrService();