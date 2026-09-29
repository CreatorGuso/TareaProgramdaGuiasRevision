const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class SunatAuthService {
  constructor() {
    this.tokens = new Map();
  }

  claveDe(credenciales) {
    return `${credenciales.clientId}|${credenciales.ruc}`;
  }

  /**
   * Obtiene token OAuth2 de SUNAT (flujo password grant) para una empresa.
   * El token se cachea por empresa (clientId + ruc) porque cada una tiene su
   * propio par de credenciales.
   * POST https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/
   * @param {{clientId:string,clientSecret:string,ruc:string,usuarioSol:string,claveSol:string}} credenciales
   * @returns {Promise<string>}
   */
  async getToken(credenciales) {
    const { clientId, clientSecret, ruc, usuarioSol, claveSol } = credenciales;
    if (!clientId || !clientSecret || !ruc || !usuarioSol || !claveSol) {
      throw new Error(
        `Faltan credenciales SUNAT del RUC ${ruc || '(sin ruc)'} ` +
          '(clientId, clientSecret, ruc, usuarioSol, claveSol)'
      );
    }

    const clave = this.claveDe(credenciales);
    const cached = this.tokens.get(clave);
    if (cached && Date.now() < cached.expira) return cached.token;

    const username = `${ruc}${usuarioSol}`;
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('scope', config.sunat.scope);
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      params.append('username', username);
      params.append('password', claveSol);

      const response = await axios.post(
        `${config.sunat.seguridadBase}/clientessol/${clientId}/oauth2/token/`,
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          // Sin timeout, si api-seguridad.sunat.gob.pe se cuelga la corrida queda
          // esperando para siempre y no pasa a la siguiente empresa.
          timeout: 30000,
        }
      );

      // Expira 5 min antes del tiempo real
      const expira = Date.now() + (Number(response.data.expires_in) - 300) * 1000;
      this.tokens.set(clave, { token: response.data.access_token, expira });

      logger.info(`Token SUNAT obtenido para el RUC ${ruc}`);
      return response.data.access_token;
    } catch (error) {
      this.tokens.delete(clave);
      if (error.response) {
        logger.error(
          `Error al obtener token SUNAT del RUC ${ruc} [${error.response.status}]: ` +
            JSON.stringify(error.response.data)
        );
        throw new Error(
          `Error SUNAT Auth ${error.response.status} (RUC ${ruc}): ` +
            JSON.stringify(error.response.data)
        );
      }
      logger.error(`Error al obtener token SUNAT del RUC ${ruc}:`, error.message);
      throw error;
    }
  }
}

module.exports = new SunatAuthService();
