require('dotenv').config();

const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
const conexionRepository = require('./database/conexion.repository');
const empresaRepository = require('./database/empresa.repository');
const documentoRepository = require('./database/documento.repository');
const { getErpConnection, closeErpConnection, closeErpConnections } = require('./database/erp-connection');
const { closeConnection } = require('./database/connection');
const sunatGreService = require('./services/sunat-gre.service');
const driveService = require('./services/drive.service');
const cdrService = require('./services/cdr.service');
const qrService = require('./services/qr.service');
const pendientesService = require('./services/pendientes.service');

// idtipo en documentos_sve (y en el nombre del PDF en Drive)
const ID_TIPO_GUIA = '09';
// idtipo que espera spMuestraComprobanteGuia: no es el mismo
const ID_TIPO_DETALLE = '030009';
// Los PDF se descargan, se les cambia el QR y se vuelven a subir. Van a un
// directorio de trabajo aparte para no pisar documentosReferencia/, que es el
// histórico de referencia; lo que se sube es temporal y se borra al terminar.
const DIR_TRABAJO = path.join(__dirname, '../tmp');

const USO = `
Uso: node server.js <comando> [opciones]

Aplicación interna (manual, sin API ni interfaz gráfica). Procesa guías de remisión
de todas las empresas: consulta el CDR en SUNAT, reemplaza el QR del PDF en Drive
y guarda la URL del QR en la BD de cada empresa (codigovalidacion).

El listado de guías pendientes NO se pide a la BD en cada corrida: se genera una
vez con 'exportar' (que es lo único que necesita permiso EXECUTE sobre
spPyOValidaGuia en la BD central) y queda en ${pendientesService.ARCHIVO}.
Cada guía trae en su fila el DriveID de la carpeta donde está su PDF.

Comandos:
  todo [opciones]             Corrida completa: pide el listado a spPyOValidaGuia y
                               a continuación procesa todo lo que devuelva. Al
                               terminar deja el archivo de pendientes solo con lo
                               que falta, tmp/ y CDR/ limpios y las conexiones
                               cerradas, listo para la siguiente corrida.
                               Es el comando para el trabajo diario.
  exportar [--todos]           Corre spPyOValidaGuia y guarda el listado en disco.
                               --todos incluye también las de Estado 1 (las que
                               todavía sube el ERP a SUNAT).
  procesar [opciones]          Flujo completo sobre el listado guardado (default)
  probar [--conexiones n]      Prueba de punta a punta SIN escribir nada: toma una
                               guía de n conexiones distintas, las busca en su
                               carpeta de Drive y comprueba que el QR impreso en
                               el PDF sea el que devuelve SUNAT. Default n = 4
  pendientes [opciones]        Solo lista lo que se procesaría
  listar                       Lista las empresas de admin.dbo.Conexiones con Guia = 1
  verificar <con> <emp> <doc>  Consulta en SUNAT una guía puntual
  drive listar <driveId> [filtro]  Lista los archivos de esa carpeta de Drive
  drive buscar <driveId> <nombre>  Busca un archivo por nombre exacto
  drive descargar <driveId> <nombre>  Lo descarga a documentosReferencia/

Opciones de procesar/pendientes:
  --simular            No escribe nada: no descarga ni sube a Drive, no reemplaza
                       el QR y no actualiza codigovalidacion. Solo informa.
  --limite <n>         Procesa como máximo n documentos.
  --conexion <id>      Solo esa empresa (id de Conexiones).
  --empresa <id>       Solo esa idEmpresa dentro de la conexión.
  --refrescar          Vuelve a correr spPyOValidaGuia antes de procesar.

Opciones de probar:
  --conexiones <n>     Cuántas conexiones distintas probar (default 4).
                       Sirve --conexion y --empresa para acotar cuáles.

Ejemplos:
  node server.js todo                    # la corrida diaria, de punta a punta
  node server.js todo --simular         # la corrida diaria sin escribir nada
  node server.js todo --limite 5        # solo las primeras 5
  node server.js exportar                # una vez, con permiso EXECUTE
  node server.js                         # procesar, usando el listado guardado
  node server.js procesar --simular
  node server.js procesar --simular --limite 10
  node server.js procesar --conexion 30 --limite 3
  node server.js procesar --refrescar
  node server.js probar
  node server.js probar --conexiones 6
  node server.js pendientes
  node server.js verificar 30 01 260000802500
  node server.js drive listar 1Rf8Zs2UsaYxGXKyEG6vRjUOzHZeUa366
  node server.js drive buscar 1Rf8Zs2UsaYxGXKyEG6vRjUOzHZeUa366 20492641431-...-09-TR30-00001342.pdf
`;

const txt = (valor) => String(valor ?? '').trim();

/** Recorta para que las tablas del log no se vuelvan líneas de 500 caracteres. */
const cortar = (valor, n = 70) => {
  const s = txt(valor);
  return s.length > n ? s.slice(0, n) + '…' : s;
};

function parseOpciones(args) {
  const opciones = {
    simular: false,
    limite: Infinity,
    conexion: null,
    conexiones: 4,
    empresa: null,
    refrescar: false,
    todos: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--simular') opciones.simular = true;
    else if (arg === '--refrescar') opciones.refrescar = true;
    else if (arg === '--todos') opciones.todos = true;
    else if (arg === '--limite') opciones.limite = parseInt(args[++i], 10) || Infinity;
    else if (arg === '--conexion') opciones.conexion = parseInt(args[++i], 10);
    else if (arg === '--conexiones') opciones.conexiones = parseInt(args[++i], 10) || 4;
    else if (arg === '--empresa') opciones.empresa = txt(args[++i]);
  }
  return opciones;
}

/**
 * Devuelve el listado de guías pendientes. Salvo que se pida refrescarlo, se
 * lee del archivo que dejó `exportar`; así la corrida normal no necesita el
 * permiso EXECUTE sobre spPyOValidaGuia.
 */
async function obtenerPendientes(opciones) {
  if (opciones.refrescar) {
    logger.info('Refrescando el listado desde spPyOValidaGuia...');
    await pendientesService.exportar(opciones.todos);
  }
  return pendientesService.cargar(opciones.todos);
}

function filtrar(filas, opciones) {
  return filas.filter((f) => {
    if (opciones.conexion && Number(f.ID) !== opciones.conexion) return false;
    if (opciones.empresa && txt(f.idEmpresa) !== opciones.empresa) return false;
    return true;
  });
}

/**
 * Arma los nombres por los que puede estar el PDF en Drive.
 * El nombre real es: <rucEmisor>-<fecha>-<rucCliente>-09-<serie>-<numero>.pdf
 */
async function patronesDrive(pool, credenciales, documento) {
  const serie = txt(documento.serie_doc);
  const numero = txt(documento.numero_doc);
  const identificador = `${serie}-${numero}`;
  const patrones = [`09-${identificador}.pdf`, identificador];

  try {
    const detalle = (
      await documentoRepository.getDetalleDocumento(
        pool,
        documento.idempresa,
        documento.idoficina,
        ID_TIPO_DETALLE,
        serie,
        numero
      )
    )[0];

    if (detalle) {
      const fecha =
        detalle.fechaemision instanceof Date
          ? detalle.fechaemision.toISOString().slice(0, 10)
          : txt(detalle.fechaemision).slice(0, 10);
      const nombreEsperado =
        `${credenciales.ruc}-${fecha}-${txt(detalle.nropersoneria)}` +
        `-${ID_TIPO_GUIA}-${identificador}.pdf`;
      patrones.unshift(nombreEsperado);
      logger.info(`  nombre esperado en Drive: ${nombreEsperado}`);
    }
  } catch (error) {
    logger.warn(`  no se pudo armar el nombre desde la BD: ${error.message}`);
  }

  return patrones;
}

/**
 * Si una carpeta de Drive no está compartida con la cuenta de servicio, o su id
 * no es válido, todas las búsquedas de las guías de esa carpeta van a fallar
 * igual. Se marca la carpeta una sola vez para no repetir la llamada guía por
 * guía ni llenar el log: se siguen omitiendo sus documentos, que es lo que
 * importa. El resto de carpetas sigue normal.
 */
const carpetasInaccesibles = new Map();

/**
 * Busca el PDF entre los patrones posibles, dentro de la carpeta de la guía.
 * Si la carpeta no es accesible (no existe / sin permisos) la marca y devuelve
 * null; cualquier otro error se propaga para que se cuente como error del
 * documento.
 */
async function buscarEnDrive(patrones, carpeta) {
  if (carpetasInaccesibles.has(carpeta)) return null;

  for (const patron of patrones) {
    let encontrado;
    try {
      encontrado =
        (await driveService.buscarPorNombre(patron, carpeta)) ||
        (await driveService.buscarContiene(patron, carpeta));
    } catch (error) {
      const causa = driveService.clasificarError(error);
      if (causa.tipo === 'no-existe' || causa.tipo === 'sin-permisos') {
        carpetasInaccesibles.set(carpeta, `Drive no accesible: ${causa.mensaje}`);
        return null;
      }
      throw error;
    }
    const archivo = Array.isArray(encontrado) ? encontrado[0] : encontrado;
    if (archivo) return archivo;
  }
  return null;
}

/**
 * Procesa una guía pendiente: consulta SUNAT, reemplaza el QR del PDF en Drive
 * y guarda la URL del QR en codigovalidacion de la BD de la empresa.
 *
 * Hay tres modos, y solo uno escribe:
 *   - `simular`    (por defecto): no descarga ni sube nada, solo informa.
 *   - `verificarQr`: corre el flujo entero SIN escribir — baja el PDF, genera el
 *                    PDF con el QR y comprueba que el QR impreso sea el de SUNAT.
 *   - (ninguno)    el real: sube a Drive y guarda `codigovalidacion`.
 * @param {{ID:number,idEmpresa:string,idDocumento:string,DriveID?:string}} fila - fila del SP
 * @param {object} conexion - fila de Conexiones (ya resuelta, la conexión se
 *        mantiene abierta para todas las guías de la misma empresa)
 * @param {{simular?:boolean, verificarQr?:boolean}} [opciones]
 * @returns {Promise<{estado:string, motivo?:string, detalle?:object}>}
 */
async function procesarGuia(fila, conexion, opciones = {}) {
  const { simular = true, verificarQr = false } = opciones;

  const idEmpresa = txt(fila.idEmpresa);
  const idDocumento = txt(fila.idDocumento);
  // La carpeta puede venir en la fila del SP o, si el listado se generó con un
  // SP viejo, salir de Conexiones.DriveID, que es de donde el SP la saca.
  const carpeta = txt(fila.DriveID) || txt(conexion.DriveID);

  if (!carpeta) {
    logger.warn(
      `${idEmpresa}/${idDocumento}: el listado no trae DriveID (carpeta de Drive), se omite`
    );
    return { estado: 'omitido', motivo: 'sin DriveID en el listado' };
  }

  // Si ya se comprobó que esa carpeta no es accesible, no se sigue gastando
  // consultas a SUNAT para guías que igual no se van a poder escribir.
  if (carpetasInaccesibles.has(carpeta)) {
    return { estado: 'omitido', motivo: carpetasInaccesibles.get(carpeta) };
  }

  const pool = await getErpConnection(conexion);

  const documento = await documentoRepository.getPorIdDocumento(pool, idEmpresa, idDocumento);
  if (!documento) {
    const motivo = 'no está en documentos_sve';
    logger.warn(`${idEmpresa}/${idDocumento}: ${motivo} de ${conexion.NombreBD}`);
    return { estado: 'omitido', motivo };
  }

  const serie = txt(documento.serie_doc);
  const numero = txt(documento.numero_doc);
  const etiqueta = `${txt(conexion.ruc)} ${serie}-${numero}`;
  const ticket = txt(documento.id_sunat);

  if (!ticket) {
    logger.warn(`${etiqueta}: sin ticket (id_sunat), se omite`);
    return { estado: 'omitido', motivo: 'sin ticket' };
  }

  const credenciales = await empresaRepository.getCredencialesSunat(pool, idEmpresa);
  if (credenciales.ruc !== txt(conexion.ruc)) {
    logger.warn(
      `${etiqueta}: el RUC de v_empresas (${credenciales.ruc}) no coincide con ` +
        `Conexiones.ruc (${txt(conexion.ruc)})`
    );
  }

  logger.info(
    `${etiqueta}: consultando SUNAT (ticket ${ticket}, estado ERP ${txt(documento.estado)})...`
  );
  const resultado = await sunatGreService.consultarEstado(ticket, credenciales);

  if (resultado.estado !== '0' || !resultado.qrUrl) {
    logger.warn(
      `${etiqueta}: SUNAT estado=${resultado.estado} (${resultado.descripcion})` +
        `${resultado.qrUrl ? '' : ' sin URL de QR'}. Se deja para la próxima corrida.`
    );
    return {
      estado: 'omitido',
      motivo: resultado.estado !== '0' ? `SUNAT estado ${resultado.estado}` : 'sin URL de QR',
    };
  }
  logger.info(`${etiqueta}: ACEPTADO - QR obtenido`);

  const patrones = await patronesDrive(pool, credenciales, documento);
  const archivo = await buscarEnDrive(patrones, carpeta);
  if (!archivo) {
    const motivo = carpetasInaccesibles.get(carpeta);
    if (motivo) {
      logger.warn(`${etiqueta}: ${motivo}, se omite`);
      return { estado: 'omitido', motivo };
    }
    // La carpeta puede no tener todavía el PDF de esta guía: no es un error, el
    // documento queda pendiente para cuando el PDF esté subido.
    logger.warn(`${etiqueta}: no se encontró el PDF en Drive, se omite`);
    return { estado: 'omitido', motivo: 'sin PDF en Drive' };
  }
  logger.info(`${etiqueta}: PDF en Drive [${archivo.id}] ${archivo.name}`);

  if (simular && !verificarQr) {
    logger.info(
      `[SIMULACIÓN] ${etiqueta}: se habría escrito el QR en ${archivo.name} ` +
        `subido el CDR como ${archivo.name.replace(/\.pdf$/i, '')}.xml en la carpeta ` +
        `${carpeta} y marcado ${idEmpresa}/${idDocumento}.codigovalidacion`
    );
    return { estado: 'simulado' };
  }

  // A partir de acá ya no se toca Drive ni la BD hasta el final del flujo, donde
  // solo se llega en el modo real. Cualquier falla lanza y el documento queda
  // pendiente: no se guarda la URL y no se sigue con los pasos siguientes de
  // ESTE documento (el error sube al catch de la corrida).
  const rutaDescargada = path.join(DIR_TRABAJO, archivo.name);
  const rutaFinal = path.join(
    DIR_TRABAJO,
    archivo.name.replace(/\.pdf$/i, '') + '-qr.pdf'
  );

  try {
    await fs.promises.mkdir(DIR_TRABAJO, { recursive: true });
    await driveService.descargar(archivo.id, rutaDescargada);

    await qrService.reemplazar({
      entrada: rutaDescargada,
      contenidoQr: resultado.qrUrl,
      salida: rutaFinal,
    });

    // Si reemplazar-qr saliera con código 0 sin haber escrito nada, no se sube:
    // se publicaría un PDF sin QR y el documento quedaría marcado como hecho.
    const info = await fs.promises.stat(rutaFinal).catch(() => null);
    if (!info || info.size < 1024) {
      throw new Error(
        `reemplazar-qr no generó un PDF válido en ${rutaFinal}` +
          (info ? ` (${info.size} bytes)` : ' (no existe)')
      );
    }

    if (verificarQr) {
      // Modo prueba: se comprueba que el QR impreso sea el de SUNAT, sin escribir.
      // Se lee también el QR del PDF que está hoy en Drive, que es justamente el
      // que hay que cambiar: si son distintos, el PDF vigente está mal.
      const [qrActual, qrLeido, url] = await Promise.all([
        qrService.leerQr(rutaDescargada),
        qrService.leerQr(rutaFinal),
        sunatGreService.verificarQrUrl(resultado.qrUrl),
      ]);
      const detalle = {
        etiqueta,
        conexion: Number(fila.ID),
        serie: `${serie}-${numero}`,
        archivo: archivo.name,
        sunat: resultado.estado,
        qrUrl: resultado.qrUrl,
        qrActual: qrActual || '(no se pudo leer)',
        qrLeido: qrLeido || '(no se pudo leer)',
        coincide: qrLeido === resultado.qrUrl,
        cambia: qrLeido !== qrActual,
        urlResponde: url.ok ? `HTTP ${url.estado}` : `no (${url.error || url.estado})`,
        pdfBytes: info.size,
      };
      logger.info(
        `${etiqueta}: el PDF de Drive hoy imprime "${cortar(detalle.qrActual, 70)}"` +
          (detalle.cambia ? ' (distinto: hay que cambiarlo)' : ' (ya coincide)')
      );
      logger.info(
        `${etiqueta}: QR impreso ${detalle.coincide ? 'COINCIDE' : 'NO COINCIDE'} con la URL de SUNAT ` +
          `(${detalle.pdfBytes} bytes de PDF, la URL responde ${detalle.urlResponde})`
      );
      if (!detalle.coincide) {
        logger.warn(`${etiqueta}: el QR del PDF dice "${detalle.qrLeido}"`);
      }
      return { estado: 'verificado', detalle };
    }

    if (!resultado.rutaCdr) {
      throw new Error('se obtuvo la URL del QR pero no el archivo del CDR para subirlo');
    }

    // Se sube a la MISMA carpeta de la guía, con el mismo nombre y otra
    // extensión: el PDF reemplaza al que tenía el QR erróneo (files.update no
    // requiere ser propietario) y el CDR va como .xml.
    await driveService.subir(rutaFinal, archivo.name, carpeta);
    // El CDR va con el nombre del PDF y otra extensión. Se quita la extensión
    // en vez de reemplazarla para que el nombre nunca pueda coincidir con el del
    // PDF (si el archivo de Drive no terminara en .pdf, `subir` encontraría el
    // mismo archivo y lo sobrescribiría con el XML).
    const nombreCdr = `${archivo.name.replace(/\.pdf$/i, '')}.xml`;
    if (nombreCdr === archivo.name) {
      throw new Error(`el nombre del PDF en Drive no admite un CDR: ${archivo.name}`);
    }
    await driveService.subir(resultado.rutaCdr, nombreCdr, carpeta);

    // Recién después de subir el PDF se marca el documento, para que una falla
    // en Drive no deje el documento marcado como procesado. Se escribe la marca
    // de 4 caracteres, NO la URL del QR: esa columna es CHAR(4) y una URL no
    // entra (ver documento.repository.marcarQrReemplazado).
    const actualizadas = await documentoRepository.marcarQrReemplazado(
      pool,
      idEmpresa,
      idDocumento
    );
    if (!actualizadas) {
      throw new Error(`no se actualizó ninguna fila de ${idEmpresa}/${idDocumento}`);
    }

    logger.info(
      `${etiqueta}: QR reemplazado en Drive (${archivo.name}, ${nombreCdr}) ` +
        `y guía marcada en codigovalidacion`
    );
    return { estado: 'procesado' };
  } catch (error) {
    // Si ya sabemos que la cuenta no puede escribir/leer esa carpeta, se deja de
    // intentar en cada documento para no repetir el mismo fallo una y otra vez.
    const causa = driveService.clasificarError(error);
    if (causa.tipo === 'sin-permisos' || causa.tipo === 'no-existe') {
      carpetasInaccesibles.set(carpeta, `Drive no accesible: ${causa.mensaje}`);
    }
    throw error;
  } finally {
    // Los temporales no se dejan tirados ni se arrastran a la próxima corrida:
    // los PDF van a tmp/ y el CDR ya subido se borra de CDR/.
    await Promise.all(
      [rutaDescargada, rutaFinal].map((ruta) =>
        fs.promises.rm(ruta, { force: true }).catch(() => {})
      )
    );
    await cdrService.borrar(resultado.rutaCdr);
  }
}

/** Identifica una guía del listado (conexión + empresa + documento). */
const claveGuia = (f) => `${Number(f.ID)}|${txt(f.idEmpresa)}|${txt(f.idDocumento)}`;

const LOCK = path.join(DIR_TRABAJO, '.corrida.lock');

/**
 * Toma el candado de la corrida. Sin esto, dos `todo` simultáneos (un trabajo
 * programado que se solapa con una corrida manual) trabajarían sobre los mismos
 * PDF de tmp/ y sobre el mismo archivo de pendientes, y el segundo podría
 * borrar del archivo lo que el primero todavía no terminó.
 *
 * Un candado de un proceso que ya no existe (matado a la fuerza, máquina apagada)
 * se considera vencido y se recupera: si no, la app no volvería a arrancar sola.
 * @returns {Promise<() => Promise<void>>} función para liberar el candado
 */
async function tomarCandado() {
  await fs.promises.mkdir(DIR_TRABAJO, { recursive: true });
  const contenido = JSON.stringify({ pid: process.pid, desde: new Date().toISOString() });

  for (let intento = 0; intento < 2; intento++) {
    try {
      await fs.promises.writeFile(LOCK, contenido, { flag: 'wx' });
      return async () => {
        await fs.promises.rm(LOCK, { force: true }).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previo = await fs.promises
        .readFile(LOCK, 'utf8')
        .catch(() => '');
      const pid = Number.parseInt(String(previo).replace(/[^\d]/g, '').slice(0, 6), 10);
      let vivo = false;
      try {
        if (pid) process.kill(pid, 0);
        vivo = true;
      } catch {
        vivo = false;
      }
      if (vivo) {
        throw new Error(
          `Ya hay otra corrida en marcha (pid ${pid}). Si no es así, borrar ${LOCK} y volver a correr.`
        );
      }
      logger.warn(`Se recupera el candado de una corrida anterior (pid ${pid || '?'} ya no existe)`);
      await fs.promises.rm(LOCK, { force: true });
    }
  }
  throw new Error('No se pudo tomar el candado de la corrida');
}

/**
 * Corrida completa: pide el listado al SP y a continuación procesa lo que
 * devuelva, dejando el archivo y las carpetas limpias para la próxima vez.
 *
 * El permiso EXECUTE del SP es opcional acá: si el usuario actual no lo tiene
 * (es el caso del usuario con que la app entra a las BD de las empresas), se
 * avisa y se sigue con el listado que ya estaba en disco. Así el comando sirve
 * para las dos situaciones sin cambiar de usuario a mitad de la corrida.
 *
 * @param {string[]} args
 */
async function comandoTodo(args) {
  const opciones = parseOpciones(args);
  const liberar = await tomarCandado();

  try {
    // 1) El listado, desde el SP. En simulación no se refresca: `--simular` no
    //    debe escribir nada, ni siquiera el archivo de pendientes.
    let desdeSp = true;
    if (opciones.simular) {
      logger.info('[SIMULACIÓN] no se corre el SP: se usa el listado que ya está en disco');
      desdeSp = false;
    } else {
      try {
        await pendientesService.exportar(opciones.todos);
      } catch (error) {
        if (!fs.existsSync(pendientesService.ARCHIVO)) throw error;
        desdeSp = false;
        logger.warn(
          `No se pudo correr spPyOValidaGuia: ${String(error.message).split('\n')[0]}`
        );
        logger.warn(
          `Se sigue con el listado que ya está en ${pendientesService.ARCHIVO}. ` +
            'Las guías que SUNAT haya aceptado desde la última vez NO se verán en esta corrida.'
        );
      }
    }

    // 2) Procesar. Se guarda la lista completa (sin --conexion/--empresa) porque
    //    al final se reescribe el archivo con lo que quede, y tiene que seguir
    //    incluyendo lo que este comando no iba a procesar.
    const todas = await obtenerPendientes({ ...opciones, refrescar: false });
    // `todo` ya refresca el listado: se le quita --refrescar para no correr el SP dos veces.
    const sinRefrescar = args.filter((a) => a !== '--refrescar');
    const { resumen, completadas } = await comandoProcesar(sinRefrescar);

    if (opciones.simular) {
      logger.info('[SIMULACIÓN] El archivo de pendientes no se modificó');
      return;
    }

    // 3) Dejar el archivo solo con lo que falta, para que la próxima corrida
    //    siga desde ahí y no vuelva a procesar lo ya hecho.
    const restantes = todas.filter((f) => !completadas.has(claveGuia(f)));
    await pendientesService.guardar(restantes, {
      origen: desdeSp ? 'spPyOValidaGuia' : 'procesar (el SP no se pudo correr)',
      nota: desdeSp
        ? undefined
        : 'Este listado no viene del SP: se reconstruyó con lo que quedó sin procesar.',
    });
    logger.info(
      `Quedan ${restantes.length} guía(s) en el archivo para la próxima corrida ` +
        `(${completadas.size} procesada(s) en esta)`
    );
    logger.info(
      resumen.procesado > 0
        ? 'Para volver a correrlo: node src/server.js todo'
        : 'No se procesó ninguna guía; no hace falta volver a correrlo hasta mañana.'
    );
  } finally {
    await liberar();
  }
}

/**
 * Agrupa las guías por conexión para no saltar de empresa en empresa: se abre
 * la conexión a la BD de la empresa, se procesan TODAS sus guías y recién
 * después se cierra ese pool.
 * @returns {Map<number, Array<object>>} idConexion -> guías, en orden
 */
function agruparPorConexion(guias) {
  const grupos = new Map();
  for (const fila of guias) {
    const id = Number(fila.ID);
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id).push(fila);
  }
  return grupos;
}

async function comandoProcesar(args) {
  const opciones = parseOpciones(args);
  logger.info(
    `Procesando${opciones.simular ? ' [SIMULACIÓN: no se escribe en Drive ni en la BD]' : ''}`
  );

  const guias = filtrar(await obtenerPendientes(opciones), opciones);
  const grupos = agruparPorConexion(guias);
  if (!guias.length) {
    logger.info('No hay guías pendientes: nada que procesar');
    return { resumen: { procesado: 0, simulado: 0, omitido: 0, error: 0 }, completadas: new Set() };
  }
  logger.info(
    `${guias.length} guía(s) pendiente(s) en ${grupos.size} empresa(s): ` +
      [...grupos].map(([id, g]) => `${id}=${g.length}`).join(' ')
  );

  const resumen = { procesado: 0, simulado: 0, omitido: 0, error: 0 };
  const omitidos = new Map();
  const errores = [];
  // Las que quedaron escritas en Drive y en la BD. Lo usa el comando `todo` para
  // dejar el archivo de pendientes solo con lo que falta.
  const completadas = new Set();
  let procesadas = 0;

  for (const [idConexion, grupo] of grupos) {
    if (procesadas >= opciones.limite) {
      logger.info(`Límite de ${opciones.limite} alcanzado, se detiene`);
      break;
    }

    const conexion = await conexionRepository.getPorId(idConexion);
    if (!conexion) {
      logger.warn(`Conexión ${idConexion} no existe en Conexiones, se omiten ${grupo.length} guía(s)`);
      resumen.omitido += grupo.length;
      continue;
    }

    logger.info(
      `--- Empresa ${idConexion} (${txt(conexion.ruc)} ${txt(conexion.NombreServer)}/` +
        `${txt(conexion.NombreBD)}): ${grupo.length} guía(s) ---`
    );

    // Se abre la conexión una vez por empresa. Si no se puede (servidor caído,
    // credenciales malas, firewall), se omiten todas sus guías de una: reintentar
    // documento por documento sería esperar el timeout N veces sin resultado.
    try {
      await getErpConnection(conexion);
    } catch (error) {
      const motivo = `sin acceso a la BD: ${error.message}`;
      logger.warn(`${idConexion}: ${motivo}, se omiten ${grupo.length} guía(s)`);
      omitidos.set(motivo, (omitidos.get(motivo) || 0) + grupo.length);
      resumen.omitido += grupo.length;
      continue;
    }

    try {
      for (const fila of grupo) {
        if (procesadas >= opciones.limite) {
          logger.info(`Límite de ${opciones.limite} alcanzado, se detiene`);
          break;
        }
        procesadas++;
        try {
          const { estado, motivo } = await procesarGuia(fila, conexion, {
            simular: opciones.simular,
          });
          resumen[estado]++;
          if (estado === 'procesado') completadas.add(claveGuia(fila));
          if (motivo) omitidos.set(motivo, (omitidos.get(motivo) || 0) + 1);
        } catch (error) {
          resumen.error++;
          const etiqueta = `${idConexion}/${txt(fila.idEmpresa)}/${txt(fila.idDocumento)}`;
          logger.error(`${etiqueta}: ${error.message}`);
          errores.push(`${etiqueta}: ${error.message}`);
        }
      }
    } finally {
      // La conexión a esta empresa se cierra antes de pasar a la siguiente.
      await closeErpConnection(conexion);
    }
  }

  console.table(resumen);
  if (omitidos.size) {
    console.table([...omitidos].map(([motivo, n]) => ({ omitido: motivo, guias: n })));
  }
  if (errores.length) {
    logger.warn(`Errores (${errores.length}):`);
    for (const e of errores) console.log(`  - ${e}`);
  }
  if (carpetasInaccesibles.size) {
    logger.warn(
      `ATENCIÓN: ${carpetasInaccesibles.size} carpeta(s) de Drive inaccesibles. Ningún PDF de ` +
        `esas carpetas pudo procesarse. Verificar que los DriveID del listado sean correctos y ` +
        `que esas carpetas estén compartidas con la cuenta de servicio de Drive ` +
        `(permiso lector y escritor).`
    );
    for (const [carpeta, motivo] of carpetasInaccesibles) {
      logger.warn(`  ${carpeta}: ${motivo}`);
    }
  }

  // Los CDR ya están subidos a Drive: la carpeta de trabajo se vacía para no
  // dejar 265 XML acumulados.
  await cdrService.limpiar();

  // Código de salida distinto de 0 si algún documento falló, para que un trabajo
  // programado (cron/task scheduler) lo detecte: una corrida con errores se ve
  // igual que una exitosa si el proceso termina con 0.
  if (resumen.error > 0) process.exitCode = 1;

  logger.info('Flujo completado');
  return { resumen, completadas, omitidos, errores };
}

async function comandoProbar(args) {
  const opciones = parseOpciones(args);
  const guias = filtrar(await obtenerPendientes(opciones), opciones);
  const grupos = agruparPorConexion(guias);

  // Una guía de cada conexión, para que la prueba cubra empresas distintas
  // (servidor, BD y credenciales de SUNAT distintas) y no dos guías del mismo ERP.
  const elegidas = [...grupos.values()].slice(0, opciones.conexiones).map((g) => g[0]);
  if (!elegidas.length) {
    logger.warn('No hay guías pendientes para probar');
    return;
  }

  logger.info(
    `Prueba de punta a punta (NO escribe nada): ${elegidas.length} guía(s), una por empresa ` +
      `de ${elegidas.length} conexión(es) distintas`
  );
  const sinDriveId = guias.filter((g) => !g.DriveID).length;
  if (sinDriveId) {
    logger.info(
      `El listado no trae DriveID: se usa Conexiones.DriveID, que es de donde lo saca el SP. ` +
        `Regenerá el listado con 'exportar' cuando tengas el permiso.`
    );
  }

  const filas = [];
  const omitidos = new Map();
  const errores = [];

  for (const fila of elegidas) {
    const idConexion = Number(fila.ID);
    const etiqueta = `${idConexion}/${txt(fila.idEmpresa)}/${txt(fila.idDocumento)}`;
    const conexion = await conexionRepository.getPorId(idConexion);
    if (!conexion) {
      logger.warn(`Conexión ${idConexion} no existe en Conexiones, se omite`);
      omitidos.set('conexión inexistente', (omitidos.get('conexión inexistente') || 0) + 1);
      continue;
    }
    try {
      await getErpConnection(conexion);
      const { estado, motivo, detalle } = await procesarGuia(fila, conexion, {
        simular: false,
        verificarQr: true,
      });
      if (detalle) filas.push(detalle);
      if (motivo) omitidos.set(motivo, (omitidos.get(motivo) || 0) + 1);
    } catch (error) {
      logger.error(`${etiqueta}: ${error.message}`);
      errores.push(`${etiqueta}: ${error.message}`);
    } finally {
      await closeErpConnection(conexion);
    }
  }

  console.log('');
  console.table(
    filas.map((d) => ({
      conexión: d.conexion,
      guía: d.serie,
      SUNAT: d.sunat,
      'PDF en Drive': cortar(d.archivo, 46),
      'QR que tiene hoy': cortar(d.qrActual, 40),
      'QR nuevo = SUNAT': d.coincide ? 'sí' : 'NO',
      'URL responde (info)': d.urlResponde,
    }))
  );
  if (omitidos.size) {
    console.table([...omitidos].map(([motivo, n]) => ({ omitido: motivo, guias: n })));
  }
  if (errores.length) {
    console.log('');
    console.table(errores.map((e) => ({ error: e })));
  }

  const conQr = filas.filter((d) => d.coincide).length;
  const aCambiar = filas.filter((d) => d.cambia).length;
  logger.info(
    `Resultado: ${conQr}/${filas.length} guía(s) con el QR verificado contra SUNAT` +
      `, ${aCambiar} con el QR vigente equivocado (por eso hay que procesarlas)`
  );
  if (filas.some((d) => !d.coincide)) {
    logger.warn('Hay guías cuyo QR no coincide: revisar el detalle de arriba');
  }
  logger.info('No se escribió nada en Drive ni en la BD. Para procesar de verdad: node src/server.js procesar');

  // Los CDR y los PDF de la prueba son temporales.
  await cdrService.limpiar();
}

async function comandoExportar(args) {
  const opciones = parseOpciones(args);
  const { ruta, guardadas } = await pendientesService.exportar(opciones.todos);
  const porEmpresa = new Map();
  for (const g of await pendientesService.cargar(true)) {
    if (!porEmpresa.has(g.ID)) porEmpresa.set(g.ID, 0);
    porEmpresa.set(g.ID, porEmpresa.get(g.ID) + 1);
  }
  console.log(`\n  ${guardadas} guía(s) guardadas en:\n  ${ruta}\n`);
  console.table([...porEmpresa].map(([id, n]) => ({ conexion: id, guias: n })));
  logger.info(
    'Listo. Para procesar: node src/server.js procesar   ' +
      '(no vuelve a necesitar el permiso sobre spPyOValidaGuia)'
  );
}

async function comandoPendientes(args) {
  const opciones = parseOpciones(args);
  const todas = await obtenerPendientes(opciones);
  const guias = filtrar(todas, opciones);
  const aMostrar = guias.slice(0, opciones.limite === Infinity ? guias.length : opciones.limite);
  console.table(aMostrar);
  logger.info(
    `${guias.length} guía(s) pendiente(s)` +
      (aMostrar.length < guias.length ? `, mostrando ${aMostrar.length}` : '')
  );
}

async function comandoListarConexiones() {
  const conexiones = await conexionRepository.getConGuias();
  console.table(
    conexiones.map((c) => ({
      id: c.id,
      ruc: txt(c.ruc),
      servidor: txt(c.NombreServer),
      bd: txt(c.NombreBD),
      usuario: txt(c.usuario),
      estado: txt(c.estado),
    }))
  );
  logger.info(`${conexiones.length} empresa(s) con Guia = 1`);
}

async function comandoVerificar(idConexion, idEmpresa, idDocumento) {
  if (!idConexion || !idEmpresa || !idDocumento) {
    console.error('Uso: node server.js verificar <idConexion> <idEmpresa> <idDocumento>');
    return process.exit(1);
  }
  const conexion = await conexionRepository.getPorId(idConexion);
  if (!conexion) {
    console.error(`No existe la conexión ${idConexion}`);
    return process.exit(1);
  }
  const pool = await getErpConnection(conexion);
  const credenciales = await empresaRepository.getCredencialesSunat(pool, idEmpresa);
  const documento = await documentoRepository.getPorIdDocumento(pool, idEmpresa, idDocumento);
  if (!documento) {
    console.error(`No existe ${idEmpresa}/${idDocumento} en ${conexion.NombreBD}`);
    return process.exit(1);
  }

  logger.info(`Consultando SUNAT ${txt(documento.serie_doc)}-${txt(documento.numero_doc)}...`);
  const resultado = await sunatGreService.consultarEstado(txt(documento.id_sunat), credenciales);
  console.table(resultado);
  if (resultado.qrUrl) logger.info(`QR URL: ${resultado.qrUrl}`);
}

async function comandoDriveListar(carpeta, filtroNombre) {
  if (!carpeta) {
    console.error('Indique la carpeta: node src/server.js drive listar <driveId> [filtro]');
    return process.exit(1);
  }
  logger.info(
    `Listando carpeta de Drive (id: ${carpeta})${filtroNombre ? `, filtro: "${filtroNombre}"` : ''}...`
  );
  const archivos = await driveService.listar(carpeta, filtroNombre || '');
  if (archivos.length === 0) {
    logger.warn('No se encontraron archivos');
    return;
  }
  // Las carpetas de estas empresas tienen decenas de miles de archivos y Drive
  // los devuelve de a 1000: sin este aviso parece que el comando se colgó.
  if (archivos.length >= 2000) {
    logger.warn(
      `La carpeta tiene ${archivos.length} archivos: el listado tardó y la tabla puede ` +
        'salir cortada. Para buscar algo puntual usa mejor un filtro.'
    );
  }
  console.table(
    archivos.map((a) => ({
      id: a.id,
      nombre: a.name,
      mime: a.mimeType,
      tamano: a.size ? `${(a.size / 1024).toFixed(0)} KB` : '',
    }))
  );
}

async function comandoDriveBuscar(carpeta, nombre) {
  if (!carpeta || !nombre) {
    console.error('Uso: node src/server.js drive buscar <driveId> <nombre>');
    return process.exit(1);
  }
  logger.info(`Buscando en Drive (${carpeta}): "${nombre}"`);
  const resultado =
    (await driveService.buscarPorNombre(nombre, carpeta)) ||
    (await driveService.buscarContiene(nombre, carpeta));
  const archivo = Array.isArray(resultado) ? resultado[0] : resultado;
  if (!archivo) {
    logger.warn(`No se encontró "${nombre}" en Drive`);
    return;
  }
  console.table([archivo]);
}

async function comandoDriveDescargar(carpeta, nombre) {
  if (!carpeta || !nombre) {
    console.error('Uso: node src/server.js drive descargar <driveId> <nombre>');
    return process.exit(1);
  }
  const encontrado =
    (await driveService.buscarPorNombre(nombre, carpeta)) ||
    (await driveService.buscarContiene(nombre, carpeta));
  const archivo = Array.isArray(encontrado) ? encontrado[0] : encontrado;
  if (!archivo) {
    logger.warn(`No se encontró "${nombre}" en Drive`);
    return;
  }
  const rutaNueva = path.join(__dirname, '../documentosReferencia/' + archivo.name);
  await driveService.descargar(archivo.id, rutaNueva);
  logger.info(`Descargado: ${rutaNueva}`);
}

async function cerrarTodo() {
  await closeErpConnections();
  await closeConnection();
  // Si se cortó la corrida a la mitad, el PDF descargado queda en tmp/ y no se
  // reutiliza, pero tampoco se acumula basura.
  await fs.promises.rm(DIR_TRABAJO, { recursive: true, force: true }).catch(() => {});
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2);

  switch (comando) {
    case 'todo':
      await comandoTodo(resto);
      break;
    case undefined:
    case 'procesar':
      await comandoProcesar(resto);
      break;
    case 'exportar':
      await comandoExportar(resto);
      break;
    case 'probar':
      await comandoProbar(resto);
      break;
    case 'pendientes':
      await comandoPendientes(resto);
      break;
    case 'listar':
      await comandoListarConexiones();
      break;
    case 'verificar':
      await comandoVerificar(resto[0], resto[1], resto[2]);
      break;
    case 'drive':
      switch (resto[0]) {
        case 'listar':
          await comandoDriveListar(resto[1], resto[2]);
          break;
        case 'buscar':
          await comandoDriveBuscar(resto[1], resto[2]);
          break;
        case 'descargar':
          await comandoDriveDescargar(resto[1], resto[2]);
          break;
        default:
          console.error('Subcomando de drive inválido');
          console.log(USO);
          process.exit(1);
      }
      break;
    default:
      console.log(USO);
      process.exit(comando ? 1 : 0);
  }

  await cerrarTodo();
}

main().catch(async (error) => {
  logger.error(`Error en ejecución: ${error.message}`);
  console.error(error);
  await cerrarTodo().catch(() => {});
  process.exit(1);
});
