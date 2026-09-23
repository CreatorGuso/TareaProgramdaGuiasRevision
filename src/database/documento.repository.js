const { getConnection, sql } = require('../database/connection');

class DocumentoRepository {
  /**
   * Lista guías de remisión pendientes (estado=2) o enviadas/en proceso (estado=3), tipo=09
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
          AND idempresa = 1 and fecha_doc > '2026-09-01' and serie_doc = 'TR30' and numero_doc = '00001320'
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
   * Obtiene el detalle completo de una guía usando el stored procedure:
   * exec spmuestracomprobanteguia '01', '01', '030009', 'TR30', '00001186'
   * Cada fila es un item; los datos de cabecera se repiten en todas las filas
   */
  async getDetalleDocumento(idEmpresa, idOficina, idDocumento, serie, nroDoc) {
    const pool = await getConnection();
    const v = (valor) => String(valor ?? '').trim().replaceAll("'", "''");
    const result = await pool.request().query(`
      exec spmuestracomprobanteguia
        '${v(idEmpresa)}',
        '${v(idOficina)}',
        '030009',
        '${v(serie)}',
        '${v(nroDoc)}'
    `);
    return result.recordset;
  }

  /**
   * Actualiza estado del documento después de enviar/consultar a SUNAT
   * estado: char(1) | respuestaSunat: int (código SUNAT 0/98/99) |
   * idSunat: varchar(50) ticket | codErrorSunat: char(4)
   */
  async actualizarEnvio(idDocumento, estado, respuestaSunat, idSunat, codError) {
    const pool = await getConnection();
    await pool.request()
      .input('idDocumento', sql.VarChar(20), idDocumento)
      .input('estado', sql.Char(1), String(estado))
      .input('respuestaSunat', sql.Int, Number(respuestaSunat) || 0)
      .input('idSunat', sql.VarChar(50), idSunat || '')
      .input('fechaSunat', sql.DateTime, new Date())
      .input('codErrorSunat', sql.Char(4), (codError || '').slice(0, 4))
      .query(`
        UPDATE documentos_sve
        SET estado = @estado,
            respuesta_sunat = @respuestaSunat,
            id_sunat = @idSunat,
            fecha_sunat = @fechaSunat,
            coderror_sunat = @codErrorSunat
        WHERE iddocumento = @idDocumento
      `);
  }
}

module.exports = new DocumentoRepository();
