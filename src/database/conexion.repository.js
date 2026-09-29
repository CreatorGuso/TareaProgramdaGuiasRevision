const { getConnection, sql } = require('../database/connection');
const logger = require('../utils/logger');

// La columna Estado que devuelve spPyOValidaGuia NO es el estado del documento:
// es una clasificación que hace el SP.
//   Estado 1 -> el ERP lo tiene en estado 2/3: emitido, aún NO aceptado por SUNAT.
//               Esos los sube a SUNAT el ERP; acá no se tocan.
//   Estado 2 -> el ERP lo tiene en estado 6 y validado = 1: ya aceptado por
//               SUNAT, solo falta reemplazar el QR. Estos son los que procesamos.
const ESTADO_QR_PENDIENTE = 2;

class ConexionRepository {
  /**
   * Lista las conexiones de admin que emiten guías remisiones (Conexiones.Guia = 1)
   */
  async getConGuias() {
    const pool = await getConnection();
    const result = await pool.request()
      .query('SELECT * FROM Conexiones WHERE Guia = 1 ORDER BY id');
    return result.recordset;
  }

  /**
   * Obtiene una conexión por su id (el ID que devuelve spPyOValidaGuia)
   */
  async getPorId(id) {
    const pool = await getConnection();
    const result = await pool.request()
      .input('id', sql.Int, Number(id))
      .query('SELECT * FROM Conexiones WHERE id = @id');
    return result.recordset[0] || null;
  }

  /**
   * Guías de remisión pendientes de reemplazar el QR, en todas las empresas.
   * El SP recorre internamente las conexiones con Guia = 1 y devuelve una fila
   * por documento: ID (conexión), idEmpresa, idDocumento, Estado.
   *
   * OJO: este es el ÚNICO punto del código que necesita el SP, y por lo tanto el
   * único que necesita un usuario con permiso EXECUTE sobre él. Se usa solo desde
   * el comando `exportar`; el resto del flujo trabaja contra el archivo que ese
   * comando deja (ver `services/pendientes.service.js`).
   *
   * @param {{incluirTodos?:boolean}} [opciones] - con `incluirTodos` no filtra
   *        por Estado, para guardar también las de Estado 1.
   * @returns {Promise<Array<{ID:number,idEmpresa:string,idDocumento:string,Estado:number}>>}
   */
  async getGuiasPorValidar({ incluirTodos = false } = {}) {
    const pool = await getConnection();
    let todas;
    try {
      todas = (await pool.request().query('exec spPyOValidaGuia')).recordset;
    } catch (error) {
      // SQL Server reporta 229 (permiso denegado) también cuando el procedimiento
      // no le es visible al usuario, así que no se puede distinguir por el código.
      throw new Error(
        `No se pudo ejecutar spPyOValidaGuia en la BD central (${pool.config.database}). ` +
          `O no existe, o al usuario de conexión (${pool.config.user}) le falta permiso. ` +
          `Verificar con: SELECT OBJECT_ID('spPyOValidaGuia') -- debe devolver un id, no NULL. ` +
          `Si existe, falta: GRANT EXECUTE ON dbo.spPyOValidaGuia TO <usuario>. ` +
          `Detalle: ${error.message}`
      );
    }

    const filtradas = incluirTodos
      ? todas
      : todas.filter((f) => Number(f.Estado) === ESTADO_QR_PENDIENTE);
    logger.info(
      `spPyOValidaGuia: ${filtradas.length} guía(s)${incluirTodos ? '' : ` con Estado=${ESTADO_QR_PENDIENTE}`} ` +
        `de ${todas.length} (las de Estado 1 las sube el ERP a SUNAT)`
    );
    return filtradas;
  }
}

module.exports = new ConexionRepository();
