const fs = require('fs');
const path = require('path');
const config = require('../config');
const conexionRepository = require('../database/conexion.repository');
const logger = require('../utils/logger');

const ARCHIVO = config.pendientes.archivo;

const txt = (valor) => String(valor ?? '').trim();

/**
 * Normaliza una fila del SP / del snapshot al formato que usa el resto del flujo.
 * DriveID es el id de la carpeta de Drive donde vive el PDF de esa guía; sin él
 * no hay contra qué trabajar, así que se conserva tal cual y lo valida el flujo.
 */
function aFila(f) {
  return {
    ID: Number(f.ID),
    idEmpresa: txt(f.idEmpresa),
    idDocumento: txt(f.idDocumento),
    Estado: Number(f.Estado),
    DriveID: txt(f.DriveID),
  };
}

/**
 * Escribe el listado de pendientes en disco, SIN volver a correr el SP.
 * Lo usa el comando `todo` al terminar: deja en el archivo solo las guías que no
 * se pudieron terminar, para que la siguiente corrida empiece por ahí en lugar
 * de volver a procesar las que ya quedaron hechas.
 * @param {Array<object>} guias - filas ya normalizadas
 * @param {{origen?:string, nota?:string}} [meta]
 * @returns {Promise<{ruta:string, guardadas:number}>}
 */
async function guardar(guias, meta = {}) {
  const contenido = {
    generado: new Date().toISOString(),
    origen: meta.origen || 'procesar',
    total: guias.length,
    guias,
  };
  if (meta.nota) contenido.nota = meta.nota;

  await fs.promises.mkdir(path.dirname(ARCHIVO), { recursive: true });
  await fs.promises.writeFile(ARCHIVO, JSON.stringify(contenido, null, 2), 'utf8');
  logger.info(`Guardadas ${guias.length} guía(s) pendientes en ${ARCHIVO}`);
  return { ruta: ARCHIVO, guardadas: guias.length };
}

/**
 * Corre spPyOValidaGuia y guarda el resultado en disco.
 *
 * Esto es lo único que necesita el permiso EXECUTE sobre el SP, que solo existe
 * en la BD central (admin) y no lo tiene el usuario con que la app se mueve
 * entre las BD de las empresas. Se corre una vez y queda el archivo.
 *
 * @param {boolean} [incluirTodos] - guardar también las de Estado 1 (por defecto
 *        solo las de Estado 2, que son las que tienen el QR pendiente)
 * @returns {Promise<{ruta:string, guardadas:number, total:number}>}
 */
async function exportar(incluirTodos = false) {
  const todas = await conexionRepository.getGuiasPorValidar({ incluirTodos });
  const filas = todas.map(aFila);

  const sinCarpeta = filas.filter((f) => !f.DriveID).length;
  if (sinCarpeta) {
    logger.warn(`${sinCarpeta} guía(s) vinieron sin DriveID: no se van a poder procesar`);
  }

  const guardado = await guardar(filas, { origen: 'spPyOValidaGuia' });
  return { ...guardado, total: filas.length };
}

/**
 * Parsea CSV (por si el archivo se generó a mano desde SSMS con
 * "Guardar resultados como"). Soporta campos entre comillas.
 */
function parsearCsv(contenido) {
  const filas = [];
  let campo = '';
  let fila = [];
  let enComillas = false;

  for (let i = 0; i < contenido.length; i++) {
    const c = contenido[i];
    if (enComillas) {
      if (c === '"') {
        if (contenido[i + 1] === '"') { campo += '"'; i++; } else { enComillas = false; }
      } else campo += c;
      continue;
    }
    if (c === '"') { enComillas = true; continue; }
    if (c === ',') { fila.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue; }
    campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

function normalizar(filas, incluirTodos) {
  if (!filas.length) return [];

  // Si la primera fila parece un encabezado, se descarta. Solo se mira con las
  // 4 primeras columnas para que un CSV anterior (sin DriveID) siga leyéndose,
  // aunque sus guías quedarán sin carpeta y se omitirán.
  const conEncabezado = ['id', 'idempresa', 'iddocumento', 'estado'].every(
    (col) => filas[0].some((c) => c.trim().toLowerCase() === col)
  );
  const cuerpo = conEncabezado ? filas.slice(1) : filas;

  return cuerpo
    .map((f) =>
      aFila({
        ID: parseInt(String(f[0]).trim(), 10),
        idEmpresa: f[1],
        idDocumento: f[2],
        Estado: parseInt(String(f[3]).trim(), 10),
        DriveID: f[4],
      })
    )
    .filter((f) => Number.isFinite(f.ID) && f.idEmpresa && f.idDocumento)
    .filter((f) => incluirTodos || f.Estado === 2);
}

/**
 * Lee el archivo de pendientes. Acepta el JSON que genera `exportar` o un CSV
 * con las columnas ID, idEmpresa, idDocumento, Estado, DriveID.
 * @param {boolean} [incluirTodos]
 * @returns {Promise<Array<{ID:number,idEmpresa:string,idDocumento:string,Estado:number,DriveID:string}>>}
 */
async function cargar(incluirTodos = false) {
  if (!fs.existsSync(ARCHIVO)) {
    throw new Error(
      `No existe el archivo de pendientes: ${ARCHIVO}\n` +
        `Generarlo con:  node src/server.js exportar\n` +
        `(requiere un usuario con permiso EXECUTE sobre spPyOValidaGuia en la BD central)`
    );
  }

  const contenido = await fs.promises.readFile(ARCHIVO, 'utf8');
  let guias;
  if (ARCHIVO.toLowerCase().endsWith('.csv')) {
    guias = normalizar(parsearCsv(contenido), incluirTodos);
  } else {
    const datos = JSON.parse(contenido);
    guias = Array.isArray(datos) ? datos : datos.guias;
    if (!Array.isArray(guias)) {
      throw new Error(`${ARCHIVO} no tiene la forma esperada (se esperaba un arreglo "guias")`);
    }
    guias = guias.map(aFila).filter((f) => incluirTodos || f.Estado === 2);
  }

  const stats = fs.statSync(ARCHIVO);
  const sinCarpeta = guias.filter((f) => !f.DriveID).length;
  logger.info(
    `Pendientes cargados de ${path.basename(ARCHIVO)}: ${guias.length} guía(s) ` +
      `(archivo del ${stats.mtime.toISOString().slice(0, 16).replace('T', ' ')})` +
      `${sinCarpeta ? `, ${sinCarpeta} sin DriveID` : ''}`
  );
  return guias;
}

module.exports = { ARCHIVO, exportar, guardar, cargar, parsearCsv };
