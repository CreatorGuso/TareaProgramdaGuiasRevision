# Historial de Desarrollo - Guías de Remisión Electrónicas

## Contexto General

Sistema para emitir Guías de Remisión Electrónicas (GRE) ante SUNAT (Perú) desde una API Node.js, conectando a una base de datos SQL Server existente que ya tiene la data de empresas y documentos.

**Fecha de inicio:** 2026-08-20

---

## Estado actual (2026-09-29)

App **CLI interna**, sin API ni emisión. Recorre las GRE de **todas** las empresas, consulta el CDR en
SUNAT, reemplaza el QR del PDF en Drive y guarda la `qr_url` en la BD de cada empresa.

```
spPyOValidaGuia --(1 vez, con permiso)--> guias-pendientes.json  (ID, idEmpresa, idDocumento, Estado, DriveID)
                                                  |
   procesar --> Conexiones --> BD de cada empresa --> v_empresas (credenciales)
             --> SUNAT --> CDR --> qr_url --> Drive (PDF + CDR, en la carpeta DriveID)
             --> documentos_sve.codigovalidacion
```

Puntos clave del diseño actual:

- El SP se corre **una sola vez**; su resultado queda en `guias-pendientes.json` (o `.csv`).
  `soporte` no tiene `EXECUTE` sobre él y no lo necesita para el flujo normal.
- Se procesa solo `Estado = 2`. `Estado = 1` son documentos que el ERP todavía sube a SUNAT.
- Las guías se agrupan por `Conexiones.id`: se abre la conexión, se procesa todo lo de esa empresa
  y se cierra antes de la siguiente.
- **Cada guía trae su propia carpeta de Drive** en la columna `DriveID` del SP. Todo lo de Drive
  (buscar el PDF, subir el PDF con el QR, subir el CDR) se hace contra esa carpeta, con la cuenta de
  servicio `driveenviopdf-7a4b8936208f.json`. Ya no existe una carpeta fija (`driveid.txt`).
- Las credenciales de SUNAT salen de `v_empresas` de cada BD, no de un `.env` central.
- Un fallo nunca frena la corrida: se omite el documento y se sigue. El documento queda
  **pendiente**, nunca marcado a medias.

### Estado de verificación

| Parte | Estado |
|-------|--------|
| Listado (`exportar` → archivo) | ✅ verificado con datos reales de las 10 empresas |
| Cambio de BD entre empresas | ✅ 2 servidores, 10 BDs |
| Credenciales por empresa (`v_empresas`) | ✅ 3 RUC, 3 `clientId`, 3 `usuarioSol` |
| OAuth2 + consulta a SUNAT | ✅ 3/3 documentos aceptados, CDR descargado |
| Extracción de `qr_url` | ✅ responde HTTP 200 en SUNAT |
| Reemplazo del QR en el PDF | ✅ el QR decodifica a la URL exacta (`zbarimg`) |
| Acceso a las carpetas `DriveID` | ✅ la cuenta nueva lista y encuentra los PDF de veryfrut |
| Subida a Drive + `codigovalidacion` | ⚠️ probado solo en la sesión del 2026-09-23; falta con la carpeta real |
| QR impreso en el PDF nuevo | ✅ 4/4 coinciden con la URL del CDR (`probar`) |

### Lo único que falta

**Regenerar `guias-pendientes.json`** con `exportar` usando un usuario con permiso `EXECUTE` sobre
`spPyOValidaGuia`: el archivo actual se generó emulando el SP y **no trae la columna `DriveID`**.
Con eso ya está y se puede correr la prueba de punta a punta sobre las ~265 guías.

### Índice de sesiones

| Fecha | Tema |
|-------|------|
| 2026-08-24 | Consulta por ticket, cadena de rechazos SUNAT |
| 2026-08-26 | Cobertura transporte privado vs público (3617 / 2485) |
| 2026-08-27 | Aceptación de TR20 (modalidad privada + M1/L) |
| 2026-08-28 | Rechazo 2573: formato real de la licencia |
| 2026-09-23 | Limpieza: se retira API/emisión, queda solo CLI |
| 2026-09-23 | Flujo `procesar` completo: QR + subida a Drive con `files.update` |
| 2026-09-28 | Multi-empresa vía `spPyOValidaGuia` |
| 2026-09-28 (2) | El SP se corre una vez y queda un archivo local |
| 2026-09-28 (3) | Robustez: ningún fallo frena la corrida |
| 2026-09-28 (4) | Prueba del flujo con 3 empresas |
| 2026-09-29 | La carpeta de Drive pasa a ser por guía (`DriveID` del SP) |
| 2026-09-29 (2) | `probar`: flujo completo sin escribir, con el QR verificado |
| 2026-09-29 (3) | `todo`: la corrida completa (SP + procesar) |
| 2026-09-30 | `codigovalidacion` ampliada a `nvarchar(490)`: se guarda la URL del QR, no una marca |

---

## Base de Datos (SQL Server existente)

### Tablas/Views relevantes:

- **`v_empresas`** - Datos de la empresa emisora
  - Campos clave: `idempresa`, `tiporuc`, `ruc`, `razonsocial`, `nombrecomercial`, `direccion`, `ubigeo`, `departamento`, `provincia`, `distrito`, `nomcertificadopfx`, `clacertificadopfx`, `usuariosol`, `clavesol`, `soapguia`, `correo`
  - Ejemplo: empresa_id=1, ruc=20507795642, GRUPO COMERCIALIZADOR DE FLORES S.A.C.

- **`documentos_sve`** - Documentos electrónicos (facturas, guías, etc.)
  - Campos: `idempresa`, `idoficina`, `iddocumento`, `idtipo`, `estado`, `respuesta_sunat`, `id_sunat`, `fecha_sunat`, `fecha_doc`, `serie_doc`, `numero_doc`, `identificacion`, `firma`, `valor_firma`, `coderror_sunat`
  - **Guías pendientes:** `estado = 2 AND idtipo = '09'`

- **`sppyomuestradocumentos`** - Stored procedure que retorna el detalle completo de un documento
  - Params: `@idEmpresa, @idOficina, @idDocumento`
  - Retorna datos del destinatario, transportista, vehículo, chofer, items, etc.

### Endpoint SOAP de SUNAT (campo soapguia de v_empresas):
`https://e-guiaremision.sunat.gob.pe/ol-ti-itemision-guia-gem/billService`

---

## Estructura actual del proyecto

```
├── .env                          # Config: BD central, pendientes, CDR, Drive. SIN credenciales SUNAT
├── .gitignore
├── package.json
├── guias-pendientes.json         # Snapshot de spPyOValidaGuia (lo genera `exportar`)
├── driveenviopdf-7a4b8936208f.json # Cuenta de servicio de Drive (acceso a las carpetas DriveID)
├── src/
│   ├── server.js                 # CLI — único punto de entrada
│   ├── config/index.js           # Variables de entorno
│   ├── database/
│   │   ├── connection.js         # Pool de la BD central (admin)
│   │   ├── erp-connection.js     # Pool por empresa, desde Conexiones
│   │   ├── conexion.repository.js # Conexiones + spPyOValidaGuia (solo `exportar`)
│   │   ├── empresa.repository.js  # Credenciales SUNAT desde v_empresas
│   │   └── documento.repository.js # documentos_sve (leer, detalle, guardarQrUrl)
│   ├── services/
│   │   ├── pendientes.service.js # exportar/cargar el snapshot (JSON o CSV)
│   │   ├── sunat-auth.service.js # Token OAuth2, cacheado por empresa
│   │   ├── sunat-gre.service.js  # Consulta estado por ticket + CDR/QR
│   │   ├── cdr.service.js        # Descomprime CDR, extrae qr_url, borra/limpia
│   │   ├── zip.service.js        # Descompresión de ZIP
│   │   ├── qr.service.js         # Llama a reemplazar-qr
│   │   └── drive.service.js      # Listar/buscar/descargar/subir, por carpeta (DriveID)
│   └── utils/logger.js
├── reemplazar-qr/                # Proyecto independiente para reemplazar el QR
├── documentosReferencia/         # Histórico de PDFs de ejemplo
├── tmp/                          # Temporales (se borra al salir)
└── logs/
```

> `driveid.txt` ya no se usa: la carpeta de cada guía la trae el SP en `DriveID`.
>
> La estructura anterior (`models/`, `xml/`, `controllers/`, `routes/`, Express) **ya no existe**:
> se eliminó junto con la emisión el 2026-09-23.

### Comandos

```bash
node src/server.js exportar [--todos]      # corre el SP y guarda el listado
node src/server.js procesar [opciones]     # flujo completo (default)
node src/server.js pendientes              # solo lista lo que se procesaría
node src/server.js listar                  # empresas de Conexiones con Guia = 1
node src/server.js verificar <con> <emp> <doc>
node src/server.js drive listar|buscar|descargar <driveId> [nombre]
```

Opciones de `procesar`: `--simular`, `--limite N`, `--conexion N`, `--empresa NN`, `--refrescar`,
`--todos`.

### Endpoints HTTP

Ninguno. Se retiró la API el 2026-09-23; la app es una CLI.


---

## Pendiente / Por hacer

1. **Regenerar `guias-pendientes.json` con `exportar`.** El archivo actual se generó emulando el
   SP (con las credenciales de `Conexiones`) porque `soporte` no tiene `EXECUTE` sobre
   `spPyOValidaGuia`. Los datos son equivalentes, pero **no trae la columna `DriveID`**: hasta que se
   regenere, `procesar` omite todo con `sin DriveID en el listado`.

2. **Correr las pruebas de punta a punta** una vez regenerado el listado, sobre las ~265 guías, sin
   `--simular`. Es la única pata que sigue sin probar de punta a punta: subir el PDF y el CDR a la
   carpeta `DriveID` y guardar `codigovalidacion`.

3. **Pruebas unitarias.** Hoy la cobertura es manual: scripts de prueba contra SUNAT y fixtures de
   JSON/CSV para `pendientes.service.js`. Vale la pena un `npm test` para el parser de CSV y para
   `clasificarError()` de Drive.

4. **Revisar la seguridad del repo.** `driveenviopdf-7a4b8936208f.json` y
   `proyectoalmacenamientowhatsapp-5798b0480329.json` están **versionados en git** y contienen la
   clave privada de la cuenta de servicio. Sacarlos del índice de git y agregarlos al `.gitignore`.
   (No se hizo en esta sesión porque implica `git rm --cached` de archivos ya subidos.)

---

## Dependencias Node.js instaladas

| Paquete | Uso |
|---------|-----|
| dotenv | Variables `.env` |
| mssql | SQL Server (BD central + pools por empresa) |
| googleapis | Google Drive (service account) |
| winston | Logging a `logs/` |
| jszip | Descomprimir el ZIP del CDR de SUNAT |

Externo al proyecto: **`reemplazar-qr/`**, que usa `pdf-lib` y necesita `pdftoppm`
(`poppler-utils`) en el sistema. `zbarimg` solo se usó para verificar el QR en las pruebas, no es
necesario en producción.

> **`reemplazar-qr/` no es una herramienta de prueba: está en el flujo real.** Es el paso 2 de los
> 5 de `procesar` (bajar el PDF de Drive → **reemplazar el QR** → subir el PDF → subir el CDR →
> marcar `codigovalidacion`), invocado como proceso hijo desde `qr.service.js` →
> `reemplazar-qr/src/index.js`. Sin él ninguna guía queda con el QR de SUNAT, así que en
> producción hacen falta sus 4 dependencias npm (`jsqr`, `pdf-lib`, `pngjs`, `qrcode`) **y
> `pdftoppm`**. Lo que sí es solo de prueba es `QrService.leerQr()` (`zbarimg`), que corre únicamente
> en el comando `probar`. Por ser un proyecto aparte con su propio `package.json` y su
> `node_modules/`, hay que instalar también las dependencias de `reemplazar-qr/` al desplegar.

Las dependencias de emisión (`express`, `soap`, `xml-crypto`, `node-forge`, `xmlbuilder2`, `cors`)
se uninstalled el 2026-09-23 al retirar la API.

---

## Notas del usuario

- El git del workspace (`guiassunatapi/greenter`) NO es del usuario, no hacer push
- La app es **interna y manual**: sin API ni interfaz gráfica
- Solo se procesan las guías con `Estado = 2`; las de `Estado = 1` las sube el ERP a SUNAT
- La carpeta de Drive se deja para el final
- Las credenciales de SUNAT se leen de `v_empresas` de cada BD; no van en el `.env`
  (las que estaban ahí se quitaron el 2026-09-28)
- Si algo falla, se omite el documento y se sigue con el siguiente


---

## Sesión 2026-08-24 — Consulta por ticket + cadena de rechazos SUNAT resueltos

**Nota:** las secciones anteriores reflejan el estado inicial (20-ago). Todo lo de abajo está implementado y probado contra producción SUNAT.

### Contexto de la sesión

- BD real: SQL Server `prueba_kaiser` @ `3.144.237.208` (creds en `.env`). SP usado: `spmuestracomprobanteguia`.
- Guía de prueba: **TR30-00001186**, `iddocumento='260000674000'`, empresa emisora RUC **20492641431**, modalidad **transporte privado** (`modTraslado='02'`, `TRANSPORTISTAS.tipotransporte = 0`).
- Referencia autoritativa de estructura XML: `greenter/packages/xml/src/Xml/Templates/despatch2022.xml.twig`; muestras válidas en `greenter/packages/xml-parser/tests/Resources/guias/`.

### 1. Funcionalidad: consulta de estado por ticket (completa)

- `src/database/documento.repository.js`
  - Nuevo `getByTicket(ticket)` (busca por `id_sunat`)
  - `getGuiasPendientes` ahora filtra `estado IN ('2','3')` (pendientes + con ticket)
- `src/controllers/guia.controller.js` — `consultarEstado` sincroniza BD según respuesta SUNAT:
  - `codRespuesta '0'` → `estado='1', respuesta_sunat=0` (+ guarda CDR si viene `arcCdr`)
  - `'98'` (en proceso) → `estado='3', respuesta_sunat=98`
  - `'99'` (rechazo) → `estado='5', respuesta_sunat=99, coderror_sunat=numError`
  - Tipos SQL corregidos en `actualizarEnvio`: `estado Char(1)`, `respuestaSunat Int`, `idSunat VarChar(50)`, `codErrorSunat Char(4)` (antes fallaba por tipos)
- `public/index.html` (vista completa):
  - Toolbar: input ticket + botón Consultar
  - Por fila (estado 3): botón "Consultar" que usa el ticket guardado (`normalizar` mapea `id_sunat` → `ticket`)
  - Diálogo `dlgEstado`: badge de estado, descripción del error, descarga CDR (zip decodificado de `arcCdr`) y JSON
  - CSS `.btn-consultar`

### 2. Cadena de rechazos SUNAT resueltos (en orden)

| Error | Causa | Fix |
|-------|-------|-----|
| **0306** (#1) | Estructura Shipment desactualizada (formato pre-2022): TransportModeCode mal ubicado, transportista/chofer fuera de lugar, direcciones invertidas | `_addShipment` reescrito completo según `despatch2022.xml.twig`: `TransportModeCode` dentro de `ShipmentStage`; `CarrierParty` con `PartyLegalEntity(CompanyID=MTC)`; choferes como `DriverPerson` en stage; llegada en `Delivery/DeliveryAddress` y partida en `Delivery/Despatch/DespatchAddress`; nuevo `_addTransportHandlingUnits` (precintos como THU separados + vehículo con `TransportEquipment/ApplicableTransportMeans/AttachedTransportEquipment/ShipmentDocumentReference`); `_addPortLocation` con orden ID→LocationTypeCode→Name y attrs catálogo 63/64; helper genérico `_addAddress(parent, tag, direction)` |
| *(bug)* | Zona horaria: tedious/mssql devuelve datetime naive como instante UTC y `toLocaleDateString` corria la fecha un día | `_formatDate/_formatTime` usan getters UTC; si llega string se procesa con slice directo |
| *(bug)* | `actualizarEnvio` pasaba tipos SQL incorrectos | Ver arriba (controller) |
| **0306** (#2) | DespatchLine: `Description` fuera de `Item`, `OrderLineReference` después de `Item`, `AdditionalItemProperty` con NameCode antes de Name, `CommodityClassification` sin attrs catálogo | `cbc:Description` dentro de `cac:Item`; `OrderLineReference` antes de `Item`; Name antes de NameCode; `CommodityClassification` con attrs UNSPSC (`listID="UNSPSC" listAgencyID="11" listVersionID="22.0"` aprox.) |
| **1037** | Emisor/destinatario con estructura vieja (`PartyName` + `PartyTaxScheme`) | Reemplazado por estructura 2022: `PartyIdentification` con attrs catálogo 06 (`schemeName="Documento de Identidad" schemeURI=catálogo06`) + `PartyLegalEntity/cbc:RegistrationName` |
| **3347** | Se enviaba transportista en modalidad privada | `CarrierParty` (y datos transportista) SOLO si `modTraslado === '01'` (público). Con privado van chofer/placa en `ShipmentStage` |
| **2567** | Placa `"BDK - 778 "` rechazada; tras limpiar espacios seguía fallando `"BDK-778"` | **El guion NO es válido**: Anexo N°12 campo 44 dice "dato alfanumérico de 6 a 8 posiciones". `limpiarPlaca()` en `guia.mapper.js:24` ahora elimina TODO carácter no alfanumérico → `"BDK778"` |
| **3409** | `AddressTypeCode@listID` (establecimiento anexo punto llegada) recibía `destinatario.numDoc` que puede ser DNI (8 dígitos) | En `_addAddress` (builder.js): el nodo solo se emite si el ruc cumple `/^\d{11}$/`; con DNI u otro documento se omite completo |
| **2108** | "Presentación fuera de fecha": emisión e inicio de traslado del 20-ago, envío el 24-ago | **No era error del XML**: pasó todas las validaciones de contenido. Fix operativo: actualizar fechas y reenviar |

### 3. Estado actual y próximo paso

- El XML generado pasa TODAS las validaciones de contenido de SUNAT (los únicos rechazos restantes fueron de fecha).
- Pendiente inmediato: **reemitir TR30-00001186** (ya reseteada, ver comandos abajo) y confirmar `codRespuesta: '0'`. Luego probar consulta por ticket desde la vista.
- Al aceptarse: verificar que quede `estado='1'`, descargar/validar CDR.

### 4. Comandos operativos (gotchas)

```bash
# Levantar servidor (desde greenter-api/)
(setsid nohup npm start > /tmp/opencode/greenter-api.log 2>&1 < /dev/null &)
curl http://localhost:3000/health   # verificar
tail -f /tmp/opencode/greenter-api.log

# Matar servidor: usar fuser, NO pkill -f "node src/server.js"
# (el pkill se mata a sí mismo porque el comando aparece en la cmdline del shell y cuelga 120s)
fuser -k 3000/tcp
```

```sql
-- Resetear guía de prueba a pendiente
UPDATE documentos_sve SET estado='2', respuesta_sunat=0, coderror_sunat=''
WHERE iddocumento='260000674000';

-- Refrescar fechas (fuente de fechaemision/fechainicio del SP)
UPDATE guia_remision_cabecera SET fecha=GETDATE(), fechainicio=CONVERT(date, GETDATE())
WHERE idempresa='01' AND idoficina='01' AND iddocumento='260000674000';
```

- El SP lee fechas de `guia_remision_cabecera.fecha` (emisión) y `.fechainicio` (inicio traslado). La placa sale concatenada: `vehiculo.placavehiculo` + referencia (SP línea ~59).
- CDR decodificados de las pruebas quedan en `/tmp/opencode/cdr_out/`.

### 5. Lecciones aprendidas (reglas GRE 2022)

1. El template twig de Greenter es la fuente de verdad del orden/ubicación de nodos UBL — replicarlo exactamente evita errores 030x.
2. Placa: solo `[A-Z0-9]` de 6 a 8 posiciones (sin guion ni espacios).
3. Establecimiento anexo (`AddressTypeCode@listID`): solo con RUC de 11 dígitos.
4. Transportista solo en modalidad pública ('01'); en privada el vehículo/chofer van en `ShipmentStage`.
5. Fechas siempre en UTC al formatear datetimes de SQL Server.
6. Ventana de envío GRE: pocos días desde la emisión (error 2108 si se excede) — para pruebas, refrescar fechas antes de cada envío.

---

## Sesión 2026-08-26 — Cobertura transporte privado vs público (fix rechazos 3617 / 2485)

### Contexto

- Transporte **privado** (modalidad '02') ya pasa TODA la validación de SUNAT.
- Transporte **público** (modalidad '01', guía de prueba TR20-00000230) falla. Cadena de rechazos del día:
  1. **3617** — "No ha ingresado el campo de Fecha de entrega de bienes al transportista o está vacío" (nodo `cac:LoadingTransportEvent/cbc:OccurrenceDate`).
  2. Luego de incluir la fecha → **2485** — "Tipo de documento de identidad debe ser RUC" (`cbc:ID/schemeID` valor `1` = el transportista venía con DNI).

### Reglas SUNAT involucradas

- El **Catálogo 18** es: **01 = Transporte Público, 02 = Transporte Privado** (confirmado en
  `GUIA_GUIA_REMISION_REMITENTE.pdf` de SUNAT y en `greenter/packages/xcodes/.../CodeErrors.xml`:
  error 4045 "…02 - Transporte Privado"). El `catalogos.js` de la app estaba INVERTIDO (solo cosmético; el
  builder ya trataba '01' como público).
- R.S. 000108-2026/SUNAT (vigente **01/06/2026**): la "Fecha de entrega de bienes al transportista"
  (`LoadingTransportEvent`) pasó de observación a **ERROR** (3617 si falta, 3618 si < fecha emisión,
  3619 si mal formato) y **solo aplica a modalidad 01 público**.
- Transportista en GRE siempre se identifica con **RUC** (regla 2485), aunque en el ERP esté como persona natural.

### Cambios aplicados

| Archivo | Cambio |
|---------|--------|
| `src/xml/catalogos.js` | Cat. 18 corregido: `'01' → Transporte público`, `'02' → Transporte privado` |
| `src/services/guia.mapper.js` | Transportista con `tipoDoc: '6'` (RUC) forzado (antes usaba `tipotransportistaSUNAT`, podía venir `1`=DNI). Agrega `logger.warn` si `nrotranportista` no es RUC de 11 dígitos |
| `src/xml/builder.js` | `cac:LoadingTransportEvent` (fecha entrega bienes) se emite **solo si `modTraslado === '01'`** (público), junto con `fecEntregaBienes`; en privado nunca va |
| `src/xml/builder.js` | Segundo rechazo (**3354**): en público NO se consigna vehículo ni chofer. `DriverPerson` y `TransportEquipment` se emiten **solo si `modTraslado !== '01'`** |
| `src/services/guia.mapper.js` | Tercer rechazo (**3348**): el ERP traía transportista con **DNI** (`"75366748"`, 8 díg.) y SUNAT espera RUC existente. Regla de cobertura: si modalidad `01` sin transportista con RUC de 11 dígitos → cae a **privado (02)** con warning y se emite con chofer/placa |
| `src/services/guia.mapper.js` | Cuarto rechazo (**3357**): TR20 venía **sin chofer** (`dnichofer` vacío) y en privado SUNAT exige conductor principal. Fallback: si no hay `dnichofer` pero el "transportista" es **persona natural con DNI** (8 díg.), esa persona se usa como **conductor principal** (`nombres/apellidos` desde la columna transportista) |
| `src/services/guia.mapper.js` | Quinto rechazo (**2573**): licencia del conductor venía como **placeholder** `"00000000"` (el ERP no tiene el brevete). El SP no trae más campos de licencia. Se agregó **fail-fast**: si la licencia es vacía o todo ceros → error claro en español, en lugar de quemar ticket ante SUNAT (reglas 3360/2573). **Requiere corregir el dato en el ERP** (`nrochofer` con el N° de brevete real) |

### Excepción vehículo menor — categoría L/M1 (R-123-2022/SUNAT)

- **Validado con fuentes oficiales** (R-123-2022/SUNAT publicada en El Peruano y cpe.sunat.gob.pe):
  cuando el traslado se hace en vehículos de categoría **L** (motos, mototaxis, triciclos — placas `M/W/Z`)
  o **M1** (autos hasta 8 asientos, D.S. 058-2003-MTC), en transporte **privado** SUNAT permite
  **NO consignar placa ni conductor** usando la instrucción especial:
  `<cbc:SpecialInstructions>SUNAT_Envio_IndicadorVehiculoM1L</cbc:SpecialInstructions>`.
- Es el caso real de TR20: placa `W1D360` (serie W = mototaxi/triciclo, categoría L) y "el cliente va a recoger".
- Cambio: el mapper detecta modalidad 02 + placa serie `M/W/Z` → agrega el indicador y NO construye chofer
  (omite así el check de licencia); el builder omite `DriverPerson` y `TransportEquipment` si el indicador está presente.
- **Importante (rechazo 3388)**: el valor EXACTO del indicador es **`SUNAT_Envio_IndicadorTrasladoVehiculoM1L`**
  (con "Traslado"). `SUNAT_Envio_IndicadorVehiculoM1L` (sin "Traslado") NO existe en el catálogo y SUNAT lo
  rechaza con 3388 "El indicador no cumple con el formato establecido".
- Catálogo completo de indicadores válidos (R-123-2022, `cac:Shipment/cbc:SpecialInstructions`, an..50):
  `SUNAT_Envio_IndicadorTransbordoProgramado`, `SUNAT_Envio_IndicadorTrasladoVehiculoM1L`,
  `SUNAT_Envio_IndicadorTrasladoTotalDAMoDS`, `SUNAT_Envio_IndicadorRetornoVehiculoEnvaseVacio`,
  `SUNAT_Envio_IndicadorRetornoVehiculoVacio`, `SUNAT_Envio_IndicadorTrasporteSubcontratado`
  (sic, así en SUNAT), `SUNAT_Envio_IndicadorPagadorFlete_Remitente|_Subcontratador|_Tercero`,
  `SUNAT_Envio_IndicadorVehiculoConductoresTransp`.
- Pendiente: categoría **M1** (autos) no se auto-detecta por prefix; si llega el caso, el ERP debe señalarlo
  (p. ej. columna de categoría) o ampliar el prefijo.

### Respuesta a "¿qué pasa si no hay transportista?"

- Modalidad **privada (02)**: normal — el transportista nunca se envía (regla 3347).
- Modalidad **pública (01)**: SUNAT lo exige (3347 si falta, 3348 si el RUC no existe en su padrón).
  Con el nuevo mapper, si `01` viene sin RUC válido la guía **se auto-convierte en privada (02)**
  y sale con chofer/placa; para emitirla como `01` real el ERP debe registrar un transportista
  con un RUC existente.

### Resumen del builder por modalidad (reglas 3347 / 2485 / 3617 / 3354)

| Nodo | Público (01) | Privado (02) |
|---|---|---|
| `CarrierParty` (transportista, RUC) | sí | no |
| `LoadingTransportEvent` (fecha entrega bienes) | sí | no |
| `DriverPerson` + `TransportEquipment` (placa) | no | sí |

### Pendiente para transporte público (revisar con el ERP)

- **N° MTC del transportista** (`nroMtc` → `CarrierParty/PartyLegalEntity/CompanyID`): hoy no se mapea desde el
  SP (el mapper no lo incluye). En público SUNAT lo espera: verificar si la base lo tiene (p. ej. columna `nromtc`) y mapearlo.
- **Habilitación vehicular** (`vehiculo.nroCirculacion` → `ApplicableTransportMeans`) solo aplica a transporte privado
  (remolques/vehículos propios); en público el vehículo NO se consigna (regla 3354).
- Para probar: resetear TR20-00000230 (`estado='2'`) y refrescar fechas como en la sección anterior.

---

## Sesión 2026-08-27 — ACEPTACIÓN SUNAT de TR20 (modalidad privada + M1/L) y verificación estructural

### Resultado final (confirmado en BD)

- **TR20-00000230 fue ACEPTADO por SUNAT** luego de la cadena de rechazos resuelta en las sesiones anteriores.
- Registro en `documentos_sve`: `estado='1'`, `respuesta_sunat=0`, `coderror_sunat=''`,
  `id_sunat='bb6894c8-7da1-40d5-822a-45af7fc862c2'`, `fecha_sunat=2026-08-27 23:12:15`.
- La guía se emitió **como transporte privado (02)** con la excepción M1/L: placa `W1D360` (categoría L) → el
  mapper cayó a 02 con warning y agregó `cbc:SpecialInstructions>SUNAT_Envio_IndicadorTrasladoVehiculoM1L`,
  omitiendo chofer y placa (reglas 3354/3357/2573 no se disparan).

### Verificación estructural final (el XML está "en su lugar")

- Recorrido DOM del `cac:Shipment` emitido vs `despatch2022.xml.twig` (greenter) — **orden idéntico**:

  ```
  ID → HandlingCode → HandlingInstructions → GrossWeightMeasure
  → TotalTransportHandlingUnitQuantity → SpecialInstructions
  → ShipmentStage (TransportModeCode, TransitPeriod/StartDate)
  → Delivery (DeliveryAddress[ID, AddressTypeCode, AddressLine/Line],
              Despatch/DespatchAddress[ID, AddressTypeCode, AddressLine/Line])
  ```

- El `<cbc:ID>SUNAT_Envio</cbc:ID>` del Shipment **NO es un bug**: es exactamente el valor que
  hardcodea el template oficial `despatch2022.xml.twig:95`. Se dejó intacto para seguir siendo fiel al estándar.
- Sin `CarrierParty`, sin `LoadingTransportEvent` (privado, regla 3347/3617) y sin
  `DriverPerson`/`TransportEquipment` (indicador M1/L) — todo correcto para este caso.

### Comandos útiles de este cierre

```bash
# Confirmar aceptación desde BD
node -e "const {getConnection}=require('./src/database/connection');
(async()=>{const p=await getConnection();
 const r=await p.request().query(\"SELECT serie_doc,numero_doc,estado,respuesta_sunat,id_sunat,fecha_sunat FROM documentos_sve WHERE idtipo=09 AND serie_doc='TR20' AND numero_doc='00000230'\");
 console.table(r.recordset);process.exit(0)})()"
```

### Pendiente (sin novedad)

- Transporte **público (01)** real sigue pendiente de datos del ERP: se necesita un transportista con
  **RUC de 11 dígitos existente** y (en su momento) el **N° MTC** (`nroMtc`), hoy no expuesto por el SP.
- Categoría **M1** (autos) sin auto-detección por prefijo de placa (ver nota previa).

---

## Sesión 2026-08-28 — Rechazo 2573: licencia = DNI fabricada (formato real SUNAT aclarado)

### Síntoma

- Guía **TR30-00001218** (empresa RUC 20492641431, placa `BEP-819` → privado 02) rechazada con:
  `2573 — Número de licencia del conductor ... nodo cac:IdentityDocumentReference/cbc:ID valor "48113650"`.

### Causa raíz (confirmado con SP en BD de producción)

- El ERP no registró conductor: `dnichofer=''`, `nrochofer='00000000'`, `chofer='/'`. Solo venía el
  `transportista` persona natural con `nrotranportista='48113650'` (su **DNI**, 8 dígitos).
- El mapper (fallback de la sesión anterior) promovía al portador como conductor principal (DNI) y, al
  venir la licencia en ceros, **usaba el DNI como número de licencia** → `48113650`.
- SUNAT rechaza ese valor con 2573.

### Regla oficial (fuente: `Reglas de Validación GRE`, hoja Guía-Remitente2_0, campo 55/59)

> **Número de licencia de conducir** — tipo **an..10**: *"el formato del Tag UBL es diferente a
> alfanumérico de **9 a 10 caracteres** (solo se permiten letras mayúsculas y números, no se permite
> solamente ceros)"* → **error 2573** (XSL).

- Formato aceptado: **`[A-Z0-9]{9,10}`** y no todo ceros. Ej. brevete nuevo MTC `B12345678` (1 letra + 8 dígitos).
- Adicionalmente, regla **4412** (OBSERV, no bloqueante): el N° debe **existir en las bases del MTC**
  (`Licencias MTC`) — la guía pasa igual con observación si no se encuentra.

### Cambio en `src/services/guia.mapper.js`

- **Eliminado el fallback "usar el DNI como N° de licencia"** (garantizaba el 2573).
- Se valida la licencia contra `^[A-Z0-9]{9,10}$` (sin ceros a secas); si el conductor existe y la
  licencia es vacía/placeholder/8 dígitos → **fail-fast** con error claro en español (misma política
  de los rechazos 3360/2573 de la sesión del 26-ago): corregir `nrochofer` en el ERP con el N° de
  brevete real y reenviar.
- Verificado: válida (`B12345678`) construye el chofer OK; inválida (`00000000`/DNI) lanza el error sin
  quemar ticket en SUNAT.

### Regla de negocio adicional: "licencia 00000000 → M1" (decisión del usuario)

- El ERP usa `nrochofer` vacío o en ceros como señal de que el traslado es en vehículo de categoría
  **M1** (auto ≤ 8 asientos) sin conductor declarado. Con esto **M1 ya se auto-detecta** (la notita
  previa de "sin auto-detección por prefijo" quedó superada).
- `esTrasladoVehiculoMenor` = `modTraslado==='02'` y (`placa` empieza en M/W/Z **o** licencia vacía/ceros).
  En ese caso se emite con `SUNAT_Envio_IndicadorTrasladoVehiculoM1L` y el builder omite placa y chofer.
- Verificado contra TR30-00001218 (placa `BEP819`, `nrochofer=00000000`): XML con indicador, sin
  `DriverPerson`, sin `TransportEquipment`, sin placa ni DNI — mismo patrón que el TR20 aceptado.

### Acción pendiente para esta guía (ERP)

- Con el ajuste M1 por ceros, **TR30-00001218 ya puede emitirse** como vehículo menor (privado + M1).
  Si en realidad sí hay conductor/vehículo distinto a M1, completar `nrochofer` (brevete real, 9-10
  alfanuméricos) y `dnichofer`/`chofer` en el ERP.

---

## ~~PENDIENTE~~ — QR de la guía desde el CDR (2026-09-16) · RESUELTO el 2026-09-23

> **Resuelto.** `cdr.service.js` extrae la URL de `cbc:DocumentDescription`, `qr.service.js` la
> imprime en el PDF y `drive.service.js` lo sube. Verificado el 2026-09-28 con `zbarimg`: el QR del
> PDF generado decodifica exactamente a la URL que devuelve SUNAT. La descripción de abajo se
> conserva como está el hallazgo original.

### Contexto / hallazgo (documentación en `../greenter`)

Se revisó la doc de greenter y se confirmó que el CDR de una guía de remisión **sí contiene la URL del QR**:

1. El CDR es un XML `ApplicationResponse` (dentro del zip que SUNAT devuelve en `arcCdr`). Trae la URL en
   `cac:DocumentResponse/cac:DocumentReference/cbc:DocumentDescription`:
   `https://e-factura.sunat.gob.pe/v1/contribuyente/gre/comprobantes/descargaqr?hashqr=...`
   - Ejemplo real: `greenter/packages/ws/tests/Resources/R-20000000001-09-T001-1.xml:47`
2. Greenter la extrae con `DomCdrReader::getReference()`
   (`greenter/packages/ws/src/Ws/Reader/DomCdrReader.php:58,65`) y lo valida en
   `DomCdrReaderTest::testNuevaGuiaCdr` (`assertStringStartsWith('https://e-factura.sunat.gob.pe/', $cdr->getReference())`).
3. En el PDF de despacho esa URL se renderiza como QR:
   `greenter/packages/report/src/Report/Templates/despatch.html.twig:210` → `qrUrl(params.system.qr)`.
4. `Greenter\Model\Response\CdrResponse::getReference()` guarda ese valor
   (`greenter/packages/core/src/Core/Model/Response/CdrResponse.php:126`).

### Estado actual en greenter-api (Node)

Hoy `GET /api/guias/estado/:ticket` NO expone la URL del QR:
- `src/services/sunat-gre.service.js:99` devuelve solo `cdr: data.arcCdr` (ZIP en base64) e `indCdrGenerado`.
- `public/index.html:416` descarga el CDR como `.zip` sin parsearlo.

### Trabajo pendiente (cuando se retome)

1. Descomprimir el ZIP del CDR (`src/services/zip.service.js` ya tiene `decompress`).
2. Parsear el `ApplicationResponse` y extraer `cac:DocumentResponse/cac:DocumentReference/cbc:DocumentDescription`
   (la URL `descargaqr?hashqr=...`).
3. Exponerla en la respuesta de `consultarEstado` (p. ej. `qrUrl` / `reference`).
4. **Guardar la URL del QR en BD** (`documentos_sve`):
   - Confirmado que es factible: se obtiene y se persiste en `actualizarEnvio`
     (`src/database/documento.repository.js:62`) aprovechando el mismo UPDATE que ya corre al aceptarse.
   - **Requisito:** agregar una columna a `documentos_sve` (p. ej. `qr_url VarChar(255)`) — hoy el CDR/QR
     nunca se guarda (solo se actualizan `estado`, `respuesta_sunat`, `id_sunat`, `fecha_sunat`, `coderror_sunat`).
5. (Opcional) Generar/retornar el QR en la vista (`public/index.html`) con esa URL.

---

## Sesión 2026-09-23 — Limpieza: solo flujo CLI interno (se retira API/emisión)

### Decisión del usuario

La aplicación **no tiene vista ni funcionará como API**: el único uso es el flujo interno manual
(`node src/server.js`). Se eliminó todo el código que solo era usado por la API REST y por la
emisión de guías, conservando únicamente el flujo de **procesar guías ya emitidas**.

### Estructura final

```
TareaProgramadaGuias/
├── src/
│   ├── server.js                        # CLI (listar/verificar/drive/procesar)
│   ├── config/index.js                  # db, sunat, cdr, drive
│   ├── database/
│   │   ├── connection.js                # SQL Server (mssql)
│   │   └── documento.repository.js      # Pendientes, getByTicket, actualizarEnvio
│   ├── services/
│   │   ├── sunat-auth.service.js        # Token OAuth2 SUNAT
│   │   ├── sunat-gre.service.js         # consultarEstado (ticket) + CDR/QR
│   │   ├── cdr.service.js               # descomprime CDR, extrae qr_url
│   │   ├── zip.service.js               # solo decompress (CDR)
│   │   └── drive.service.js             # listar/buscar/descargar
│   └── utils/logger.js
├── reemplazar-qr/                       # reemplazo de QR (independiente, se mantiene)
├── certificates/                        # PFX conservados (aunque el firmado se retiró)
├── CDR/ y documentosReferencia/         # material de trabajo, conservado
├── guiasnuevo.md                        # doc operativo actual
└── HISTORY.md                           # este historial
```

### Eliminado

- **Carpetas:** `src/controllers/`, `src/routes/`, `src/models/`, `src/xml/`
  (builder/signer/catalogos), `src/middleware/` (vacía), `public/` (vista `index.html`).
- **Archivos:** `src/database/empresa.repository.js`, `src/services/guia.mapper.js`,
  `src/services/guia-remision.service.js` (flujo emitir).

### Recortado

- `sunat-gre.service.js`: se quitó el método `enviar` (emisión). Queda `consultarEstado`.
- `zip.service.js`: se quitó `compress` y la dependencia `node-forge`. Queda `decompress`.
- `config/index.js`: se quitaron `port` y `rutas`. Se conserva `certificates` (la carpeta PFX se mantiene).

### Dependencias

| Cambio | Paquetes |
|--------|----------|
| Retiradas | express, cors, soap, node-forge, xml-crypto, xmlbuilder2 |
| Añadida (explícita) | @xmldom/xmldom ^0.8.14 (ya era usada por cdr.service como dependencia transitiva) |
| Se mantienen | axios, dotenv, googleapis, jszip, mssql, winston |

### Verificación

- `node src/server.js` sin argumentos imprime el `Uso:` y sale con código 0 (todos los requires resuelven).
- `npm ls --depth=0` sin empaquetado de API; sin referencias colgadas en `src/` a módulos eliminados.

### Pendiente (sin cambios, ver `guiasnuevo.md`)

- Paso 7: guardar el nuevo `qr_url` (falta método en `documento.repository.js`).
- Paso 8: `upload`/`delete` en `drive.service.js`.
- Paso 6 (parcial): integrar `reemplazar-qr/` dentro del flujo `procesar`.

---

## Sesión 2026-09-23 — Flujo `procesar` completo: QR integrado y subida a Drive con `files.update`

### Decisión del usuario

- **No se borra nada en Drive**: la cuenta de servicio es *editor*, no *propietaria*, y no tiene
  permisos de borrado. Los archivos se **reemplazan por contenido** con `files.update` (editar no
  requiere ser propietario), usando el **mismo nombre** (sin `_2`).
- El flujo no es un bucle infinito: `node src/server.js` (por defecto `procesar`) corre una vez —
  si hay documentos los procesa; si no hay, termina. Es una tarea programada.

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/server.js` | Corregido bug en `main()`: el branch temprano de `procesar` hacía `return` **sin** `await closeConnection()`, dejando el pool de mssql abierto → el proceso se colgaba. Ahora cierra la conexión y termina. Se eliminó el `case 'procesar'` del switch (quedó como código muerto) |
| `src/server.js` | `comandoProcesar` ahora termina el flujo: descarga el PDF de Drive → reemplaza el QR (`qr.service.js` → `reemplazar-qr/`) → sube el PDF nuevo con el **mismo nombre** (reemplaza el erróneo) y el CDR con extensión `.xml` |
| `src/services/qr.service.js` | (ya existente) `reemplazar({ entrada, contenidoQr, salida })` delega en `reemplazar-qr/src/index.js` con `--entrada --qr --salida`. Confirmado que los flags coinciden con el parser del proyecto QR |
| `src/services/drive.service.js` | `subir()` reescrito: si el archivo ya existe en la carpeta usa `drive.files.update({ fileId, media })` (editar contenido como editor); si no existe lo crea con `files.create`. **Ya no elimina** el archivo existente antes de subir (autor era falta de permiso de borrado). `eliminar()` queda en desuso |

### Verificación

- `node --check` sobre `server.js` y `drive.service.js` OK.
- `procesar` hueco de conexión corregido: ahora llega al `closeConnection()` y el proceso sale.
- El PDF nuevo se sube con el nombre del original (`<…>-09-<serie>-<nro>.pdf`) → Drive guarda el
  contenido actualizado en el mismo archivo; el CDR como `<…>-09-<serie>-<nro>.xml`.

### Pendiente

- Paso 7 sigue pendiente: guardar el `qr_url` del CDR en `documentos_sve` (falta método en
  `documento.repository.js`, requiere columna `qr_url` en la tabla).


---

## Sesión 2026-09-28 — Multi-empresa: el flujo ahora recorre todas las empresas vía `spPyOValidaGuia`

### Por qué cambió

La app solo procesaba la empresa de las variables de entorno (KaiserCorp, RUC 20492641431) y leía
`documentos_sve` de la BD central. Pero cada empresa tiene **su propio servidor y BD** (52 filas en
`admin.dbo.Conexiones`) y **sus propias credenciales de SUNAT**. La tarea es para todas.

### La pieza nueva: `admin.dbo.spPyOValidaGuia`

Stored procedure (creado 2026-09-28, autor FOV) en la BD central `admin`. Recorre internamente las
conexiones con `Conexiones.Guia = 1` usando `OPENROWSET` y devuelve **una fila por documento** que
tiene el QR sin reemplazar:

```sql
SELECT ID, idEmpresa, idDocumento,
       case when Estado in ('2','3') then 1 else 2 end as Estado
FROM   dbo.DOCUMENTOS_SVE
WHERE  idTipo = '09' and len(Firma) > 0 and len(codigovalidacion) = 0
  and   convert(char(8), fecha_doc, 112) >= '20260901'
  and   ((estado in ('2','3')) or (estado = '6' and validado = '1'))
```

Claves del contrato:

- `ID` = `Conexiones.id` (con qué BD hay que conectarse para leer ese documento).
- La columna `Estado` del SP **no es** `documentos_sve.estado`: es una clasificación del SP.
  - `Estado = 1` → el ERP lo tiene en estado 2/3: emitido pero **no** aceptado por SUNAT.
    **No se procesan**; los sube el ERP a SUNAT.
  - `Estado = 2` → el ERP lo tiene en estado 6 con `validado = 1`: ya aceptado por SUNAT,
    solo falta reemplazar el QR. **Estos son los que procesamos.**
- El filtro `len(codigovalidacion) = 0` es el que hace el flujo **auto-gestionable**: al guardar la
  URL del QR ahí, el documento deja de salir del SP en la siguiente corrida. No hace falta marcar
  nada más.

### Dónde están las credenciales de SUNAT de cada empresa

No están en el `.env`: están en `v_empresas` de la BD de cada empresa. Mapeo que usa el ERP:

| Columna de `v_empresas` | Uso |
|-------------------------|-----|
| `ruc`                   | RUC emisor (también el prefijo del nombre del PDF en Drive) |
| `usuariosol` / `clavesol` | credenciales SOL del password grant |
| `nomcertificadojks`     | `client_id` de la API GRE |
| `clacertificadojks`     | `client_secret` de la API GRE |

> Las columnas se llaman "certificado" pero guardan el par `client_id`/`client_secret` de OAuth2.
> Los certificados PFX de verdad (`nomcertificadopfx`/`clacertificadopfx`) **no** se usan: el firmado
> se retiró en la sesión del 2026-09-23.

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/config/index.js` | Fuera `certificates` (nadie lo usaba desde que se retiró el firmado) y fuera las credenciales `sunat.*` (ahora son por empresa). Quedan solo `apiBase`, `seguridadBase` y `scope`, que son comunes |
| `src/database/erp-connection.js` | **Nuevo.** Pool por empresa a partir de una fila de `Conexiones`, cacheado por `server\|bd\|usuario`. `closeErpConnection(conexion)` cierra el de una sola empresa; `closeErpConnections()` los cierra todos |
| `src/database/conexion.repository.js` | **Nuevo.** `getConGuias()` (`Guia = 1`), `getPorId(id)`, `getGuiasPorValidar()` (`exec spPyOValidaGuia` + filtro `Estado = 2`) |
| `src/database/empresa.repository.js` | **Nuevo.** `getCredencialesSunat(pool, idEmpresa)` desde `v_empresas`, con validación de campos faltantes |
| `src/database/documento.repository.js` | Todo recibe el `pool` de la empresa. `getPorIdDocumento(pool, idEmpresa, idDocumento)` y **`guardarQrUrl(pool, ...)` → `UPDATE documentos_sve SET codigovalidacion`** (este era el paso 7, ya no hace falta agregar columna) |
| `src/services/sunat-auth.service.js` | Recibe las credenciales como parámetro. Token cacheado **por empresa** (`Map` con clave `clientId\|ruc`) en vez de uno global, y se borra la entrada si el token falla |
| `src/services/sunat-gre.service.js` | `consultarEstado(ticket, credenciales)` |
| `src/server.js` | `procesar` reescrito: agrupa por `Conexiones.id`, procesa **todas** las guías de una empresa y recién entonces cierra su pool, antes de pasar a la siguiente. Opciones `--simular`, `--limite n`, `--conexion id`, `--empresa id`. Comandos nuevos `pendientes` y `listar` |
| `.env` | Fuera `PORT`, `SUNAT_*`, `CERTIFICATES_DIR`, `RUTA_DOCUMENTOS`, `RUTA_IMAGENES` (muertos). Fuera el espacio inicial de `SUNAT_CLIENT_SECRET`, que dotenv recortaba |

### Grouping: por qué no se salta de conexión en conexión

El SP devuelve las guías de las 10 empresas **mezcladas**. Procesarlas en ese orden abriría y cerraría
7-10 conexiones a la vez, para volver a abrirlas en la fila siguiente. `agruparPorConexion()` en
`server.js` las reordena por `ID` y el bucle externo itera empresas: se abre el pool, se procesa
todo lo de esa empresa y en el `finally` se cierra con `closeErpConnection()`.

### Verificación (con SP emulado, porque `spPyOValidaGuia` desapareció de `admin`)

- Conexión real a veryfrut y KaiserCorp, token OAuth2 con las credenciales de `v_empresas` de cada
  una, consulta a SUNAT, CDR descomprimido y `qrUrl` extraído correctamente.
- Filtro de estado: sobre 272 filas del SP, 7 son `Estado = 1` (se descartan) y 265 `Estado = 2`.
- Agrupación: `7=42 8=15 11=2 18=41 20=3 27=67 30=102`, una empresa a la vez, con
  `Conexión cerrada: ...` al terminar cada una.
- `spMuestraComprobanteGuia` necesita el idtipo `'030009'`, **no** `'09'` (que es el de
  `documentos_sve`). Con `'09'` devuelve 0 filas y el nombre del PDF en Drive no se arma.
- `node --check` OK en todos los archivos de `src/`.

### Lo que falta

- **`spPyOValidaGuia` ya no está en `admin`.** Se encontró y se ejecutó a las 16:52 (271 filas), pero
  a las 17:00 la BD había vuelto a su estado anterior (30 objetos, solo `spPyOEnvioMasivoCPE`) y el
  SP había desaparecido. Hay que recrearlo.
- **La carpeta de Drive es de pruebas y no tiene los PDF vigentes.** De los 265 documentos con
  `Estado = 2`, solo 4 tienen PDF en la carpeta de `driveid.txt`
  (`1eSUh6Ru3nVhy0g1rm9gh4F9opZK_35Iu`), y son de KaiserCorp. El flujo los omite con el motivo
  `sin PDF en Drive` y los deja para cuando el PDF esté subido (no se marca
  `codigovalidacion`, así que vuelven a salir del SP).

### Pendiente de la sesión anterior, resuelto

- Paso 7 (guardar el `qr_url`) → resuelto sin agregar columna: va en `codigovalidacion`, que ya
  existía como `nvarchar(245)`. La URL del QR entra holgada.

### Nota: permiso de `spPyOValidaGuia` para el usuario de conexión

Desde el usuario `soporte` (el que usa la app) el SP no es visible ni ejecutable. SQL Server
reporta `229 The EXECUTE permission was denied` —que es engañoso, también lo da cuando el objeto no
le es visible al usuario—, así que no se puede distinguir "no existe" de "existe sin permiso" solo
con el código de error.

Comprobación:

```sql
SELECT OBJECT_ID('spPyOValidaGuia');   -- NULL = no existe o no visible para 'soporte'
SELECT HAS_PERMS_BY_NAME('spPyOValidaGuia','OBJECT','EXECUTE');
```

`soporte` no es `db_owner` (`IS_MEMBER('db_owner') = 0`), así que no puede arreglarlo por su cuenta.
Si el SP existe, falta:

```sql
GRANT EXECUTE ON dbo.spPyOValidaGuia TO soporte;
```

Por eso `conexion.repository.js` ahora envuelve el error con un mensaje que dice qué revisar y qué
`GRANT` corresponde, en vez de dejar el stack crudo de mssql.

---

## Sesión 2026-09-28 (2) — El SP se corre una vez y queda un archivo local

### El problema

`spPyOValidaGuia` vive únicamente en la BD central `admin` y su permiso `EXECUTE` no es
heredable: **el usuario con que la app se mueve entre las BD de las empresas no puede correrlo**.
Pedirle ese permiso solo para armar el listado no tenía sentido.

### La solución: un snapshot en disco

`spPyOValidaGuia` se corre **una vez**, con un usuario que sí tenga el permiso, y su resultado queda
en `guias-pendientes.json`. A partir de ahí la app trabaja contra ese archivo y se mueve sola entre
las BD de las empresas — que es lo único que necesita, porque para eso sí tiene credenciales (las de
`Conexiones`).

```
spPyOValidaGuia  --(una vez, con permiso)-->  guias-pendientes.json
                                                        |
                                                        v
                              procesar  ->  Conexiones -> BD de cada empresa
                                            -> v_empresas (credenciales SUNAT)
                                            -> SUNAT -> CDR -> qr_url
                                            -> Drive (PDF + CDR)
                                            -> documentos_sve.codigovalidacion
```

Ningún paso del flujo normal toca la BD central más allá de leer `Conexiones`.

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/config/index.js` | Nuevo bloque `pendientes.archivo` (`PENDIENTES_ARCHIVO`, por defecto `guias-pendientes.json` en la raíz) |
| `src/services/pendientes.service.js` | **Nuevo.** `exportar(incluirTodos)` corre el SP y escribe el snapshot; `cargar(incluirTodos)` lo lee. Acepta también **CSV** (por si se genera a mano desde SSMS con "Guardar resultados como"), con parser propio que maneja comillas, comas dentro del campo, `""` escapado y CRLF |
| `src/database/conexion.repository.js` | `getGuiasPorValidar({ incluirTodos })`. Es el **único** punto del código que toca el SP, y solo lo usa `exportar` |
| `src/server.js` | Nuevo comando `exportar [--todos]`. `procesar` y `pendientes` leen el archivo; con `--refrescar` vuelven a correr el SP primero. `pendientes` ya no multiplica el límite por 3 al mostrar |
| `.gitignore` | `guias-pendientes.json` / `.csv` (es un snapshot) y las credenciales de Drive |

### Verificación

Como `soporte` no puede correr el SP, el snapshot se generó con los mismos datos consultando cada BD
de empresa con las credenciales de `Conexiones` (mismo `WHERE` que usa el SP por `OPENROWSET`).

- Snapshot de **272** filas, de las cuales **265** son `Estado = 2` (las 7 de `Estado = 1` se
  descartan). Reparto: `7=42 8=15 18=39 27=67 30=102`.
- `11` (Artika) y `20` (DUniversal) quedan en 0: sus pendientes eran todos `Estado = 1`, o sea
  documentos que todavía sube el ERP a SUNAT. Correcto.
- `node src/server.js procesar --simular --limite 5` **sin el SP**: lee el archivo, agrupa por
  empresa (las 5 primeras de veryfrut), consulta SUNAT, obtiene CDR y QR, y omite con el motivo
  `sin PDF en Drive`.
- `pendientes --limite 3` muestra 3 filas (antes mostraba 10).
- CSV: lee encabezado, ignora `Estado = 1` y parsea `a,"b,c","d""e"` correctamente.
- Sin el archivo, el error dice qué comando correr y por qué hace falta el permiso.

### Pendiente

- **Carpeta de Drive.** La de `driveid.txt` es de pruebas: solo tiene 4 PDF de KaiserCorp de los 265
  documentos. Se deja para el final, como se acordó.

---

## Sesión 2026-09-28 (3) — Robustez: ningún fallo frena la corrida

Se revisó qué pasa cuando algo no está: el PDF no existe en Drive, la carpeta no está
compartida con la cuenta de servicio, la BD de una empresa no responde, o falla cualquier paso a
mitad de un documento. Regla acordada: **se omite y se sigue con el siguiente**. Un error nunca
deja el documento a medias ni detiene el resto.

### Qué se corrigió

| Problema | Antes | Ahora |
|----------|-------|-------|
| Carpeta de Drive inexistente o sin permisos | 265 búsquedas fallando, una por guía, todas como `error` | Se detecta en la primera, se marca y las 264 restantes se omiten al instante. Solo 1 búsqueda |
| Carpeta de Drive caída | Se seguía consultando a SUNAT para guías que igual no se iban a poder escribir | El chequeo va **al inicio** de `procesarGuia`: no se gasta ni una consulta |
| BD de una empresa caída o credenciales malas | Reintento documento por documento (30 s de timeout × 42 guías ≈ 20 min en silencio) | Se abre la conexión una vez por empresa; si falla se omiten todas sus guías de una |
| `reemplazar-qr` Could exit 0 sin escribir nada | Se subía un PDF sin QR y el documento se marcaba como procesado | Se verifica que el PDF generado exista y pese algo razonable antes de subir |
| PDF descargado y PDF con QR | Se acumulaban en `documentosReferencia/`, pisando el histórico que está en git | Van a `tmp/`, que se borra en el `finally` de cada documento y al salir |
| Carpeta inaccesible | Terminaba sin explicación | Al final se avisa con el id a revisar y qué permiso falta |

### Archivos

- `src/services/drive.service.js`: `clasificarError()` traduce el error de la API de Google a
  `no-existe` / `sin-permisos` / `transitorio` / `otro`, y `tolerante()` convierte los dos
  primeros en `null` en vez de propagarlos.
- `src/server.js`: estado `estadoDrive`; la búsqueda de Drive distingue "falta este PDF" (omitir
  ese documento) de "no veo la carpeta" (omitir todos, en silencio); pre-flight de conexión por
  empresa; validación del PDF generado; limpieza de temporales; aviso final.
- `src/database/erp-connection.js`: sin cambios, ya era correcto — las conexiones fallidas no se
  cachean y el cierre de pools no propaga errores.
- `.gitignore`: `tmp/` y `CDR/`.

### Verificación

| Escenario | Resultado |
|-----------|-----------|
| `driveid.txt` con un id inexistente | 265 omitidas, **0 errores**, 8 s (antes: ~1 min y 265 errores) |
| PDF no está en la carpeta | `omitido: sin PDF en Drive`, se sigue |
| `ID` que no existe en `Conexiones` | `omitido`, y sigue con la empresa siguiente |
| SUNAT devuelve error en un documento | ese documento se omite, el siguiente se procesa normal |
| Al salir | `tmp/` borrado, `documentosReferencia/` sin cambios |

### Nota sobre el orden de escritura

Ante una falla a mitad de camino el documento queda **pendiente**, nunca marcado:

```
descargar -> reemplazar QR -> subir PDF -> subir CDR -> guardar codigovalidacion
```

Si se corta en cualquier punto, `codigovalidacion` sigue vacío y el documento vuelve a salir en la
próxima corrida. Lo único que puede quedar es el PDF ya subido sin el `codigovalidacion` guardado;
volver a procesarlo es idempotente porque el QR se reemplaza por el mismo valor.

---

## Sesión 2026-09-28 (4) — Prueba del flujo con 3 empresas

Se tomó **un documento de tres empresas distintas**, de bases de datos distintas y en dos
servidores distintos, y se corrió el flujo completo (sin escribir en Drive ni en la BD).

| # | Conexión | RUC | Servidor / BD | Documento | Serie-Nro |
|---|----------|-----|---------------|-----------|-----------|
| 1 | 7  | 20607129470 | serverdb01 / veryfrut   | 260000388500 | T001-00005258 |
| 2 | 27 | 20121322634 | serverdb01 / Pirex     | 260000298400 | T001-00005380 |
| 3 | 30 | 20492641431 | serverdb02 / KaiserCorp | 260000721200 | TR30-00001221 |

Cada una con su propio `clientId` de OAuth2 y su propio `usuarioSol`, leídos de `v_empresas` de
esa BD.

### Resultado

Las tres pasaron el flujo entero:

```
Conexiones -> BD de la empresa -> documentos_sve -> v_empresas -> token OAuth2
           -> SUNAT (ticket) -> CDR -> qr_url -> búsqueda en Drive
```

- **3/3** tokens obtenidos (uno por RUC, correctamente cacheados por separado).
- **3/3** consultas a SUNAT respondieron y se descargó y descomprimió el CDR.
- **3/3** con estado ACEPTADO y `qr_url` extraído del `cbc:DocumentDescription`.
- La conexión a cada BD se abrió, se usó y se cerró antes de pasar a la siguiente.
- Las 3 quedaron en `omitido: sin PDF en Drive`, que es lo esperado: la carpeta actual es de
  pruebas y no tiene los PDF de veryfrut ni de Pirex.

### Verificación del QR (local, sin escribir nada)

Para no quedarnos solo con "no dio error", se comprobó que el QR realmente es correcto:

- La `qr_url` que devuelve SUNAT responde **HTTP 200** con un PDF de 4.3 KB.
  Ojo: `descargaqr` devuelve un **PDF**, no un PNG. El QR que se imprime en la guía lo genera
  localmente `reemplazar-qr` con ese texto, que es lo correcto.
- `reemplazar-qr` corrió sobre un PDF real (36.7 KB → 44.8 KB, 1 página, generado por pdf-lib).
- Se decodificó el QR del PDF resultante con `zbarimg`: devuelve **exactamente** la misma URL de
  SUNAT, carácter por carácter.

### Qué queda sin probar

Solo la pata que escribe: subir el PDF y el CDR a Drive y guardar `codigovalidacion`. Necesita la
carpeta real, que es lo único que falta definir. Todo lo demás está verificado contra SUNAT.

---

## Sesión 2026-09-29 — La carpeta de Drive pasa a ser por guía (`DriveID` del SP)

### Por qué cambió

`spPyOValidaGuia` ahora devuelve **una quinta columna, `DriveID`: la carpeta de Drive donde vive el
PDF de esa guía**:

```
ID,idEmpresa,idDocumento,Estado,DriveID
7,01,260000388500,2,1Rf8Zs2UsaYxGXKyEG6vRjUOzHZeUa366
7,01,260000389900,2,1Rf8Zs2UsaYxGXKyEG6vRjUOzHZeUa366
```

Esto resuelve el bloqueo que arrastraba el proyecto desde el 2026-09-23: la carpeta ya no hay que
definirla a mano ni adivinarla, y **no es una sola** — varias guías de la misma empresa comparten
`DriveID`, y cada empresa puede tener la suya. Junto con esto se cambió la cuenta de servicio por
**`driveenviopdf-7a4b8936208f.json`** (`usuariopdfdrive-630@driveenviopdf.iam.gserviceaccount.com`),
que es la que tiene acceso a esas carpetas.

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/config/index.js` | `drive.credenciales` → `driveenviopdf-7a4b8936208f.json`. Fuera `drive.folderIdFile`: ya no hay carpeta fija |
| `src/services/drive.service.js` | Fuera `leerFolderId()` y la propiedad `folderId`. `listar`, `buscarPorNombre`, `buscarContiene` y `subir` reciben la carpeta por parámetro. Nuevo `carpeta()`: valida que el id no venga vacío, para que un `DriveID` ausente dé un error propio y no una consulta contra la carpeta `'undefined'` |
| `src/services/pendientes.service.js` | `DriveID` entra al snapshot. Nuevo `aFila()`, que es el normalizador único para JSON, CSV y salida del SP. `cargar()` avisa cuántas guías vinieron sin `DriveID` |
| `src/services/cdr.service.js` | `borrar(ruta)` (elimina el CDR de un documento) y `limpiar()` (vacía `CDR/`), para que la carpeta no acumule cientos de XML |
| `src/server.js` | `procesarGuia` saca la carpeta de `fila.DriveID` y la usa en **todas** las llamadas de Drive. Sin `DriveID` → `omitido: sin DriveID en el listado`. El CDR se sube a la misma carpeta que el PDF. El CDR local se borra en el `finally` de cada guía y `CDR/` se vacía al terminar `procesar` |
| `src/server.js` | `estadoDrive` (una bandera global) → `carpetasInaccesibles`, un `Map` de carpeta → motivo. Una carpeta sin permisos ya no frena el resto: se omiten sus guías y las demás se siguen |
| `src/server.js` | Comandos `drive listar/buscar/descargar` reciben `<driveId>`; sin él imprimen el uso |
| `.gitignore` | Sin cambios (`CDR/` y `tmp/` ya estaban) |

### El CDR va a la misma carpeta, con el nombre del PDF

El PDF se sube con su mismo nombre (reemplaza al que tenía el QR erróneo) y el CDR **con el mismo
nombre base y extensión `.xml`**. Ejemplo en la carpeta de veryfrut:

```
20607129470-2026-09-01-20600484266-09-T001-00005258.pdf
20607129470-2026-09-01-20600484266-09-T001-00005258.xml
```

El nombre del CDR que trae SUNAT (`R-<ruc>-09-<serie>-<nro>.xml`) queda solo como nombre de archivo
local. El CDR local es temporal: se sube a Drive y se borra.

Se agregó un chequeo: si se sacó la `qr_url` del CDR pero no el archivo, se corta el documento con un
error claro en vez de fallar más abajo en `fs.createReadStream(null)`.

### Verificación (con `DriveID`, sin escribir nada)

Con un CSV de prueba de 4 filas (`2` de veryfrut con DriveID, `1` de veryfrut con `Estado = 1`, `1`
de KaiserCorp **sin** `DriveID`):

- `node src/server.js pendientes`: lee las 5 columnas, descarta la de `Estado = 1` y avisa
  `1 sin DriveID`.
- `node src/server.js procesar --simular`: **2 simuladas, 1 omitida, 0 errores**. Las 2 de veryfrut
  fueron de punta a punta hasta el final: BD de la empresa → `v_empresas` → token OAuth2 → SUNAT
  (ACEPTADO) → CDR → `qr_url` → búsqueda en la carpeta `1Rf8Zs2UsaYxGXKyEG6vRjUOzHZeUa366`, donde
  **sí encontró los dos PDF** con la cuenta nueva. La de KaiserCorp se omitió con
  `sin DriveID en el listado`.
- `node src/server.js drive listar 1Rf8Zs2UsaYxGXKyEG6vRjUOzHZeUa366`: la carpeta responde y ya
  tiene PDFs y CDR `.xml` apareados, que confirma la convención de nombres.
- Al terminar: `CDR/` vacío (se limpiaron los 275 XML que venían de corridas anteriores) y `tmp/`
  borrado.
- `node --check` OK en los 5 archivos tocados.

### Lo que falta

- **Regenerar `guias-pendientes.json` con `exportar`**: el archivo actual no tiene `DriveID` porque
  se generó emulando el SP. Es lo único que bloquea la prueba de punta a punta.
- Nota: `verificar` deja su CDR en `CDR/` a propósito, para poder mirarlo al depurar. La limpieza
  corre al final de `procesar` y de `probar`.

---

## Sesión 2026-09-29 (2) — `probar`: el flujo completo sin escribir nada

### Qué es

Un comando que corre el flujo entero **sin escribir en Drive ni en la BD**, para ver el estado real
sin committing nada. Toma **una guía de cada conexión** (4 por defecto), de modo que cubre empresas
distintas: distinto servidor, BD y credenciales de SUNAT.

```bash
node src/server.js probar                # 4 conexiones
node src/server.js probar --conexiones 6 # 6 conexiones
node src/server.js probar --conexion 30  # forzar una
```

Por cada guía: BD de la empresa → `v_empresas` → SUNAT → CDR → `qr_url` → busca el PDF en la
carpeta `DriveID` → baja el PDF → genera el PDF con el QR → **verifica el QR** → limpia.

### Cómo verifica el QR

`qr.service.js → leerQr(pdf)`: rasteriza la página con `pdftoppm -png -r 200` y decodifica con
`zbarimg --raw`. Se lee **el QR del PDF que está hoy en Drive** y **el del PDF nuevo**, y se
comparan con la URL que devolvió el CDR. Si el QR del PDF nuevo es exactamente esa URL, el PDF
que se va a subir lleva el QR correcto.

`zbarimg` sale con código 4 cuando no encuentra código, así que el helper no falla por eso: lo
trata como "no se pudo leer". `leerQr` tarda ~0.7 s por PDF (500 ms de pdftoppm + 190 ms de zbarimg
a 200 dpi), así que no es lo que pesa en la corrida.

### El hallazgo: el QR que tienen hoy los PDF está mal

Los 4 PDF que se bajaron de Drive **no** imprimen la URL de SUNAT. Imprimen un dato interno:

```
20607129470|09|T001 |00005258|2026-09-01|RUC|pU73vOb3em4ysDcp+17XXPNO3...
```

Es decir, el QR actual no es el de SUNAT, que es justo lo que esta app viene a arreglar. Por eso
`probar` reporta las dos columnas: "QR que tiene hoy" y "QR nuevo = SUNAT".

### Resultado de la corrida (2026-09-29)

4 conexiones, 4 guías, **4/4 verificadas**:

| Conexión | RUC / BD | Guía | PDF en Drive | QR nuevo = URL SUNAT | URL responde |
|----------|-----------|------|--------------|----------------------|--------------|
| 7  | 20607129470 veryfrut  | T001-00005258 | 39 579 B | sí | HTTP 200 |
| 8  | 20606768428 frutiver  | T001-00003756 | 43 106 B | sí | HTTP 200 |
| 18 | 20327427696 PuratosSur | T001-00002083 | 57 177 B | sí | no (timeout 15 s) |
| 27 | 20121322634 Pirex      | T001-00005380 | 44 544 B | sí | no (timeout 15 s) |

Las 4 aceptadas por SUNAT, las 4 con el PDF encontrado en su carpeta `DriveID` y las 4 con el QR
nuevo correcto. Al terminar: `CDR/` y `tmp/` vacíos.

> La columna "URL responde" falló 2 de 4 por timeout contra `e-factura.sunat.gob.pe`. Con `curl` la
> misma URL responde `HTTP 200` en 0.4 s, y con node en un proceso limpio también. Es
> intermitente desde node en esa máquina, no del flujo: el veredicto del QR no depende de ese
> chequeo, porque compara el QR impreso contra la URL exacta del CDR.

### El `DriveID` sale de `Conexiones.DriveID`

Al revisar por qué el SP no se podía correr, se vio de dónde sale la columna: **`DriveID` es una
columna de `admin.dbo.Conexiones`**, y los 10 registros con `Guia = 1` la tienen:

| id | ruc | BD | DriveID |
|----|-----|-----|---------|
| 4  | 20503520568 | coprosat    | `1St0nSgjoyJjq7ueDfddTcbQQTo8DAdmz` |
| 7  | 20607129470 | veryfrut    | `1Rf8Zs2UsaYxGXKyEG6vRjUOzHZeUa366` |
| 8  | 20606768428 | frutiver    | `1L1RAiR2zFxjPjbwC1GXXgG3ZXBsZKA5h` |
| 11 | 20228941612 | Artika      | `15em2exQtpkI92E3u5tb9bJYf32ovMIZr` |
| 12 | 20604131864 | Camayo      | `17U3te_-N8UpLqzqA3YVtAdG6vQyRjH3Y` |
| 15 | 10297225133 | CSoto       | `1mUGU4lkxKkWCROWveoPpLS7-S9YKHEFQ` |
| 18 | 20327427696 | PuratosSur  | `1kTEyLeU5z8iZuYxuBs7-AaX3hA0-4mvv` |
| 20 | 20498045040 | DUniversal  | `1EDC5rwPJOES6EZBk7mLlVEAhRNGzA52t` |
| 27 | 20121322634 | Pirex       | `1Y2JW1BUY6QkAMmK1akD4nY7AuvhRYxQw` |
| 30 | 20492641431 | KaiserCorp  | `1sXXbiT3jIUc27MVK9hBVk_iEEAoJhGd3` |

En las BDs de las empresas **no hay** ninguna tabla ni columna de Drive: el dato solo existe en
`admin`. Por eso el SP lo pasa y la app no puede calcularlo sola.

Como consecuencia, `procesarGuia` resuelve la carpeta con `fila.DriveID || conexion.DriveID`: si el
listado se generó con un SP viejo (el actual, emulado), igual funciona, porque `getPorId()` hace
`SELECT *` de `Conexiones` y ya trae el `DriveID`. La preferencia sigue siendo el del SP.

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/server.js` | Nuevo `comandoProbar` + caso `probar` en el switch. `procesarGuia` pasa a recibir `{simular, verificarQr}`: el `simular` de antes es un modo más, y `verificarQr` corre todo el flujo pero **vuelve antes del bloque que escribe**. Resuelve la carpeta con `fila.DriveID \|\| conexion.DriveID`. Nuevo helper `cortar()` para las tablas |
| `src/services/qr.service.js` | Nuevo `leerQr(pdf)`: pdftoppm + zbarimg. Helper `correr()` que no falla por código de salida (zbarimg devuelve 4 si no hay código) |
| `src/services/sunat-gre.service.js` | Nuevo `verificarQrUrl(qrUrl)`: GET a la URL del CDR, solo informa. Timeout 15 s |

---

## Sesión 2026-09-29 (3) — `todo`, y el bug que hacía que `procesar` nunca terminara una guía

### El comando `todo`

La corrida diaria en un solo comando: pide el listado al SP, procesa, y deja todo listo para la
siguiente vez.

```bash
node src/server.js todo
node src/server.js todo --simular      # la corrida entera sin escribir nada
node src/server.js todo --limite 5     # solo las primeras 5
```

1. `pendientesService.exportar()`: corre `spPyOValidaGuia` y guarda el listado.
2. `comandoProcesar()`: el flujo de siempre.
3. Al terminar, `pendientesService.guardar()` **reescribe el archivo con las guías que NO se
   pudieron terminar**, para que la próxima siga desde ahí y no vuelva a procesar las hechas.

Sobre el paso 1: el permiso `EXECUTE` del SP es opcional. Con el usuario normal no se puede correr,
así que `todo` avisa y sigue con el listado que ya está en disco. Con usuario con permiso, el
listado queda siempre fresco.

**Candado.** `todo` toma `tmp/.corrida.lock` (pid + fecha). Si el proceso que lo dejó ya no existe
—matado a la fuerza, equipo apagado— la corrida siguiente lo recupera sola; si está vivo, avisa y no
arranca una segunda. Sin esto, un trabajo programado que se solapa con una corrida manual
trabajaría sobre los mismos PDF de `tmp/` y sobre el mismo archivo de pendientes.

### Lo que se encontró: `codigovalidacion` NO es un campo para URLs

Al correr `procesar` de verdad (por error, ver abajo) saltó en todos los documentos:

```
error: 7/01/260000388500: String or binary data would be truncated.
```

La causa, mirando la definición real de la columna en las 5 bases:

| conexión | BD | tipo de `codigovalidacion` | guías con valor |
|---|---|---|---|
| 7  | veryfrut   | **char(4)**   | 0 |
| 8  | frutiver   | **char(4)**   | 0 |
| 18 | PuratosSur | **char(4)**   | 0 |
| 27 | Pirex      | **char(4)**   | 0 |
| 30 | KaiserCorp | nvarchar(245) | 0 |

Y el SP filtra exactamente por esa columna:

```sql
WHERE idTipo = '09' and len(Firma) > 0 and len(codigovalidacion) = 0
  and convert(char(8), fecha_doc, 112) >= '20260901'
  and ((estado in ('2','3')) or (estado = '6' and validado = '1'))
```

O sea: **la URL del QR de SUNAT (unos 250 caracteres) no cabe en `char(4)`**. El paso 7 nunca
funcionó: subía el PDF y el CDR a Drive, fallaba el UPDATE, y la guía quedaba sin marcar, con lo
que el SP la volvía a devolver en cada corrida y se reprocesaba para siempre. En `KaiserCorp`, que
sí tiene `nvarchar(245)`, habría entrado justo por el borde.

Para las guías (`idtipo = '09'`) la columna **no la usa el ERP**: está vacía en las 5 bases. Es
solo un marcador. Las 6966 filas con valor en `PuratosSur` y las 5833 de `Pirex` son de otros
`idtipo`.

**El arreglo:** `guardarQrUrl()` → `marcarQrReemplazado()`, que escribe la marca de 4 caracteres
`QR  ` (constante `MARCA_QR`) en vez de la URL. `len('QR  ') = 2 > 0`, con lo que el SP deja de
devolver la guía. Verificado con la sentencia exacta dentro de una transacción con `ROLLBACK` en
las 4 bases: 1 fila actualizada, `codigovalidacion = 'QR'`, y nada persistido.

> La URL del QR no se guarda en ningún lado, y no hace falta: lo que importa es que vaya impresa
> en el PDF, que es lo que se verificó 4/4 con `probar`. Guardar una URL recortada a 4 caracteres
> habría dejado el PDF con un QR inservible.

### La corrida que no debía haber salido

`node src/server.js` **sin argumentos no muestra la ayuda: ejecuta `procesar` de verdad.** Se lanzó
por error creyendo que iba a imprimir el texto de uso, y subió a producción antes de cortar el
proceso a los ~2 minutos. Alcance:

| guía | qué se escribió |
|---|---|
| veryfrut T001-00005258 | PDF reemplazado (39 579 B) y CDR `.xml` actualizado (6163 B), 13:23 |
| veryfrut T001-00005259 | PDF reemplazado (39 514 B) y CDR `.xml` actualizado (6163 B), 13:23 |
| veryfrut T001-00005260 | nada: se cortó antes de llegar al PDF |

Lo que **no** pasó: ningún cambio en las bases. El UPDATE falló en los tres casos por la
truncación, que es justamente el bug de arriba, así que `codigovalidacion` sigue vacío y el ERP no
se enteró. Los dos PDFs que quedaron subidos llevan el QR correcto de SUNAT (mismo resultado que
daba `probar`), o sea que están bien, solo que sedsloguearon antes de tiempo: la próxima corrida
los vuelve a procesar y los marca.

Las otras 263 guías no se tocaron.

### Otros arreglos de la revisión

| Archivo | Cambio |
|---------|--------|
| `src/services/sunat-auth.service.js` | El POST del token SOL no tenía timeout: si `api-seguridad.sunat.gob.pe` se colgaba, la corrida esperaba para siempre. Ahora 30 s |
| `src/services/drive.service.js` | `listar()` no paginaba y cortaba en 1000 archivos. La carpeta de veryfrut tiene 58 078 (29 039 PDF + 29 037 XML): el listado hacía pensar que faltaban 57 000 archivos, y el CDR de un PDF podía no aparecer por estar en la página 2. Ahora recorre todas las páginas y avisa si la lista es enorme |
| `src/server.js` | El nombre del CDR se derivaba con `nombre.replace('.pdf', '.xml')`: si el archivo de Drive no terminaba en `.pdf`, el nombre coincidía y `subir()` sobrescribía el PDF con el XML. Ahora se quita la extensión y se agrega `.xml` |
| `src/server.js` | Código de salida 1 si algún documento falló, para que un trabajo programado lo detecte |
| `src/server.js` | `comandoProcesar` sale temprano y sin hacer ruido si no hay guías pendientes, y devuelve `{resumen, completadas}` |
| `src/services/pendientes.service.js` | Nuevo `guardar()`: escribir el listado sin volver a correr el SP |
| `HISTORY.md` / `guiasnuevo.md` | Corregido: en varios lugares se decía que la URL del QR se guardaba en `codigovalidacion`, lo cual nunca fue posible |

### La definición del SP (leída con `soporte`)

`OBJECT_DEFINITION` sí se puede leer aunque no se pueda ejecutar. Lo que hace, por conexión con
`Guia = 1`, vía `OPENROWSET` a la BD de cada empresa:

```sql
SELECT @ID AS ID, idEmpresa, iddocumento,
       case when Estado in ('2','3') then 1 else 2 end as estado,
       @DriveID AS DriveID
FROM dbo.DOCUMENTOS_SVE
WHERE idTipo = '09' and len(Firma) > 0 and len(codigovalidacion) = 0
  and convert(char(8), fecha_doc, 112) >= '20260901'
  and ((estado in ('2','3')) or (estado = '6' and validado = '1'))
```

Confirma lo que se había deducido: el `DriveID` sale de `admin.dbo.Conexiones.DriveID`, `Estado = 1`
es "el ERP lo sube" y `Estado = 2` es "ya está en SUNAT, cámbiale el QR". El filtro de fecha
`>= 20260901` es fijo y está en el SP, no en la app.

### El CDR: cómo se nombra y qué hace al subirlo

Quedó aclarado y verificado contra Drive, así que queda escrito para no volver a dudarlo:

| paso | archivo | nombre |
|---|---|---|
| SUNAT responde | ZIP `arcCdr` → XML descomprimido en `CDR/` | `R-20607129470-09-T001-00005258.xml` |
| se sube a Drive | `driveService.subir(rutaCdr, nombreCdr, carpeta)` | `20607129470-2026-09-01-20600484266-09-T001-00005258.xml` |

El CDR se **renombra con el mismo nombre base que el PDF en Drive**, cambiando `.pdf` por `.xml`, y
va a la misma carpeta. El renombrado es a propósito: si se subiera con el nombre de SUNAT
(`R-*.xml`) quedaría un archivo suelto al lado del PDF, sin relación con él.

Como ese nombre ya existe en Drive, `subir()` usa `files.update` y **reemplaza el archivo en el
sitio**; no crea duplicados. Por eso el `.xml` de los 2 documentos de la corrida accidental pasó de
14 395 B (puesto por otro proceso, el 2026-09-01) a 6 163 B (el `arcCdr` de SUNAT, el 2026-09-29).

El orden completo por guía, y por qué está en ese orden:

1. bajar el PDF de Drive → 2. reemplazar el QR → 3. subir el PDF →
4. **subir el CDR** → 5. marcar `codigovalidacion`

El CDR va antes de la marca a propósito: si la base falla, el PDF y el CDR ya están en Drive y la
guía se reprocesa sin duplicar nada. Al revés, una guía quedaría marcada sin CDR.

---

## Estado final (2026-09-29)

### El comando

```bash
node src/server.js todo
```

Hace las dos cosas y deja todo listo para la siguiente corrida: pide el listado a
`spPyOValidaGuia`, procesa todo lo que devuelva, reescribe `guias-pendientes.json` con lo que no
se pudo terminar, borra `tmp/` y `CDR/`, cierra las conexiones y sale con código 1 si algún
documento falló.

```bash
node src/server.js todo --simular       # la corrida entera sin escribir nada
node src/server.js todo --limite 1      # una sola, para revisar a mano
node src/server.js todo --conexion 30   # una empresa
```

Los comandos que quedan para diagnóstico: `probar` (una guía por empresa con el QR verificado, sin
escribir), `procesar` (el flujo sobre el listado guardado, sin tocar el SP), `exportar` (solo
refrescar el listado), `pendientes`, `verificar`, `listar`, `drive *`.

### Lo que está hecho y verificado

| | cómo se verificó |
|---|---|
| El QR impreso es el de SUNAT | `probar`, 4/4 coincidencia exacta contra la URL del CDR |
| El PDF se sube a la carpeta correcta de la guía | 4 empresas distintas, cada una en su `DriveID` |
| El CDR se sube con el nombre del PDF, reemplazando | listado de Drive, sin duplicados |
| La URL del QR queda guardada y el SP deja de devolver la guía | sentencia real dentro de una transacción con `ROLLBACK`, en 4 bases, con la URL completa (191 caracteres) |
| El SP se puede correr | 273 guías de 5 empresas, todas con `DriveID` |
| El archivo de pendientes queda con lo que falta | reescrito al terminar, con las 273 filas y después solo las no procesadas |
| No se puede correr dos veces a la vez | candado en `tmp/.corrida.lock`, se recupera si el proceso ya no existe |

### Lo que queda

- **Correrlo de verdad.** Solo se procesaron 2 guías (las de la corrida accidental). Con
  `node src/server.js todo` se procesan las 273.
- **33 guías quedaron con la marca vieja `'QR  '`** en vez de la URL (12 en frutiver, 21 en
  PuratosSur), de las corridas anteriores a que se ampliara la columna. Esas no vuelven a salir del
  SP, así que hay que recoverir la URL a mano.
- **Fuera del alcance de la app, pero conviene:** `driveenviopdf-7a4b8936208f.json` y
  `proyectoalmacenamientowhatsapp-5798b0480329.json` están en git con las claves privadas dentro, y
  los 12 XML de `CDR/` que estaban versionados aparecen como borrados. Sacar las claves del
  historial de git y rotarlas.

---

## Sesión 2026-09-30 — `codigovalidacion` ampliada: vuelve a guardarse la URL del QR

### El problema reportado

> En la actualización de `codigovalidacion` se guarda `QR` y no el enlace.

Tenía razón. La sesión del 2026-09-29 (3) llegó a la conclusión de que **la columna no admitía URLs**
y, para que la guía dejara de salir del SP, cambió `guardarQrUrl()` por `marcarQrReemplazado()`, que
escribía la constante `'QR  '`. Ese era el workaround correcto **con la columna de antes**, pero dejó
de serlo.

### Por qué ya no aplica

Se releyeron `sys.columns` en **las 10 BDs con `Guia = 1`**:

| conexión | BD | tipo de `codigovalidacion` |
|---|---|---|
| 4, 7, 8, 11, 12, 15, 18, 20, 27, 30 | las 10 | **`nvarchar(490)`** |

Se ampliaron en algún momento entre el 2026-09-29 y hoy. La URL real de SUNAT, leída de un CDR, mide
**191 caracteres**:

```
https://e-factura.sunat.gob.pe/v1/contribuyente/gre/comprobantes/descargaqr?hashqr=ZVo/ylfxLxV...
```

Entra holgada. El error `String or binary data would be truncated` que originó el workaround ya
no puede ocurrir, y el `ALTER TABLE` que el 2026-09-29 se recomendó evitar por "cambio de nada" ya
estaba hecho.

### El arreglo

`marcarQrReemplazado()` vuelve a ser `guardarQrUrl()`, y ahora escribe la URL completa:

| Archivo | Cambio |
|---------|--------|
| `src/database/documento.repository.js` | Se eliminó `MARCA_QR` y `marcarQrReemplazado()`. Nueva constante `LARGO_CODIGO_VALIDACION = 490` y `guardarQrUrl(pool, idEmpresa, idDocumento, qrUrl)`, que escribe `@qrurl` con `sql.NVarChar(490)`. Falla con mensaje claro si la URL viene vacía o si mide más de 490 caracteres (mejor que dejar que SQL trunque y quede un enlace inservible) |
| `src/server.js` | Pasa `resultado.qrUrl` a `guardarQrUrl()`. Los mensajes de `simular` y de éxito dicen "guardado el enlace del QR" |
| `guiasnuevo.md` / `HISTORY.md` | Corregido: en varios lugares se afirmaba que la URL no se guardaba y que la columna era `char(4)` |

### Verificación

Sentencia real con la URL de un CDR, en transacción con `ROLLBACK`, en 4 BDs:

```
id=8   frutiver    T001 -00003790: filas=1 largo=191 completa=SI
id=18  PuratosSur  T001 -00002143: filas=1 largo=191 completa=SI
id=30  KaiserCorp  TR20 -00000253: filas=1 largo=191 completa=SI
id=4   coprosat    T001 -00000593: filas=1 largo=191 completa=SI
```

`completa=SI` es comparación carácter por carácter contra la URL del CDR, no solo el prefijo. Nada
quedó persistido. Casos borde: URL de 600 caracteres y URL vacía dan error propio y no llegan al
UPDATE.

### Lo que queda sucio

33 guías de corridas anteriores quedaron con `'QR  '` en vez de la URL: **12 en frutiver** y **21 en
PuratosSur** (el resto de las 10 BDs tiene `codigovalidacion` vacía en todos los `idtipo = '09'`).
Como el SP filtra `len(codigovalidacion) = 0`, esas 33 ya no salen del listado: hay que pedirles la
URL a SUNAT por su `id_sunat` y guardarla.


---

## Sesión 2026-09-30 (2) — El render del QR ya no usa el TEMP del sistema

### El problema reportado

En producción 291 guías quedaron pendientes y 5 fallaron con el mismo error:

```
30/01/260000721200: reemplazar-qr falló: Error: ENOENT: no such file or directory,
mkdtemp 'C:\Users\ADMINI~1\AppData\Local\Temp\2\reemplazar-qr-XXXXXX'
```

No hubo cambios de código para producirlo: en la máquina de producción la variable `TEMP`/`TMP`
del proceso apunta a `...\AppData\Local\Temp\2`, y esa carpeta no existe.

### Por qué pasaba

`reemplazar-qr/src/index.js:146` hacía:

```js
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reemplazar-qr-"));
```

`os.tmpdir()` devuelve lo que diga `TEMP`/`TMP`, así que la ruta del error es la del entorno, no una
ruta fija en el código. **`mkdtemp` crea la carpeta final pero no el padre**, así que si `TEMP`
apunta a un directorio inexistente, la llamada falla con `ENOENT` siempre. Local no se veía porque
`os.tmpdir()` es `/tmp`, que sí existe.

### El arreglo

El render del PNG que se decodifica para detectar el QR se crea ahora en `tmp/`, que es la carpeta
de trabajo de la app (`DIR_TRABAJO`, `src/server.js:24`), la misma donde ya viven los PDF
descargados. Además se crea el padre antes del `mkdtemp`, para que el fallo no vuelva a aparecer
con ninguna otra ruta.

| Archivo | Cambio |
|---------|--------|
| `reemplazar-qr/src/index.js` | Nueva opción `-t, --tmp <carpeta>` (por defecto `os.tmpdir()`, no cambia el uso suelto del script). El padre se crea con `fs.mkdirSync(base, { recursive: true })` antes del `mkdtemp` |
| `src/services/qr.service.js` | `reemplazar()` pasa `--tmp` con la carpeta del PDF de entrada, y la assure con `mkdir` recursivo |

Nada se rompe por el otro lado: el temporal sigue borrándose en el `finally` del propio script, el
`finally` de `src/server.js:439` borra solo los dos PDF (sin recursivo, no toca el subdirectorio) y
`tmp/` completo se elimina al salir (`src/server.js:931`).

### Verificación

Con un PDF real, forzando `TEMP` a una ruta inexistente:

| Prueba | Resultado |
|---|---|
| `mkdtemp` pelado con `TEMP` inexistente (código anterior) | `ENOENT ... mkdtemp '/tmp/.../2/reemplazar-qr-XXXXXX'`, el mismo error de producción |
| Script con `--tmp` | Detecta el QR original, imprime el nuevo y guarda el PDF |
| QR impreso en el PDF resultante | `zbarimg` devuelve la URL nueva, no la de SUNAT |
| Restos `reemplazar-qr-*` | ninguno |

### Lo que queda sucio (no es código)

- **La variable `TEMP` del servidor sigue rota.** El fix esquiva el síntoma para esta app, pero
  cualquier otra cosa que use `os.tmpdir()` en ese servidor va a fallar igual. Corregir `TEMP`/`TMP`
  en la tarea programada (o en las variables de sistema) para que apunte a
  `%USERPROFILE%\AppData\Local\Temp` y no a `...\Temp\2`.
- **Los 5 DriveID inaccesibles** (`1Rf8Zs2Usa...`, `1L1RAiR2zFx...`, `1kTEyLeU5z8...`,
  `1Y2JW1BUY6Q...`, `1sXXbiT3jIU...`) y las 286 guías que dependen de ellos siguen sin procesar. No es
  este error: es que esas carpetas no existen, fueron movidas o no están compartidas con la cuenta
  de servicio `driveenviopdf-7a4b8936208f.json` (permiso lector y escritor).

### Corolario: `spawnSync pdftoppm ENOENT` en producción

Al corregir lo anterior, la corrida llegó un paso más allá y falló en todos los documentos:

```
7/01/260000418600: reemplazar-qr falló: Error: spawnSync pdftoppm ENOENT
```

Nada que ver con el temporal. `pdftoppm` (poppler-utils) **no está en el PATH** del proceso que
corre la app en el servidor: la tarea programada de Windows hereda un PATH mínimo, sin poppler. El
error de `mkdtemp` de antes lo tapaba, porque `reemplazar-qr` creaba el temporal antes de
rasterizar.

Aclaración de lectura del log: `PDF en Drive [id] nombre.pdf` (server.js:314) significa **encontrado
en Drive**, no subido. Se loguea antes de reemplazar el QR, así que esas líneas no son prueba de que
el reemplazo haya funcionado.

El arreglo es no depender del PATH:

| Archivo | Cambio |
|---------|--------|
| `src/config/index.js` | Nuevo bloque `herramientas.pdftoppm` / `herramientas.zbarimg`, con `PDFTOPPM` y `ZBARIMG` del `.env` y default al nombre a secas |
| `reemplazar-qr/src/index.js` | Nueva opción `-b, --pdftoppm <ruta>` (default `pdftoppm`). `renderizarPagina()` traduce el `ENOENT` de Node, que no dice nada útil, a un mensaje que sí dice qué falta y cómo se arregla |
| `src/services/qr.service.js` | `reemplazar()` pasa `--pdftoppm` con la ruta de config; `leerQr()` usa las rutas configuradas en vez de los literales |

Con eso, en producción:

```ini
# .env de C:\inetpub\wwwroot\api_CPE
PDFTOPPM=C:\poppler\Library\bin\pdftoppm.exe
```

La ruta se obtiene con `where pdftoppm` en un cmd donde sí funcione. Si `where` no devuelve nada,
poppler no está instalado en el servidor y hay que instalarlo (los binarios de Windows de
https://github.com/oschwartz10612/poppler-windows). Con el default (`pdftoppm` a secas) todo sigue
funcionando igual que antes en los equipos donde sí está en el PATH.

Verificado con un PATH sin poppler: sin `--pdftoppm` sale el mensaje explicativo, y con la ruta
absoluta el PDF sale con el QR nuevo y `zbarimg` lo lee bien.
