# Tarea GUIAS - Guías de Remisión Electrónicas (SUNAT)

Aplicación **interna**, sin API ni interfaz gráfica. Se ejecuta manualmente con `node src/server.js`.

Recorre **todas las empresas** conectadas en `admin.dbo.Conexiones`, consulta el CDR en SUNAT,
reemplaza el QR del PDF en Drive y guarda la URL del QR en la BD de cada empresa.

## Cómo funciona

El punto de partida es el stored procedure **`spPyOValidaGuia`** (BD central `admin`), que devuelve
una fila por cada guía que tiene el QR sin reemplazar:

```
spPyOValidaGuia
  -> { ID, idEmpresa, idDocumento, Estado, DriveID }
```

- `ID` = `Conexiones.id`: con qué servidor/BD hay que conectarse para leer ese documento.
- `DriveID` = **la carpeta de Drive donde está el PDF de esa guía**. No hay una carpeta única: cada
  guía trae la suya y es la cuenta de servicio `driveenviopdf-7a4b8936208f.json` la que tiene acceso
  a ellas. Varias guías de la misma empresa suelen compartir `DriveID`.
- `Estado` **no** es el estado del documento, es una clasificación del SP:
  - `Estado = 1` → emitido pero **no** aceptado por SUNAT. **No se procesan**, los sube el ERP.
  - `Estado = 2` → aceptado por SUNAT, solo falta el QR. **Estos se procesan.**
- El SP filtra `len(codigovalidacion) = 0`, así que al guardar ahí la URL del QR el documento deja
  de salir en la siguiente corrida. No hay que marcar nada más.
- **`codigovalidacion` es `nvarchar(490)` y ahí va la URL del QR.** La URL que devuelve SUNAT
  (`https://e-factura.sunat.gob.pe/.../descargaqr?hashqr=...`) mide unos 190 caracteres y entra
  holgada. La columna hace de marcador y de enlace: el SP deja de devolver la guía y además queda
  el link que se puede consultar. Para las guías (`idtipo = '09'`) el ERP no la usa.

  > Antes era `char(4)` y la URL no entraba (`String or binary data would be truncated`). Fue un
  > `ALTER TABLE` en las 10 bases; comprobado el 2026-09-30 que las 10 están en `nvarchar(490)`.

### La corrida diaria: `todo`

```bash
node src/server.js todo
```

Es el comando para el día a día: hace las dos cosas seguidas.

1. **Pide el listado a `spPyOValidaGuia`** y lo guarda en `guias-pendientes.json`.
2. **Procesa** todo lo que devuelva (lo de `procesar`: SUNAT, QR en Drive, CDR, marca en la BD).
3. **Deja todo listo para la próxima corrida**: reescribe el archivo de pendientes con lo que
   *no* se pudo terminar, borra `tmp/` y `CDR/`, cierra las conexiones y sale con código 1 si algún
   documento falló.

Sobre el punto 1: el permiso `EXECUTE` del SP es **opcional** acá. Con el usuario configurado en
`.env` ya está habilitado (se verificó el 2026-09-29: el SP devolvió 273 guías de 5 empresas, todas
con `DriveID`). Si se llegara a perder ese permiso, `todo` lo avisa y sigue con el listado que ya
está en disco, así que la corrida funciona igual; lo que se pierde es que las guías que SUNAT haya
aceptado desde la última vez no se vean hasta que se recupere el permiso.

Dos corridas simultáneas no se pisan: `todo` toma un candado en `tmp/.corrida.lock`. Si el proceso
que lo dejó ya no existe (matado a la fuerza), la corrida siguiente lo recupera sola.

### El SP se corre una vez

`spPyOValidaGuia` existe solo en `admin`. El usuario con que la app entra a las BD de las empresas
es otro distinto, así que el permiso `EXECUTE` puede no tenerlo: por eso `todo` está armado para
funcionar de las dos maneras, con y sin ese permiso.

```bash
node src/server.js todo        # la corrida diaria: pide el listado y procesa
node src/server.js exportar    # solo refrescar el listado (con usuario con permiso)
node src/server.js procesar    # procesar el listado ya guardado, sin tocar el SP
```

Si se prefiere generarlo a mano desde SSMS ("Guardar resultados como" → CSV), el archivo se puede
poner en `guias-pendientes.csv` con las columnas `ID, idEmpresa, idDocumento, Estado, DriveID`; la
app lo lee igual. Para cambiar la ruta, `PENDIENTES_ARCHIVO` en el `.env`.

### El flujo, empresa por empresa

Por cada guía pendiente:

1. `Conexiones` (por `ID`) → servidor, BD, usuario y clave de esa empresa.
2. En la BD de la empresa: la fila de `documentos_sve` (de ahí sale el ticket, `id_sunat`).
3. En la BD de la empresa: `v_empresas` → **credenciales de SUNAT** de esa empresa.
4. Consulta a SUNAT `GET .../gem/comprobantes/envios/{ticket}` → CDR → `qr_url`.
5. Busca el PDF en la carpeta `DriveID` de esa guía y reemplaza el QR.
6. Sube a **esa misma carpeta** el PDF nuevo (mismo nombre) y el CDR (mismo nombre, `.xml`).
7. Guarda la URL del QR en `documentos_sve.codigovalidacion`.

Las guías se procesan **empresa por empresa**: se abre la conexión, se procesa todo lo de esa
empresa y se cierra antes de pasar a la siguiente. La conexión a `admin` solo se usa para leer
`Conexiones`.

## Si algo falla

Ningún problema frena la corrida: **el documento se omite y se sigue con el siguiente**, y el resto
de empresas se procesa normal. Al final se imprime un resumen con el motivo de cada omisión.

| Situación | Qué hace |
|-----------|----------|
| La fila no trae `DriveID` | Omite ese documento (`sin DriveID en el listado`); hay que regenerar el listado |
| El PDF no está en la carpeta de Drive | Omite ese documento (`sin PDF en Drive`) |
| Una carpeta no existe o no está compartida con la cuenta de servicio | Lo detecta en la primera guía de esa carpeta, avisa una vez y omite el resto sin repetir la llamada. **Las otras carpetas siguen normal** |
| La BD de una empresa no responde o las credenciales están mal | Omite todas sus guías de una y pasa a la siguiente empresa |
| El `ID` no existe en `Conexiones` | Lo omite y sigue |
| SUNAT responde con error, o sin ticket, o sin URL de QR | Lo omite para la próxima corrida |
| Falla cualquier paso a mitad de un documento | Corta **ese** documento y sigue con el siguiente |

El orden de escritura importa, para que una falla nunca deje un documento marcado sin estar listo:

```
descargar -> reemplazar QR -> subir PDF -> subir CDR -> guardar la URL en codigovalidacion
```

Si se corta en cualquier punto, `codigovalidacion` sigue vacío y el documento vuelve a salir en la
próxima corrida.

Los PDF que se descargan para cambiarles el QR van a `tmp/` y los CDR a `CDR/`. Los dos se borran: el
PDF apenas se sube, y el CDR al terminar la corrida (ya está en Drive y se puede volver a bajar de
SUNAT). El QR de una guía es siempre el mismo, así que reprocesar un documento que quedó a medias no
hace daño.

## Comandos

```bash
node src/server.js exportar [--todos]     # corre el SP y guarda el listado
node src/server.js                       # procesar (default)
node src/server.js probar                # prueba de punta a punta, NO escribe nada
node src/server.js probar --conexiones 6 # una guía de 6 conexiones distintas
node src/server.js procesar --simular    # no escribe nada, solo informa
node src/server.js procesar --refrescar   # vuelve a correr el SP antes de procesar
node src/server.js procesar --simular --limite 10
node src/server.js procesar --conexion 30 # solo una empresa
node src/server.js procesar --empresa 01  # solo una idEmpresa
node src/server.js pendientes             # qué se procesaría
node src/server.js listar                 # empresas con Guia = 1
node src/server.js verificar 30 01 260000802500  # consultar una guía puntual
node src/server.js drive listar <driveId> [filtro]
node src/server.js drive buscar <driveId> <nombre>
node src/server.js drive descargar <driveId> <nombre>
```

## La prueba de punta a punta: `probar`

`node src/server.js probar` corre el flujo **completo sin escribir nada** en Drive ni en la BD,
para ver en qué estado está todo. Toma **una guía de cada conexión** (4 por defecto, una de cada
empresa: distinto servidor, BD y credenciales de SUNAT) y por cada una:

1. Abre la BD de la empresa, lee `documentos_sve` y `v_empresas`, y consulta a SUNAT.
2. Busca el PDF en la carpeta `DriveID` de esa guía.
3. Baja el PDF, genera el PDF con el QR de SUNAT (`reemplazar-qr`).
4. **Lee el QR del PDF que está hoy en Drive** y **el QR del PDF nuevo**, y los compara con la
   URL que devolvió el CDR.
5. Comprueba que la URL del QR siga respondiendo en SUNAT (informativo).

Al final imprime una tabla y dice cuántas quedaron verificadas:

```
┌──────────┬───────────────┬───────┬─────────────────────────────┬──────────────────────────────────┬──────────────────┐
│ conexión │ guía          │ SUNAT │ QR que tiene hoy            │ QR nuevo = SUNAT                 │ URL responde    │
├──────────┼───────────────┼───────┼─────────────────────────────┼──────────────────────────────────┼──────────────────┤
│ 7        │ 'T001-00005258' │ '0' │ '20607129470|09|T001 |000…' │ 'sí'                             │ 'HTTP 200'       │
└──────────┴───────────────┴───────┴─────────────────────────────┴──────────────────────────────────┴──────────────────┘
```

Que el QR nuevo coincida con la URL del CDR es la comprobación fuerte: significa que el PDF que se
va a subir lleva el QR correcto. La columna "QR que tiene hoy" sirve para ver que el PDF vigente
llevaba el dato equivocado y que por eso hay que procesarlo.

Necesita `pdftoppm` (poppler-utils) y `zbarimg` (zbar-tools) para leer los QR, que en el flujo
real no hacen falta. Si no están, avisa y el resto de la prueba sigue.

Los comandos `drive` toman el **id de la carpeta** (el `DriveID` de la guía). Para ver el de una
guía puntual:

```bash
node src/server.js pendientes --limite 5    # la columna DriveID viene en la tabla
```

> `exportar` sin `--todos` guarda solo las de `Estado = 2`. Con `--todos` incluye también las de
> `Estado = 1`, que no se procesan.

## Estado de los pasos

| # | Paso | Estado | Dónde |
|---|------|--------|-------|
| 1 | Correr el SP una vez y guardar el listado | ✅ | `conexion.repository.js → spPyOValidaGuia` (filtra `Estado = 2`) + `pendientes.service.js → exportar()` |
| 2 | Conectarse a la BD de cada empresa | ✅ | `erp-connection.js` (pool por fila de `Conexiones`) |
| 3 | Leer el documento y su ticket | ✅ | `documento.repository.js → getPorIdDocumento()` |
| 4 | Credenciales SUNAT de cada empresa | ✅ | `empresa.repository.js → v_empresas` |
| 5 | Consultar estado y obtener el CDR | ✅ | `sunat-gre.service.js` |
| 6 | Obtener el `qr_url` del CDR | ✅ | `cdr.service.js → extraerQrUrl()` (`cbc:DocumentDescription`) |
| 7 | Buscar el PDF en la carpeta `DriveID` | ✅ | `drive.service.js` |
| 8 | Reemplazar el QR en el PDF | ✅ | `qr.service.js` → `reemplazar-qr/` |
| 9 | Subir PDF + CDR a la carpeta `DriveID` | ✅ | `drive.service.js → subir()` (usa `files.update`; no borra nada) |
| 10 | Guardar la URL del QR en `codigovalidacion` | ✅ | `documento.repository.js → guardarQrUrl()` (URL completa del CDR) |
| 11 | Flujo completo sin escribir (QR verificado) | ✅ | `node src/server.js probar` |

## Estructura

```
├── server.js                            # CLI — único punto de entrada
├── guias-pendientes.json                # Snapshot de spPyOValidaGuia (lo genera `exportar`)
├── driveenviopdf-7a4b8936208f.json      # Cuenta de servicio de Drive (acceso a las carpetas DriveID)
├── src/
│   ├── config/index.js                  # .env (db, pendientes, cdr, drive). SIN credenciales SUNAT
│   ├── database/
│   │   ├── connection.js                # Pool de la BD central (admin)
│   │   ├── erp-connection.js            # Pool por empresa, desde Conexiones
│   │   ├── conexion.repository.js       # Conexiones + spPyOValidaGuia (solo `exportar`)
│   │   ├── empresa.repository.js        # Credenciales SUNAT desde v_empresas
│   │   └── documento.repository.js      # documentos_sve (leer, detalle, marcar)
│   ├── services/
│   │   ├── pendientes.service.js        # exportar/cargar el snapshot (JSON o CSV)
│   │   ├── sunat-auth.service.js        # Token OAuth2, cacheado por empresa
│   │   ├── sunat-gre.service.js         # Consulta estado por ticket + CDR/QR
│   │   ├── cdr.service.js               # Descomprime CDR, extrae qr_url, borra/limpia
│   │   ├── zip.service.js               # Descompresión de ZIP
│   │   ├── qr.service.js                # Llama a reemplazar-qr
│   │   └── drive.service.js             # Listar/buscar/descargar/subir, por carpeta (DriveID)
│   └── utils/logger.js
└── reemplazar-qr/                       # Proyecto independiente para reemplazar el QR
```

## Detalles que no son evidentes

**Las credenciales de SUNAT no están en el `.env`.** Son por empresa y están en `v_empresas` de la
BD de cada una:

| Columna | Uso |
|---------|-----|
| `ruc` | RUC emisor (prefijo del nombre del PDF en Drive) |
| `usuariosol` / `clavesol` | Credenciales SOL del password grant |
| `nomcertificadojks` | `client_id` de la API GRE |
| `clacertificadojks` | `client_secret` de la API GRE |

Las columnas se llaman "certificado" pero guardan el par OAuth2. Los certificados PFX de verdad
(`nomcertificadopfx` / `clacertificadopfx`) no se usan: el firmado se retiró el 2026-09-23.

**`spMuestraComprobanteGuia` pide el idtipo `'030009'`, no `'09'`.** `'09'` es el de
`documentos_sve.idtipo`. Con el valor equivocado devuelve 0 filas y el nombre del PDF en Drive no
se arma, y el documento se omite.

**El nombre del PDF en Drive** es `<rucEmisor>-<fecha>-<rucCliente>-09-<serie>-<numero>.pdf`. La
fecha y el `rucCliente` salen de `spMuestraComprobanteGuia`; el `rucEmisor` de `v_empresas.ruc`.

**Drive: cada guía tiene su propia carpeta.** `spPyOValidaGuia` devuelve el `DriveID` de la guía y
todo Drive se hace contra esa carpeta: buscar el PDF, subir el PDF con el QR nuevo y subir el CDR
con el mismo nombre en `.xml`. No hay una carpeta fija en la app: `driveid.txt` ya no se usa.

La cuenta de servicio es **`driveenviopdf-7a4b8936208f.json`** (`usuariopdfdrive-630@driveenviopdf`).
Tiene que tener acceso a cada `DriveID` como lector **y** escritor. Si a una carpeta no tiene
acceso, sus guías se omiten con `Drive no accesible: ...` y las de las demás carpetas se siguen
procesando.

Una guía sin `DriveID` en el listado se omite (`sin DriveID en el listado`): es señal de que el
listado se generó con un SP viejo, y se arregla regenerándolo con `exportar`.

**El CDR se sube a la carpeta de la guía con el nombre del PDF y extensión `.xml`.** O sea, junto al
`...-09-T001-00005258.pdf` queda un `...-09-T001-00005258.xml`. El nombre del CDR que trae SUNAT
(`R-<ruc>-09-<serie>-<nro>.xml`) solo se usa como nombre de archivo local.

**El CDR local es temporal.** Se descarga a `CDR/`, se sube a Drive y se borra: cada CDR se elimina
apenas se sube y la carpeta entera se vacía al terminar `procesar`. Se puede volver a bajar de SUNAT
cuando haga falta.

**Orden de escritura:** el PDF se sube a Drive *antes* de guardar `codigovalidacion`. Si el UPDATE
se hiciera primero y la subida fallara, el documento quedaría marcado sin tener el QR corregido.

**Reemplazo de QR** (proyecto `reemplazar-qr/`):

```bash
cd reemplazar-qr
node src/index.js --entrada <comprobante.pdf> --qr <qr_url> --salida <salida.pdf>
```

Detecta el QR del PDF, lo borra y lo reemplaza por uno nuevo. Requiere `pdftoppm` (poppler-utils).

## Pendientes

- **Regenerar `guias-pendientes.json` con `exportar`.** El archivo actual se generó emulando el SP
  (con las credenciales de `Conexiones`) y **no tiene la columna `DriveID`**, así que todavía no se
  puede correr de verdad. Se necesita un usuario con permiso `EXECUTE` sobre `spPyOValidaGuia`.
- **Prueba de punta a punta.** Con el listado nuevo, correr `procesar` sin `--simular` sobre las
  ~265 guías: es la única pata que escribe (subir PDF y CDR a Drive, guardar `codigovalidacion`).
