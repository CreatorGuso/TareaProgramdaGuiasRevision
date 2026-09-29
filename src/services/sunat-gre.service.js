const axios = require('axios');
const config = require('../config');
const sunatAuth = require('./sunat-auth.service');
const cdrService = require('./cdr.service');
const logger = require('../utils/logger');

class SunatGreService {
  /**
   * Consulta estado de una GRE enviada
   * GET https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes/envios/{numTicket}
   * codRespuesta: "98" en proceso, "99" con error, "0" aceptado
   * @param {string} ticket
   * @param {{clientId:string,clientSecret:string,ruc:string,usuarioSol:string,claveSol:string}} credenciales
   * @returns {Promise<Object>}
   */
  async consultarEstado(ticket, credenciales) {
    const token = await sunatAuth.getToken(credenciales);

    const response = await axios.get(
      `${config.sunat.apiBase}/contribuyente/gem/comprobantes/envios/${ticket}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
        timeout: 30000,
      }
    );

    const data = response.data;

    // Si SUNAT devolvió CDR, guardarlo temporalmente y extraer la URL del QR
    let qrUrl = null;
    let rutaCdr = null;
    if (data.arcCdr) {
      try {
        const cdr = await cdrService.procesar(data.arcCdr, ticket);
        qrUrl = cdr.qrUrl;
        if (cdr.ruta) {
          rutaCdr = cdr.ruta;
          logger.info(`CDR guardado: ${cdr.ruta}`);
        }
        if (qrUrl) {
          logger.info(`URL QR del CDR: ${qrUrl}`);
        } else {
          logger.warn(`No se encontró URL de QR en el CDR del ticket ${ticket}`);
        }
      } catch (error) {
        logger.warn(`No se pudo procesar el CDR del ticket ${ticket}: ${error.message}`);
      }
    }

    const resultado = {
      estado: data.codRespuesta,
      descripcion:
        data.codRespuesta === '0'
          ? 'Aceptado por SUNAT'
          : data.codRespuesta === '98'
            ? 'En proceso'
            : (data.error && data.error.desError) || 'Envío con error',
      numError: (data.error && data.error.numError) || null,
      cdr: data.arcCdr || null,
      rutaCdr,
      qrUrl,
      indCdrGenerado: data.indCdrGenerado || null,
      ticket,
    };

    if (data.codRespuesta === '99') {
      logger.error(
        `GRE rechazada. RUC ${credenciales.ruc} ticket ${ticket}: ` +
          `${resultado.numError} - ${resultado.descripcion}`
      );
    }

    return resultado;
  }

  /**
   * Comprueba que la URL del QR sacada del CDR siga respondiendo. Es una
   * lectura, no una escritura: solo informa. Ojo: `descargaqr` devuelve un PDF,
   * no la imagen del QR (ese lo dibuja localmente reemplazar-qr).
   * @param {string} qrUrl
   * @returns {Promise<{ok:boolean, estado:number|null, bytes:number, tipo:string|null, error?:string}>}
   */
  async verificarQrUrl(qrUrl) {
    try {
      const response = await axios.get(qrUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      return {
        ok: response.status === 200,
        estado: response.status,
        bytes: Buffer.from(response.data).length,
        tipo: response.headers['content-type'] || null,
      };
    } catch (error) {
      return {
        ok: false,
        estado: error.response ? error.response.status : null,
        bytes: 0,
        tipo: null,
        error: error.message,
      };
    }
  }
}

module.exports = new SunatGreService();
