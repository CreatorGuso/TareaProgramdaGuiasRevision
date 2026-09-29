const sql = require('mssql');
const config = require('../config');
const logger = require('../utils/logger');

const pools = new Map();

function claveDe(conexion) {
  return `${conexion.NombreServer}|${conexion.NombreBD}|${conexion.usuario}`;
}

/**
 * Obtiene (y cachea) el pool hacia la BD de una empresa, usando la fila de
 * admin.dbo.Conexiones. Cada empresa vive en su propio servidor/BD con sus
 * propias credenciales, así que hay un pool por empresa.
 * @param {{NombreServer:string,NombreBD:string,usuario:string,clave:string,ruc?:string}} conexion
 * @returns {Promise<import('mssql').ConnectionPool>}
 */
async function getErpConnection(conexion) {
  const clave = claveDe(conexion);
  if (pools.has(clave)) return pools.get(clave);

  const server = String(conexion.NombreServer || '').trim();
  const database = String(conexion.NombreBD || '').trim();
  const user = String(conexion.usuario || '').trim();
  const password = String(conexion.clave || '').trim();

  if (!server || !database || !user || !password) {
    throw new Error(
      `Conexión incompleta para ${conexion.ruc || conexion.ID}: ` +
        `server="${server}" bd="${database}" usuario="${user}"`
    );
  }

  const opcionesConexion = {
    server,
    port: config.db.port,
    database,
    user,
    password,
    options: {
      encrypt: config.db.options.encrypt,
      trustServerCertificate: config.db.options.trustServerCertificate,
    },
    connectionTimeout: 30000,
    requestTimeout: 60000,
  };

  // La config va en el constructor: ConnectionPool la clona ahí y connect()
  // sin argumento reutiliza esa copia.
  const pool = new sql.ConnectionPool(opcionesConexion);
  try {
    await pool.connect();
  } catch (error) {
    await pool.close().catch(() => {});
    throw new Error(`No se pudo conectar a ${server}/${database}: ${error.message}`);
  }

  pools.set(clave, pool);
  logger.info(`Conectado a ERP ${conexion.ruc || ''} ${server}/${database}`);
  return pool;
}

/**
 * Cierra el pool de una sola empresa, para no dejar conexiones abiertas al
 * pasar de una empresa a la siguiente.
 * @param {{NombreServer:string,NombreBD:string,usuario:string}} conexion
 */
async function closeErpConnection(conexion) {
  const clave = claveDe(conexion);
  const pool = pools.get(clave);
  if (!pool) return;
  pools.delete(clave);
  try {
    await pool.close();
    logger.info(`Conexión cerrada: ${claveDe(conexion)}`);
  } catch (error) {
    logger.warn(`No se pudo cerrar ${clave}: ${error.message}`);
  }
}

async function closeErpConnections() {
  const errores = [];
  for (const [clave, pool] of pools) {
    try {
      await pool.close();
    } catch (error) {
      errores.push(`${clave}: ${error.message}`);
    }
  }
  pools.clear();
  if (errores.length) logger.warn(`Errores al cerrar pools ERP: ${errores.join('; ')}`);
}

module.exports = { getErpConnection, closeErpConnection, closeErpConnections };
