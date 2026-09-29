const { getConnection, sql } = require('../database/connection');

const txt = (valor) => String(valor ?? '').trim();

// Valor que se deja en documentos_sve.codigovalidacion (CHAR(4)) para marcar que
// el QR de esa guía ya fue reemplazado por el de SUNAT. Es lo único que importa:
// spPyOValidaGuia deja de devolver la guía cuando len(codigovalidacion) > 0.
// Si en su ERP usan otra convención, se cambia acá y nada más.
const MARCA_QR = 'QR  ';

class DocumentoRepository {
  /**
   * Lista guías de remisión de una empresa (solo para depuración; el flujo
   * normal usa spPyOValidaGuia).
   */
  async getGuiasPendientes(idEmpresa) {
    const pool = await getConnection();
    const result = await pool.request()
      .input('idEmpresa', sql.VarChar(10), String(idEmpresa))
      .query(`
        SELECT *
        FROM documentos_sve
        WHERE estado = 6
          AND idtipo = '09'
          AND idempresa = @idEmpresa
        ORDER BY fecha_doc DESC
      `);
    return result.recordset;
  }

  /**
   * Busca un documento por su ticket de SUNAT (id_sunat)
   */
  async getByTicket(ticket) {
    const pool = await getConnection();
    const result = await pool.request()
      .input('ticket', sql.VarChar(100), String(ticket))
      .query(`
        SELECT TOP 1 *
        FROM documentos_sve
        WHERE id_sunat = @ticket AND idtipo = '09'
        ORDER BY fecha_sunat DESC
      `);
    return result.recordset[0] || null;
  }

  /**
   * Lee el documento (fila de documentos_sve) en la BD de la empresa.
   * @param {import('mssql').ConnectionPool} pool - pool de la BD de la empresa
   * @param {string} idEmpresa
   * @param {string} idDocumento
   */
  async getPorIdDocumento(pool, idEmpresa, idDocumento) {
    const result = await pool.request()
      .input('idempresa', sql.Char(2), String(idEmpresa))
      .input('iddocumento', sql.Char(12), String(idDocumento))
      .query(`
        SELECT TOP 1 *
        FROM documentos_sve
        WHERE idempresa = @idempresa
          AND iddocumento = @iddocumento
          AND idtipo = '09'
      `);
    return result.recordset[0] || null;
  }

  /**
   * Marca la guía como having el QR reemplazado.
   *
   * OJO: aquí NO se guarda la URL del QR. La columna `codigovalidacion` de
   * `documentos_sve` es CHAR(4) —no cabe una URL de SUNAT, que mide unos 250
   * caracteres— y para las guías (idtipo '09') el ERP no la usa: siempre está
   * vacía. Lo que hace es de marcador: spPyOValidaGuia pide las guías con
   * `len(codigovalidacion) = 0`, así que con ponerle cualquier valor no vacío la
   * guía deja de salir del listado y no se vuelve a procesar.
   *
   * Se usa CHAR(4) con un valor corto y fijo en vez de la URL a propósito: una
   * URL recortada a 4 caracteres dejaría el PDF con un QR inservible.
   *
   * @param {import('mssql').ConnectionPool} pool - pool de la BD de la empresa
   * @param {string} idEmpresa
   * @param {string} idDocumento
   * @param {string} [marca] - valor a dejar en codigovalidacion (4 caracteres)
   * @returns {Promise<number>} filas actualizadas
   */
  async marcarQrReemplazado(pool, idEmpresa, idDocumento, marca = MARCA_QR) {
    const resultado = await pool.request()
      .input('idempresa', sql.Char(2), String(idEmpresa))
      .input('iddocumento', sql.Char(12), String(idDocumento))
      .input('marca', sql.Char(4), String(marca).slice(0, 4))
      .query(`
        UPDATE documentos_sve
        SET codigovalidacion = @marca
        WHERE idempresa = @idempresa
          AND iddocumento = @iddocumento
          AND idtipo = '09'
      `);
    return resultado.rowsAffected.reduce((total, f) => total + f, 0);
  }

  /**
   * Detalle completo de una guía, vía stored procedure de la BD de la empresa:
   *   exec spMuestraComprobanteGuia '<idempresa>','<idoficina>','<idtipo>','<serie>','<nro>'
   * Cada fila es un ítem; los datos de cabecera se repiten en todas.
   * @param {import('mssql').ConnectionPool} pool - pool de la BD de la empresa
   */
  async getDetalleDocumento(pool, idEmpresa, idOficina, idTipo, serie, nroDoc) {
    const v = (valor) => String(valor ?? '').trim().replaceAll("'", "''");
    const result = await pool.request().query(`
      exec spMuestraComprobanteGuia
        '${v(idEmpresa)}',
        '${v(idOficina)}',
        '${v(idTipo)}',
        '${v(serie)}',
        '${v(nroDoc)}'
    `);
    return result.recordset;
  }
}

module.exports = new DocumentoRepository();
