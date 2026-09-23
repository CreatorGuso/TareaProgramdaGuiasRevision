const JSZip = require('jszip');

class ZipService {
  /**
   * Descomprime un ZIP de respuesta CDR
   * @param {Buffer} zipBuffer
   * @returns {Promise<Object>} { nombre, contenido }
   */
  async decompress(zipBuffer) {
    const zip = await JSZip.loadAsync(zipBuffer);
    const files = [];

    for (const [nombre, file] of Object.entries(zip.files)) {
      if (!file.dir) {
        const contenido = await file.async('string');
        files.push({ nombre, contenido });
      }
    }

    return files;
  }
}

module.exports = ZipService;
