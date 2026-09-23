require('dotenv').config();

const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const documentoRepository = require('./database/documento.repository');
const sunatGreService = require('./services/sunat-gre.service');
const driveService = require('./services/drive.service');
const qrService = require('./services/qr.service');
const { closeConnection } = require('./database/connection');

const USO = `
Uso: node server.js <comando> [opciones]

Aplicación interna (manual, sin API ni interfaz gráfica).

Comandos:
  listar [idEmpresa]              Lista guías pendientes de la BD (default idEmpresa: 01)
  verificar [ticket]              Consulta el estado en SUNAT de una guía por ticket/id_sunat
  drive listar [filtroNombre]     Lista los PDFs de la carpeta de Drive compartida
  drive buscar <nombre>           Busca un archivo por nombre exacto en Drive
  drive descargar <nombre>        Descarga el archivo a documentosReferencia/
  procesar [idEmpresa]            Flujo completo: listar guías, verificar cada una
                                  con su id_sunat y buscar su PDF en Drive por serie-número

Ejemplos:
  node server.js listar
  node server.js verificar 41a7d0ab-f69b-4c71-91e0-0ef5472f65c4
  node server.js drive listar
  node server.js drive buscar 20492641431-2026-09-22-20605950842-09-TR30-00001320.pdf
  node server.js procesar 01
`;

function obtenerSerieNumero(nombreArchivo) {
  const match = (nombreArchivo || '').match(/(-09-|\/09\/)([A-Z0-9]+)-(\d+)/i);
  if (!match) return null;
  return { serie: match[2], numero: match[3] };
}

async function comandoListar(idEmpresa) {
  logger.info(`Obteniendo guías pendientes (idEmpresa=${idEmpresa})...`);
  const guias = await documentoRepository.getGuiasPendientes(idEmpresa);
  if (guias.length === 0) {
    logger.warn('No hay guías pendientes');
    return;
  }
  console.table(
    guias.map((g) => ({
      id: g.iddocumento,
      serie: g.serie_doc?.trim(),
      numero: g.numero_doc?.trim(),
      ticket: g.id_sunat,
      estado: g.estado,
      fecha: g.fecha_doc,
    }))
  );
}

async function comandoVerificar(ticket) {
  if (!ticket) {
    console.error('Indique el ticket: node server.js verificar <ticket>');
    return process.exit(1);
  }
  logger.info(`Consultando estado en SUNAT (ticket: ${ticket})...`);
  const resultado = await sunatGreService.consultarEstado(ticket);
  console.table(resultado);
  if (resultado.qrUrl) logger.info(`QR URL: ${resultado.qrUrl}`);
}

async function comandoDriveListar(filtroNombre) {
  logger.info(
    `Listando carpeta de Drive (id: ${driveService.folderId})${filtroNombre ? `, filtro: "${filtroNombre}"` : ''}...`
  );
  const archivos = await driveService.listar(filtroNombre || '');
  if (archivos.length === 0) {
    logger.warn('No se encontraron archivos');
    return;
  }
  console.table(
    archivos.map((a) => ({
      id: a.id,
      nombre: a.name,
      mime: a.mimeType,
      tamaño: a.size ? `${(a.size / 1024).toFixed(0)} KB` : '',
    }))
  );
}

async function comandoDriveBuscar(nombre) {
  if (!nombre) {
    console.error('Indique el nombre: node server.js drive buscar <nombre>');
    return process.exit(1);
  }
  logger.info(`Buscando en Drive: "${nombre}"`);
  const resultado =
    (await driveService.buscarPorNombre(nombre)) ||
    (await driveService.buscarContiene(nombre));
  const archivo = Array.isArray(resultado) ? resultado[0] : resultado;
  if (!archivo) {
    logger.warn(`No se encontró "${nombre}" en Drive`);
    return;
  }
  console.table([archivo]);
}

async function comandoDriveDescargar(nombre) {
  const drive = await driveService.autenticar();
  const encontrado =
    (await driveService.buscarPorNombre(nombre)) ||
    (await driveService.buscarContiene(nombre));
  const archivo = Array.isArray(encontrado) ? encontrado[0] : encontrado;
  if (!archivo) {
    logger.warn(`No se encontró "${nombre}" en Drive`);
    return;
  }
  const rutaNueva = path.join(__dirname, '../documentosReferencia/' + archivo.name);
  await driveService.descargar(archivo.id, rutaNueva);
  logger.info(`Descargado: ${rutaNueva}`);
}

async function comandoProcesar(idEmpresa) {
  logger.info(`Flujo completo iniciado (idEmpresa=${idEmpresa})`);
  const guias = await documentoRepository.getGuiasPendientes(idEmpresa);
  logger.info(`Encontradas ${guias.length} guía(s)`);

  for (const guia of guias) {
    const serie = (guia.serie_doc ?? guia.serie ?? '').trim();
    const numero = (guia.numero_doc ?? guia.nrodoc ?? '').trim();
    const ticket = guia.id_sunat;
    const identificador = `${serie}-${numero}`;

    if (!ticket) {
      logger.warn(`${identificador}: sin ticket (id_sunat), no se puede verificar`);
      continue;
    }

    logger.info(`${identificador}: verificando en SUNAT (ticket ${ticket})...`);
    let resultado;
    try {
      resultado = await sunatGreService.consultarEstado(ticket);
    } catch (error) {
      logger.error(`${identificador}: error consultando SUNAT: ${error.message}`);
      continue;
    }

    if (resultado.estado === '0') {
      logger.info(`${identificador}: ACEPTADO por SUNAT` + (resultado.qrUrl ? ' - QR obtenido' : ''));
      if (!resultado.cdr) {
        logger.warn(`${identificador}: SUNAT no devolvió CDR en esta consulta`);
      }
    } else {
      logger.warn(`${identificador}: estado SUNAT = ${resultado.estado} (${resultado.descripcion})`);
    }

    // En Drive el nombre lleva: <rucEmpresa>-<fecha>-<rucEntidad>-09-<serie>-<numero>.pdf
    // ej: 20492641431-2026-09-22-20251729574-09-TR30-00001321.pdf.
    // El RUC/DNI del cliente (rucEntidad) y la fecha salen del detalle del documento.
    let patrones = [`09-${identificador}.pdf`, identificador];
    try {
      const detalle = (
        await documentoRepository.getDetalleDocumento(
          idEmpresa,
          guia.idoficina,
          '030009',
          serie,
          numero
        )
      )[0];
      if (detalle) {
        const fecha = detalle.fechaemision instanceof Date
          ? detalle.fechaemision.toISOString().slice(0, 10)
          : String(detalle.fechaemision || '').slice(0, 10);
        const nombreEsperado =
          `${config.sunat.ruc}-${fecha}-${String(detalle.nropersoneria || '').trim()}` +
          `-09-${identificador}.pdf`;
        patrones.unshift(nombreEsperado);
        logger.info(`${identificador}: nombre esperado en Drive: ${nombreEsperado}`);
      }
    } catch (error) {
      logger.warn(`${identificador}: no se pudo armar el nombre desde la BD: ${error.message}`);
    }
    let archivo = null;
    for (const patron of patrones) {
      const encontrado =
        (await driveService.buscarPorNombre(patron)) ||
        (await driveService.buscarContiene(patron));
      archivo = Array.isArray(encontrado) ? encontrado[0] : encontrado;
      if (archivo) break;
    }

    if (!archivo) {
      logger.warn(`${identificador}: no se encontró PDF en Drive, se omite`);
      continue;
    }

    logger.info(`${identificador}: PDF encontrado en Drive [${archivo.id}] ${archivo.name}`);

    if (!resultado.qrUrl || !resultado.rutaCdr) {
      logger.warn(`${identificador}: sin qrUrl/CDR válidos de SUNAT, se omite`);
      continue;
    }

    const dirTrabajo = path.join(__dirname, '../documentosReferencia');
    const rutaDescargada = path.join(dirTrabajo, archivo.name);
    await driveService.descargar(archivo.id, rutaDescargada);
    logger.info(`${identificador}: PDF descargado a ${rutaDescargada}`);

    const rutaFinal = path.join(
      dirTrabajo,
      archivo.name.replace(/\.pdf$/i, '') + '-qr.pdf'
    );
    await qrService.reemplazar({
      entrada: rutaDescargada,
      contenidoQr: resultado.qrUrl,
      salida: rutaFinal,
    });
    logger.info(`${identificador}: PDF con QR del CDR listo → ${rutaFinal}`);

    // Sube el PDF nuevo con el mismo nombre + "_2" (Drive no permite borrar
    // de momento) y el CDR con extensión .xml.
    const nombrePdfDrive = archivo.name.replace(/\.pdf$/i, '') + '_2.pdf';
    await driveService.subir(rutaFinal, nombrePdfDrive);
    const nombreCdr = archivo.name.replace(/\.pdf$/i, '.xml');
    await driveService.subir(resultado.rutaCdr, nombreCdr);
    logger.info(`${identificador}: PDF y CDR subidos a Drive (${nombrePdfDrive}, ${nombreCdr})`);
  }

  logger.info('Flujo completado');
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2);

  if (!comando || comando === 'procesar') {
    await comandoProcesar(resto[0] || '01');
    await closeConnection();
    return;
  }

  switch (comando) {
    case 'listar':
      await comandoListar(resto[0] || '01');
      break;
    case 'verificar':
      await comandoVerificar(resto[0]);
      break;
    case 'drive':
      switch (resto[0]) {
        case 'listar':
          await comandoDriveListar(resto[1]);
          break;
        case 'buscar':
          await comandoDriveBuscar(resto[1]);
          break;
        case 'descargar':
          await comandoDriveDescargar(resto[1]);
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

  await closeConnection();
}

main().catch((error) => {
  logger.error(`Error en ejecución: ${error.message}`);
  console.error(error);
  process.exit(1);
});