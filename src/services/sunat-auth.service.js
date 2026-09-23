const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class SunatAuthService {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
  }

  /**
   * Obtiene token OAuth2 de SUNAT (flujo password grant)
   * POST https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/
   */
  async getToken(clientId, clientSecret) {
    const id = clientId || config.sunat.clientId;
    const secret = clientSecret || config.sunat.clientSecret;
    const username = `${config.sunat.ruc}${config.sunat.usuarioSol}`;
    const password = config.sunat.claveSol;

    if (!id || !secret || !username || !password) {
      throw new Error('Faltan credenciales SUNAT (client_id, client_secret, usuario_sol, clave_sol)');
    }

    // Verificar si el token sigue vigente
    if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('scope', config.sunat.scope);
      params.append('client_id', id);
      params.append('client_secret', secret);
      params.append('username', username);
      params.append('password', password);

      const response = await axios.post(
        `${config.sunat.seguridadBase}/clientessol/${id}/oauth2/token/`,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      this.token = response.data.access_token;
      // Expira 5 min antes del tiempo real
      this.tokenExpiry = Date.now() + ((response.data.expires_in - 300) * 1000);

      logger.info('Token SUNAT obtenido correctamente');
      return this.token;
    } catch (error) {
      if (error.response) {
        logger.error(`Error al obtener token SUNAT [${error.response.status}]: ${JSON.stringify(error.response.data)}`);
        throw new Error(`Error SUNAT Auth ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      }
      logger.error('Error al obtener token SUNAT:', error.message);
      throw error;
    }
  }
}

module.exports = new SunatAuthService();
