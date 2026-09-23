# Tarea GUIAS - Guías de Remisión Electrónicas (SUNAT)

Aplicación **interna**, sin API ni interfaz gráfica. Se ejecuta manualmente con `node src/server.js`.

Flujo: revisar guías en SUNAT, obtener CDR/QR, generar PDF nuevo con QR reemplazado y subirlo a Drive.

## Estado actual

| # | Paso | Estado | Dónde |
|---|------|--------|-------|
| 1 | Revisar guías pendientes desde la BD | ✅ Implementado | `node src/server.js listar` (usa `documentos_sve`, estado 2/3, tipo 09) |
| 2 | Verificar estado en SUNAT (por ticket) | ✅ Implementado | `node src/server.js verificar <ticket>` → `sunat-gre.service.js` |
| 3 | Obtener el CDR | ✅ Implementado | `sunat-gre.service.js` + `cdr.service.js` (guarda el XML en `CDR/`) |
| 4 | Obtener el `qr_url` del CDR | ✅ Implementado | `cdr.service.js → extraerQrUrl()` (lee `cbc:DocumentDescription`) |
| 5 | Buscar el PDF de la guía en Drive por nombre | ✅ Implementado | `node src/server.js drive listar|buscar|descargar` → `drive.service.js` (folder id en `driveid.txt`) |
| 6 | Generar nuevo PDF de la guía con el QR reemplazado | 🚧 Parcial | Proyecto **`reemplazar-qr/`** listo y probado. Falta llamarlo desde el flujo interno |
| 7 | Actualizar la guía con el nuevo `qr_url` | ⬜ Pendiente | Falta método en `src/database/documento.repository.js` |
| 8 | Subir el nuevo PDF + CDR a Drive y eliminar el antiguo | ⬜ Pendiente | Falta `upload`/`delete` en `drive.service.js` |

> **Nota sobre el ticket:** la API REST de SUNAT para GRE solo consulta por `numTicket`
> (`GET .../comprobantes/envios/{numTicket}`); no existe consulta por serie-número.
> El campo `id_sunat` de la BD guarda justamente ese ticket, así que se puede verificar
> directamente con él.

## Cómo ejecutar (app interna manual)

```bash
node src/server.js listar                  # guías pendientes de la BD (idEmpresa por defecto: 01)
node src/server.js verificar <ticket>      # estados en SUNAT + CDR + qr_url
node src/server.js drive listar            # lista la carpeta de Drive (id en driveid.txt)
node src/server.js drive buscar <nombre>   # busca un archivo en Drive por nombre
node src/server.js drive descargar <nombre> # lo descarga a documentosReferencia/
node src/server.js procesar                # flujo completo: guías -> verificar -> buscar PDF en Drive
```

## Estructura actual (solo flujo CLI interno)

```
├── server.js                    # CLI (/src) — único punto de entrada
├── src/
│   ├── config/index.js          # Variables de entorno (db, sunat, cdr, drive)
│   ├── database/connection.js   # Conexión SQL Server (mssql)
│   ├── database/documento.repository.js # Guías pendientes, ticket, actualizar estado
│   ├── services/sunat-auth.service.js   # Token OAuth2 SUNAT
│   ├── services/sunat-gre.service.js    # Consulta estado por ticket + CDR/QR
│   ├── services/cdr.service.js          # Descomprime CDR y extrae qr_url
│   ├── services/zip.service.js          # Descompresión de ZIP (CDR)
│   └── services/drive.service.js        # Listar/buscar/descargar en Drive
└── reemplazar-qr/               # Proyecto independiente para el QR
```

> **Limpieza 2026-09-23:** se eliminó todo el flujo de API/emisión (controllers, routes,
> models, xml [builder/signer/catalogos], vista `public/`, `empresa.repository`,
> `guia.mapper`, `guia-remision.service`) y las dependencias asociadas
> (express, cors, soap, node-forge, xml-crypto, xmlbuilder2). Certificados PFX,
> `CDR/` y `documentosReferencia/` se conservan.

## Reemplazo de QR (proyecto reemplazar-qr)

```bash
cd reemplazar-qr
node src/index.js -e <comprobante.pdf> -q <qr_url> [-s <salida.pdf>] [-p <pagina>]
```

Detecta el QR del PDF, lo borra y lo reemplaza por uno nuevo con el `qr_url` del CDR.
Requiere `pdftoppm` (poppler-utils).