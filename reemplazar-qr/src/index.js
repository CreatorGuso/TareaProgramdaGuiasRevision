#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");
const QRCode = require("qrcode");
const { PDFDocument, rgb } = require("pdf-lib");

function uso() {
  console.log(`Uso:
  node src/index.js --entrada <comprobante.pdf> --qr <contenido nuevo> [opciones]

Opciones:
  -e, --entrada   PDF del comprobante a procesar (obligatorio)
  -q, --qr        Contenido del QR nuevo: texto o URL (obligatorio)
  -s, --salida    PDF de salida (por defecto: <entrada>-qr-nuevo.pdf)
  -p, --pagina    Número de página donde está el QR (por defecto: se busca en todas,
                  desde la 1, y se usa la primera donde aparezca; hay guías de 2
                  hojas con el QR en la segunda)
  -d, --dpi       Resolución del render para detectar el QR (por defecto: 150)
  -t, --tmp       Carpeta donde crear el render temporal (por defecto: os.tmpdir()).
                  mkdtemp no crea el padre, así que si esa carpeta no existe el
                  render falla; conviene apuntar a una que sí exista.
  -b, --pdftoppm  Ruta o nombre del binario pdftoppm (por defecto: pdftoppm, o sea
                  el que esté en el PATH). En la tarea programada de Windows el PATH
                  no lo trae, así que ahí hay que pasar la ruta absoluta.
  -h, --ayuda     Muestra esta ayuda

Ejemplo:
  node src/index.js -e comprobante.pdf -q "https://ejemplo.com/verificar"`);
}

function parsearArgs(argv) {
  const args = {
    entrada: null,
    qr: null,
    salida: null,
    pagina: null,
    dpi: 150,
    tmp: null,
    pdftoppm: "pdftoppm",
  };
  const flags = {
    "-e": "entrada",
    "--entrada": "entrada",
    "-q": "qr",
    "--qr": "qr",
    "-s": "salida",
    "--salida": "salida",
    "-p": "pagina",
    "--pagina": "pagina",
    "-d": "dpi",
    "--dpi": "dpi",
    "-t": "tmp",
    "--tmp": "tmp",
    "-b": "pdftoppm",
    "--pdftoppm": "pdftoppm",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--ayuda") {
      uso();
      process.exit(0);
    }
    const key = flags[arg];
    if (!key) {
      console.error(`Argumento desconocido: ${arg}`);
      uso();
      process.exit(1);
    }
    const valor = argv[++i];
    if (valor === undefined) {
      console.error(`Falta el valor de ${arg}`);
      process.exit(1);
    }
    args[key] = valor;
  }
  args.pagina = args.pagina === null ? null : parseInt(args.pagina, 10);
  args.dpi = parseInt(args.dpi, 10);
  return args;
}

function renderizarPagina(pdfPath, pagina, dpi, directorio, pdftoppm) {
  const salida = path.join(directorio, "pagina");
  try {
    execFileSync(pdftoppm, [
      "-png",
      "-r",
      String(dpi),
      "-f",
      String(pagina),
      "-l",
      String(pagina),
      "-singlefile",
      pdfPath,
      salida,
    ]);
  } catch (err) {
    // ENOENT es lo que sale cuando el binario no está en el PATH, que es lo que
    // pasa en la tarea programada de Windows. El mensaje de Node ("spawnSync
    // pdftoppm ENOENT") no dice nada útil, así que se traduce.
    if (err.code === "ENOENT") {
      throw new Error(
        `no se encontró pdftoppm ("${pdftoppm}"). Es de poppler-utils y hace ` +
          `falta siempre, también en producción: es lo que rasteriza el PDF para ` +
          `detectar el QR. Instalalo, o pasá la ruta absoluta con --pdftoppm.`
      );
    }
    throw err;
  }
  return `${salida}.png`;
}

function detectarQr(pngPath) {
  const png = PNG.sync.read(fs.readFileSync(pngPath));
  const resultado = jsQR(
    new Uint8ClampedArray(png.data),
    png.width,
    png.height,
    { inversionAttempts: "attemptBoth" }
  );
  if (!resultado) {
    return null;
  }
  const pts = [
    resultado.location.topLeftCorner,
    resultado.location.topRightCorner,
    resultado.location.bottomRightCorner,
    resultado.location.bottomLeftCorner,
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    contenido: resultado.data,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    anchoPx: png.width,
    altoPx: png.height,
  };
}

async function generarQrPng(texto, anchoPx) {
  return QRCode.toBuffer(texto, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: anchoPx,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));

  if (!args.entrada || !args.qr) {
    console.error("Debe indicar --entrada y --qr\n");
    uso();
    process.exit(1);
  }
  if (!fs.existsSync(args.entrada)) {
    console.error(`No existe el archivo: ${args.entrada}`);
    process.exit(1);
  }

  const salida =
    args.salida ||
    args.entrada.replace(/\.pdf$/i, "") + "-qr-nuevo.pdf";

  // mkdtemp crea la carpeta final pero no el padre, así que se asegura.
  const baseTmp = args.tmp || os.tmpdir();
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(baseTmp, "reemplazar-qr-"));
  try {
    const doc = await PDFDocument.load(fs.readFileSync(args.entrada));
    const totalPaginas = doc.getPageCount();

    // Sin --pagina se recorren todas: hay guías de 2 hojas con el QR en la
    // segunda. Se usa la primera página donde aparezca un QR.
    const candidatas = args.pagina
      ? [args.pagina]
      : Array.from({ length: totalPaginas }, (_, i) => i + 1);

    let qr = null;
    let numPagina = null;
    for (const n of candidatas) {
      console.log(`Leyendo: ${args.entrada} (página ${n} de ${totalPaginas})`);
      const pngPath = renderizarPagina(args.entrada, n, args.dpi, tmp, args.pdftoppm);
      qr = detectarQr(pngPath);
      if (qr) {
        numPagina = n;
        break;
      }
    }
    if (!qr) {
      console.error(
        args.pagina
          ? "No se detectó ningún QR en la página indicada."
          : `No se detectó ningún QR en ninguna de las ${totalPaginas} página(s).`
      );
      process.exit(2);
    }

    const escala = 72 / args.dpi;
    const pagina = doc.getPage(numPagina - 1);
    const { height: altoPdf } = pagina.getSize();

    const aPt = (v) => v * escala;
    const x = aPt(qr.minX);
    const ancho = aPt(qr.maxX - qr.minX);
    const alto = aPt(qr.maxY - qr.minY);
    const y = altoPdf - aPt(qr.maxY);

    const padding = Math.max(ancho, alto) * 0.06;
    const cx = x - padding;
    const cy = y - padding;
    const canAncho = ancho + padding * 2;
    const canAlto = alto + padding * 2;

    console.log(`QR original detectado en la página ${numPagina}: "${qr.contenido}"`);
    console.log(
      `  posición (pt): x=${x.toFixed(1)} y=${y.toFixed(1)} ` +
        `ancho=${ancho.toFixed(1)} alto=${alto.toFixed(1)}`
    );

    const tamQrPx = Math.max(200, Math.ceil(Math.max(canAncho, canAlto) * 4));
    const qrPng = await generarQrPng(args.qr, tamQrPx);

    pagina.drawRectangle({
      x: cx,
      y: cy,
      width: canAncho,
      height: canAlto,
      color: rgb(1, 1, 1),
      borderColor: rgb(1, 1, 1),
      borderWidth: 1,
    });

    const embebido = await doc.embedPng(qrPng);
    pagina.drawImage(embebido, {
      x: cx,
      y: cy,
      width: canAncho,
      height: canAlto,
    });

    fs.writeFileSync(salida, await doc.save());
    console.log(`QR nuevo: "${args.qr}"`);
    console.log(`Guardado: ${salida}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
