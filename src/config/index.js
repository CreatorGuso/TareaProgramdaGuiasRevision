const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  db: {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT) || 1433,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
    },
  },

  sunat: {
    clientId: process.env.SUNAT_CLIENT_ID,
    clientSecret: process.env.SUNAT_CLIENT_SECRET,
    ruc: process.env.SUNAT_RUC,
    usuarioSol: process.env.SUNAT_USUARIO_SOL,
    claveSol: process.env.SUNAT_CLAVE_SOL,
    apiBase: 'https://api-cpe.sunat.gob.pe/v1',
    seguridadBase: 'https://api-seguridad.sunat.gob.pe/v1',
    scope: 'https://api-cpe.sunat.gob.pe',
  },

  certificates: {
    dir: process.env.CERTIFICATES_DIR || './certificates',
  },

  cdr: {
    dir: process.env.CDR_DIR || path.join(__dirname, '../../CDR'),
  },

  drive: {
    credenciales: path.join(__dirname, '../../proyectoalmacenamientowhatsapp-5798b0480329.json'),
    folderIdFile: path.join(__dirname, '../../driveid.txt'),
  },
};
