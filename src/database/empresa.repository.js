const { sql } = require('../database/connection');

class EmpresaRepository {
  /**
   * Credenciales de SUNAT de una empresa, tomadas de v_empresas de SU propia BD.
   * El mapeo es el que usa el ERP:
   *   ruc                    -> RUC emisor
   *   usuariosol/clavesol    -> credenciales SOL (password grant de OAuth2)
   *   nomcertificadojks      -> client_id de la API GRE
   *   clacertificadojks      -> client_secret de la API GRE
   * @param {import('mssql').ConnectionPool} pool - pool de la BD de la empresa
   * @param {string} idEmpresa
   * @returns {Promise<{ruc:string,usuarioSol:string,claveSol:string,clientId:string,clientSecret:string}>}
   */
  async getCredencialesSunat(pool, idEmpresa) {
    const result = await pool.request()
      .input('idempresa', sql.Char(2), String(idEmpresa))
      .query(`
        SELECT ruc, usuariosol, clavesol, nomcertificadojks, clacertificadojks
        FROM v_empresas
        WHERE idempresa = @idempresa
      `);

    const empresa = result.recordset[0];
    if (!empresa) {
      throw new Error(`No se encontró la empresa '${idEmpresa}' en v_empresas`);
    }

    const credenciales = {
      ruc: String(empresa.ruc || '').trim(),
      usuarioSol: String(empresa.usuariosol || '').trim(),
      claveSol: String(empresa.clavesol || '').trim(),
      clientId: String(empresa.nomcertificadojks || '').trim(),
      clientSecret: String(empresa.clacertificadojks || '').trim(),
    };

    const faltantes = Object.entries(credenciales)
      .filter(([, valor]) => !valor)
      .map(([campo]) => campo);
    if (faltantes.length) {
      throw new Error(
        `v_empresas de '${idEmpresa}' (${credenciales.ruc}) ` +
          `incompleta: faltan ${faltantes.join(', ')}`
      );
    }

    return credenciales;
  }
}

module.exports = new EmpresaRepository();
