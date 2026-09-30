const { getConnection, sql } = require('../database/connection');

const txt = (valor) => String(valor ?? '').trim();

// Tamaño de documentos_sve.codigovalidacion (nvarchar(490) en las 10 BDs con
// Guia = 1, comprobado el 2026-09-30). La URL de descargaqr de SUNAT mide unos
// 190 caracteres, así que entra holgada. Es el límite para no dejar que el propio
// motor de SQL trunque la URL y deje un enlace inservible.
const LARGO_CODIGO_VALIDACION = 490;

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
   * Guarda en `documentos_sve.codigovalidacion` la URL del QR que devolvió SUNAT
   * en el CDR (`cbc:DocumentDescription`, del tipo
   * `https://e-factura.sunat.gob.pe/.../descargaqr?hashqr=...`).
   *
   * Con esto la guía deja de salir de `spPyOValidaGuia`, que solo devuelve las
   * que tienen `len(codigovalidacion) = 0`, así que es a la vez el marcador de
   * "ya procesada" y el enlace que va impreso en el PDF.
   *
   * La columna es `nvarchar(490)` en las 10 bases con `Guia = 1`. Antes era
   * `char(4)` y por eso se escribía una marca de 4 caracteres; ya no es así.
   *
   * @param {import('mssql').ConnectionPool} pool - pool de la BD de la empresa
   * @param {string} idEmpresa
   * @param {string} idDocumento
   * @param {string} qrUrl - URL del QR, tal cual viene en el CDR
   * @returns {Promise<number>} filas actualizadas
   */
  async guardarQrUrl(pool, idEmpresa, idDocumento, qrUrl) {
    const url = txt(qrUrl);
    if (!url) {
      throw new Error(
        `se intentó marcar ${idEmpresa}/${idDocumento} sin la URL del QR del CDR`
      );
    }
    // Mejor fallar acá que dejar que SQL Server corte la URL: una URL truncada
    // marcaría la guía como procesada y dejaría un enlace que no abre nada.
    if (url.length > LARGO_CODIGO_VALIDACION) {
      throw new Error(
        `la URL del QR de ${idEmpresa}/${idDocumento} mide ${url.length} caracteres ` +
          `y codigovalidacion admite ${LARGO_CODIGO_VALIDACION}: hay que ampliar la columna`
      );
    }

    const resultado = await pool.request()
      .input('idempresa', sql.Char(2), String(idEmpresa))
      .input('iddocumento', sql.Char(12), String(idDocumento))
      .input('qrurl', sql.NVarChar(LARGO_CODIGO_VALIDACION), url)
      .query(`
        UPDATE documentos_sve
        SET codigovalidacion = @qrurl
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
