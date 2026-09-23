const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const ZipService = require('./zip.service');
const config = require('../config');
const logger = require('../utils/logger');

class CdrService {
  constructor() {
    this.zipService = new ZipService();
    this.dir = config.cdr.dir;
  }

  /**
   * Procesa el CDR devuelto por SUNAT (ZIP en base64):
   * descomprime, guarda el XML temporalmente y extrae la URL del QR.
   * @param {string} arcCdrBase64 - ZIP del CDR en base64 (arcCdr)
   * @param {string} ticket - Ticket de SUNAT (fallback para el nombre)
   * @returns {Promise<{ qrUrl: string|null, archivo: string|null, ruta: string|null }>}
   */
  async procesar(arcCdrBase64, ticket) {
    if (!arcCdrBase64) return { qrUrl: null, archivo: null, ruta: null };

    const zipBuffer = Buffer.from(arcCdrBase64, 'base64');
    const files = await this.zipService.decompress(zipBuffer);
    const cdr = files.find((f) => f.nombre.toLowerCase().endsWith('.xml')) || files[0];

    if (!cdr) return { qrUrl: null, archivo: null, ruta: null };

    const archivo = cdr.nombre || `${ticket || 'cdr'}.xml`;
    const ruta = path.join(this.dir, archivo);
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.writeFile(ruta, cdr.contenido, 'utf8');

    const qrUrl = this.extraerQrUrl(cdr.contenido);

    return { qrUrl, archivo, ruta };
  }

  /**
   * Extrae la URL del QR desde el ApplicationResponse del CDR:
   * cac:DocumentResponse/cac:DocumentReference/cbc:DocumentDescription
   * @param {string} xml
   * @returns {string|null}
   */
  extraerQrUrl(xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const nodos = doc.getElementsByTagName('cbc:DocumentDescription');
      for (let i = 0; i < nodos.length; i++) {
        const valor = (nodos[i].textContent || '').trim();
        if (valor.startsWith('http')) return valor;
      }
    } catch (error) {
      logger.warn(`No se pudo parsear el CDR para extraer el QR: ${error.message}`);
    }
    return null;
  }
}

module.exports = new CdrService();
