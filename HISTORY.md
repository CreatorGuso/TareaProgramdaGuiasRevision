# Historial de Desarrollo - Guías de Remisión Electrónicas

## Contexto General

Sistema para emitir Guías de Remisión Electrónicas (GRE) ante SUNAT (Perú) desde una API Node.js, conectando a una base de datos SQL Server existente que ya tiene la data de empresas y documentos.

**Fecha de inicio:** 2026-08-20

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

## Lo que se creó hasta ahora

### Archivos del proyecto (`greenter-api/`):

```
├── .env                          # Config DB + SUNAT
├── package.json                  # Dependencias
├── src/
│   ├── server.js                 # Express app (puerto 3000)
│   ├── config/index.js           # Variables de entorno
│   ├── database/
│   │   ├── connection.js         # Conexión SQL Server (mssql)
│   │   ├── empresa.repository.js # SELECT de v_empresas
│   │   └── documento.repository.js # Pendientes, detalle (SP), actualizar estado
│   ├── models/                   # Modelos de dominio
│   │   ├── Despatch.js           # Guía de Remisión principal
│   │   ├── DespatchDetail.js     # Líneas/items
│   │   ├── Shipment.js           # Envío (motivo, modalidad, peso, etc.)
│   │   ├── Direction.js          # Dirección (partida/llegada)
│   │   ├── Transportist.js       # Transportista
│   │   ├── Driver.js             # Chofer (principal/secundario)
│   │   ├── Vehicle.js            # Vehículo (placa, secundarios)
│   │   ├── Puerto.js             # Puerto/aeropuerto
│   │   ├── AdditionalDoc.js      # Docs relacionados
│   │   ├── Company.js            # Empresa emisora
│   │   ├── Client.js             # Cliente/destinatario
│   │   └── DetailAttribute.js    # Atributos de item
│   ├── xml/
│   │   ├── builder.js            # Genera XML UBL 2.1 (formato 2022)
│   │   ├── signer.js             # Firma digital con PFX/P12
│   │   └── catalogos.js          # Catálogos SUNAT (06, 18, 20, etc.)
│   ├── services/
│   │   ├── guia.mapper.js        # Mapea BD → modelos de dominio
│   │   ├── guia-remision.service.js # Flujo: XML → firmar → SUNAT
│   │   ├── sunat-auth.service.js # OAuth2 token SUNAT
│   │   ├── sunat-gre.service.js  # Enviar/consultar GRE REST API
│   │   └── zip.service.js        # Comprimir XML con SHA-256
│   ├── controllers/
│   │   └── guia.controller.js    # Endpoints API
│   └── routes/
│       └── guia.routes.js        # Rutas Express
```

### Endpoints implementados:

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/guias/pendientes/:idEmpresa` | Guías pendientes |
| GET | `/api/guias/detalle/:idEmpresa/:idOficina/:idDocumento` | Detalle via SP |
| POST | `/api/guias/emitir` | Emitir guía a SUNAT |
| POST | `/api/guias/emitir-lote` | Emitir varias guías |
| GET | `/api/guias/estado/:ticket` | Consultar estado |
| GET | `/health` | Health check |

---

## Pendiente / Por hacer

1. **Ajustar `guia.mapper.js`** - Los campos del SP (`sppyomuestradocumentos`) necesitan ser mapeados correctamente. Falta ejecutar el SP y ver qué columnas devuelve exactamente para mapear: ubicación partida/llegada, transportista, vehículo, chofer, items, etc.

2. **Probar conexión a SQL Server** - Verificar que la config de `.env` conecta bien.

3. **Probar firma digital** - El signer.js usa `DOMParser` que no existe en Node. Hay que usar una librería como `xmldom` o `@xmldom/xmldom` para parsear XML en Node.

4. **Ajustar envío a SUNAT** - Verificar si usan REST API o SOAP (el campo `soapguia` de v_empresas sugiere SOAP legacy).

5. **Agregar manejo de errores SUNAT** - Códigos de error del Catálogo SUNAT.

6. **Crear la vista en BD** - `documentos_sve` con los campos necesarios para guías pendientes.

7. **PDF de la guía** - Generar representación impresa de la GRE.

8. **Pruebas unitarias** - Tests para XML builder, mapper, etc.

---

## Dependencias Node.js instaladas

| Paquete | Versión | Uso |
|---------|---------|-----|
| express | ^4.18.2 | Servidor HTTP |
| cors | ^2.8.5 | CORS |
| dotenv | ^16.3.1 | Variables .env |
| mssql | ^10.0.1 | SQL Server |
| xmlbuilder2 | ^3.1.1 | Generar XML |
| xml-crypto | ^3.2.1 | Firma XML |
| node-forge | ^1.3.1 | Certificados X.509 |
| jszip | ^3.10.1 | ZIP |
| axios | ^1.6.2 | HTTP client |
| soap | ^1.0.0 | SOAP client |
| winston | ^3.11.0 | Logging |

---

## Notas del usuario

- El git del workspace (`guiassunatapi/greenter`) NO es del usuario, no hacer push
- La empresa usa certificado PFX: `20507795642PFX` con clave `kukyflor22`
- Usuario SOL: `SISTEMPO`, Clave SOL: `Kuky2024$`
- Endpoint SOAP guía: `https://e-guiaremision.sunat.gob.pe/ol-ti-itemision-guia-gem/billService`

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

## PENDIENTE — QR de la guía desde el CDR (2026-09-16)

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

