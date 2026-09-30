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

  // Credenciales SUNAT: NO van aquí, son por empresa y se leen de v_empresas
  // (ruc, usuariosol, clavesol, nomcertificadojks=clientId, clacertificadojks=clientSecret).
  // Solo las URLs, que son comunes a todos.
  sunat: {
    apiBase: 'https://api-cpe.sunat.gob.pe/v1',
    seguridadBase: 'https://api-seguridad.sunat.gob.pe/v1',
    scope: 'https://api-cpe.sunat.gob.pe',
  },

  // El resultado de spPyOValidaGuia se guarda en este archivo. El SP solo
  // existe en la BD central (admin) y su permiso EXECUTE no es heredable, así
  // que se ejecuta UNA vez (comando `exportar`) y después la app trabaja contra
  // este archivo, moviéndose sola entre las BD de cada empresa.
  pendientes: {
    archivo: process.env.PENDIENTES_ARCHIVO || path.join(__dirname, '../../guias-pendientes.json'),
  },

  // Los CDR se descargan de SUNAT, se suben a Drive con el nombre del PDF y se
  // borran: la carpeta queda limpia al terminar la corrida.
  cdr: {
    dir: process.env.CDR_DIR || path.join(__dirname, '../../CDR'),
  },

  // La carpeta de Drive YA NO es una sola: spPyOValidaGuia devuelve el id de la
  // carpeta de cada guía en la columna DriveID, y es esa la que se usa. Esta
  // cuenta de servicio es la que tiene acceso a esas carpetas.
  drive: {
    credenciales: path.join(__dirname, '../../driveenviopdf-7a4b8936208f.json'),
  },

  // Binarios del sistema. En la tarea programada de Windows el PATH heredado no
  // trae poppler, así que `pdftoppm` a secas no se encuentra y reemplazar-qr
  // falla con `spawnSync pdftoppm ENOENT`. Con PDFTOPPM en el .env se le pasa la
  // ruta absoluta y deja de importar el PATH.
  // pdftoppm hace falta SIEMPRE, también en producción: es lo que rasteriza el PDF
  // para detectar el QR. zbarimg solo se usa en el comando `probar`.
  herramientas: {
    pdftoppm: process.env.PDFTOPPM || 'pdftoppm',
    zbarimg: process.env.ZBARIMG || 'zbarimg',
  },
};
