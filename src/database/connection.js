const sql = require('mssql');
const config = require('../config');

let pool = null;

async function getConnection() {
  if (!pool) {
    pool = await sql.connect(config.db);
  }
  return pool;
}

async function closeConnection() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

module.exports = { sql, getConnection, closeConnection };
