# Agente de Órdenes de Compra SAP — Reto 03

Agente conversacional para leer solicitudes de compra, validar controles RC1–RC10, generar evidencias, preparar un payload canónico y registrar órdenes en un SAP simulado.

## Requisitos
- Bun 1.4 o superior.
- API key de Google AI Studio para habilitar Gemini. El `demo.ts` funciona sin API key.

## Instalación y ejecución
1. Descomprime el proyecto.
2. Abre PowerShell en la carpeta `reto-03`.
3. Ejecuta `bun install`.
4. Copia `.env.example` como `.env` y configura `GEMINI_API_KEY`.
5. Ejecuta `bun run dev` y abre `http://127.0.0.1:3002` (o el puerto configurado en `.env`).

```powershell
Copy-Item .env.example .env
notepad .env
bun install
bun run dev
```

La aplicación se enlaza a `127.0.0.1` (loopback) para la demostración local. No la expongas a Internet ni a una red corporativa sin incorporar autenticación, autorización por rol, gestión de secretos y controles de despliegue.

## Variables de entorno
- `GEMINI_API_KEY`: clave de Google AI Studio. Solo se lee en backend.
- `GEMINI_MODEL`: modelo Gemini a consultar.
- `PORT`: puerto HTTP local (por defecto `3002`).
- `MAX_TOOL_ITERATIONS`: máximo de iteraciones de herramientas por turno (por defecto `25`).
- `MAX_SESSION_TOKENS`: presupuesto aproximado/acumulado por sesión (por defecto `30000`).

## Demo determinista sin modelo

```powershell
bun run demo.ts
```

Procesa los seis casos, muestra bloqueos y confirmaciones, genera evidencia y verifica idempotencia. **La demo limpia `out/` al inicio**: antes de ejecutarla sobre un proyecto que ya tenga órdenes, conserva una copia de esa carpeta. Para probar hardening sin tocar los registros existentes, usa `bun run test:security`.

## Pruebas de seguridad y verificación

```powershell
bun run typecheck
bun run test:security
```

`test:security` trabaja en una carpeta temporal y valida autorización RC5, rechazo de payload manipulado, consulta de solo lectura e idempotencia concurrente. No modifica `out/` del proyecto.

## API local
- `GET /api/health`: estado del backend y modelo; nunca devuelve la clave.
- `POST /api/chat`: `{ "sessionId": "UUID opcional", "message": "Analiza sol-001" }`.
- `GET /api/sessions/:id`: resumen del historial en memoria de una sesión.
- `DELETE /api/sessions/:id`: elimina una sesión de memoria.

La API valida el cuerpo, limita el tamaño del mensaje y aplica un límite básico de solicitudes por sesión. La demo local no incorpora identidad empresarial ni autenticación de usuarios.

## Herramientas
- `oc_leer_paquete`: lectura y normalización de documentos.
- `oc_validar`: validación determinista de RC1–RC10.
- `oc_generar_evidencia`: evidencia TXT y SHA-256.
- `oc_construir_payload`: reconstrucción canónica y trazabilidad de campos.
- `oc_consultar_orden`: consulta de solo lectura en SAP simulado.
- `oc_crear`: revalidación, comparación integral del payload y creación idempotente.

El panel de trazabilidad presenta el resultado, estado y duración de cada herramienta. Los detalles mostrados al usuario están resumidos y no incluyen el payload completo ni el contenido documental en bruto.

## Evidencias de validación

Consulta `EVIDENCIAS-VALIDACION.md` para el resumen de los cuatro registros observados en la ejecución anterior, la coincidencia del hash de aprobación de `sol-001` y las pruebas de hardening incluidas.

## Artefactos
- `out/<caso>/aprobacion.txt`: evidencia del correo y hash calculado.
- `out/<caso>/trazabilidad.json`: procedencia de los campos y controles aplicados.
- `out/sap/ordenes.jsonl`: órdenes creadas por SAP simulado.
- `out/control.csv`: resultados de controles y operaciones.
- `out/log.jsonl`: registro resumido de llamadas a herramientas.

## Limitaciones y siguientes pasos para producción
- SAP es simulado; no se realizan llamadas a sistemas de Periferia IT.
- Los fixtures normalizan Excel/PDF a JSON/TXT; no se procesa binario.
- Las sesiones viven en memoria y expiran; los registros de órdenes persisten en archivos.
- La idempotencia del mock usa un bloqueo de archivo para serializar escrituras locales. Para despliegue distribuido se requiere una base de datos con restricción única transaccional.
- Antes de producción se requiere autenticación/autorización empresarial, auditoría inmutable, gestión segura de secretos y controles de privacidad.
