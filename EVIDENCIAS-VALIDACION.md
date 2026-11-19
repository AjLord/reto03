# Evidencias de validación del Reto 03

Este documento resume comprobaciones ya realizadas en el entorno local del ejecutor y separa esas evidencias de las nuevas pruebas de hardening que deben ejecutarse después de actualizar el proyecto.

## 1. Evidencias locales observadas antes del hardening

El registro `out/sap/ordenes.jsonl` mostrado en PowerShell contenía cuatro órdenes:

| Solicitud | Orden de compra | Resultado observado |
|---|---:|---|
| `SOL-2026-001` | `4500000001` | Creada |
| `SOL-2026-004` | `4500000002` | Creada tras excepción RC5 |
| `SOL-2026-005` | `4500000003` | Creada tras excepción RC8; retroactiva |
| `SOL-2026-006` | `4500000004` | Creada tras excepción RC6 |

Los casos `sol-002` y `sol-003` fueron bloqueados durante la demostración por RC1 (proveedor inexistente) y RC2 (aprobador no autorizado). No figuraban como órdenes creadas en el JSONL compartido.

El agrupamiento ejecutado en PowerShell devolvió una orden por cada referencia:

```text
SOL-2026-001     1
SOL-2026-004     1
SOL-2026-005     1
SOL-2026-006     1
```

## 2. Integridad de la evidencia de SOL-2026-001

La evidencia `out/sol-001/aprobacion.txt` contiene el remitente, destinatario, fecha, asunto y cuerpo de la aprobación. El SHA-256 almacenado en la orden y comunicado por el ejecutor fue:

```text
c07ae6426133178cb0bfe83753e232fffab3886a67723b7a61c39cf92a0915ab
```

Se reconstruyó el texto de evidencia a partir de `fixtures/reto-03/solicitudes/sol-001/aprobacion.json` con el mismo formato UTF-8 usado por la herramienta. El SHA-256 calculado coincidió exactamente con el hash anterior.

## 3. Cambios de hardening incluidos en esta versión

- `oc_consultar_orden`: consulta de solo lectura del registro SAP simulado.
- Reconstrucción del payload canónico en backend y comparación integral antes de crear.
- Esquema Zod estricto para rechazar propiedades adicionales o inesperadas en el payload.
- Confirmación de excepción vinculada a sesión, solicitud, hash del payload y expiración de diez minutos.
- Bloqueo de escritura de archivo para serializar la creación de órdenes y evitar duplicados concurrentes en el mock local.
- API limitada a `127.0.0.1`, validación de entrada, tamaño máximo de mensaje y límite básico por sesión.
- API key de Gemini enviada mediante `x-goog-api-key`, no como parámetro de URL.
- Panel de herramientas con estado, duración y detalle resumido; el detalle de frontend no incluye documentos ni payload completos.
- Botón de nueva conversación y control de presupuesto de tokens antes de consultar al modelo.

## 4. Pruebas pendientes de ejecución en el equipo Windows

Las siguientes pruebas están automatizadas en `security-smoke.ts` y se ejecutan con:

```powershell
bun run typecheck
bun run test:security
```

El test crea un directorio temporal y no modifica `out/` del proyecto. Comprueba que RC5 no puede crearse sin autorización vinculada, que un payload alterado se rechaza, que una autorización válida permite la creación, que la herramienta de consulta encuentra el registro y que dos intentos concurrentes generan una sola orden.

**Nota:** los resultados locales de la sección 1 pertenecen al entorno de demostración anterior y no se incluyen dentro del ZIP. La carpeta `out/` se excluye deliberadamente del entregable para conservar la separación entre código y artefactos de ejecución.
