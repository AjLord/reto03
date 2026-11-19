# SOLUCION — Reto 03: Agente conversacional de órdenes de compra SAP

## 1. Problema en una frase

Busqué reducir el trabajo manual que realiza una analista administrativa al preparar órdenes de compra, consolidando la información de la solicitud, cotización y aprobación, validándola contra los maestros y controles definidos, y dejando preparada la creación de la OC en un SAP simulado.

## 2. Arquitectura

La solución está dividida en una interfaz conversacional, un backend que controla el ciclo del agente, las herramientas de negocio y un adaptador que simula SAP mediante archivos locales.

```text
Navegador (web)
   │
   ▼
Interfaz de chat
   │ POST /api/chat
   ▼
Backend HTTP (Hono, 127.0.0.1)
   ├── AgentService / ciclo de ejecución
   │      ├── Adaptador LLM: Google Gemini
   │      └── Herramientas tipadas y validadas con Zod
   │             ├── oc_leer_paquete
   │             ├── oc_validar
   │             ├── oc_generar_evidencia
   │             ├── oc_construir_payload
   │             ├── oc_consultar_orden
   │             └── oc_crear
   ├── Fixtures y maestros (solo lectura)
   └── out/ (evidencias, trazabilidad, logs y mock SAP)
```

El comportamiento del agente está definido en `agent/prompt.md`; el conocimiento del proceso se encuentra en `src/knowledge/ordenes-compra.md`; y la lógica de ejecución y controles está separada en `src/agent.ts` y `src/tools/oc.ts`. Esta separación permite ajustar el comportamiento o el conocimiento del proceso sin depender de cambios en el servidor HTTP.

El backend utiliza Hono y TypeScript con Bun. Las herramientas se validan mediante Zod y el adaptador SAP simulado persiste los registros localmente.

## 3. Ciclo del agente

El flujo que implementé es el siguiente:

1. La analista indica en el chat qué solicitud desea procesar.
2. El agente utiliza `oc_leer_paquete` para leer y normalizar la información disponible: correo, solicitud, cotización, aprobación y factura cuando existe.
3. `oc_validar` aplica los controles RC1–RC10 contra los fixtures y maestros. Los bloqueos impiden continuar; las confirmaciones requieren una decisión explícita.
4. `oc_generar_evidencia` genera el archivo de aprobación en texto y calcula su SHA-256.
5. `oc_construir_payload` prepara el payload de la orden a partir de los datos y validaciones obtenidos desde el backend, y genera la trazabilidad de los campos.
6. Cuando existen excepciones, el agente presenta el motivo y espera una confirmación explícita. La autorización queda asociada a la sesión, solicitud, hash del payload y un tiempo de expiración.
7. `oc_crear` vuelve a validar los controles, reconstruye el payload esperado y compara su contenido con el recibido. Si no coincide o no existe autorización válida, rechaza la operación.
8. Si la creación procede, el adaptador simulado registra la OC y devuelve el número asignado. Si ya existe una OC para la misma solicitud, se recupera el registro existente en lugar de generar uno nuevo.
9. Las llamadas a herramientas se presentan en la interfaz con su nombre, estado, resumen y duración. Los registros de ejecución también se conservan en los archivos de salida.

El ciclo tiene un límite configurable de iteraciones, un presupuesto de tokens por sesión, validación del tamaño de entrada y manejo de errores del proveedor. Las sesiones de conversación se mantienen en memoria; los registros de órdenes y las evidencias se conservan en archivos.

## 4. Elección del modelo

Utilicé Google Gemini como proveedor del modelo de lenguaje, a través de una implementación separada en `src/llm/gemini.ts` que cumple la interfaz definida en `src/llm/adapter.ts`.

La integración utiliza Function Calling para que el modelo solicite las herramientas disponibles. El modelo se configura mediante la variable `GEMINI_MODEL` y la clave se obtiene desde `GEMINI_API_KEY` en el backend. La clave se envía mediante el encabezado `x-goog-api-key` y no se incorpora al frontend ni a las respuestas del endpoint de salud.

Elegí esta integración por su disponibilidad, facilidad para implementar llamadas a herramientas y capacidad de mantener el ciclo del agente desacoplado del proveedor. El modelo interpreta las instrucciones y organiza la conversación; las reglas de negocio y las operaciones que pueden crear una OC se ejecutan y validan en el backend.

No fijé un costo por solicitud porque depende del modelo configurado, tokens de entrada y salida, y tarifas vigentes del proveedor. Para producción mediría el consumo real por caso y establecería límites de presupuesto.

## 5. Matriz de controles RC1–RC10

| Control | Implementación | Resultado |
|---|---|---|
| RC1 — Proveedor | Consulta por NIT o nombre normalizado y validación de estado activo en el maestro. | Bloquea proveedor inexistente o inactivo. |
| RC2 — Aprobación y aprobador | Verifica existencia de aprobación, presencia de “Aprobado” y remitente autorizado para el centro de costo. | Bloquea si no cumple. |
| RC3 — Tope del aprobador | Compara el valor de la solicitud con el tope asignado al aprobador para el centro de costo. | Bloquea cuando excede el tope. |
| RC4 — Centro de costo/subárea | Verifica que la subárea pertenezca al centro de costo indicado. | Bloquea si no corresponde. |
| RC5 — Cotización | Compara el valor de la cotización con el de la solicitud; aplica el umbral del 2%. La ausencia de cotización también se trata como excepción. | Requiere confirmación cuando corresponde. |
| RC6 — Indicador de IVA | Si no viene informado, deriva el indicador desde el maestro del proveedor. | Informa el valor derivado y requiere confirmación. |
| RC7 — Condiciones de pago | Si no vienen informadas, utiliza las condiciones predeterminadas del proveedor. | Informa el derivado. |
| RC8 — Retroactividad | Compara la fecha de factura con la fecha de solicitud. Si la factura es anterior, marca el caso como retroactivo. | Requiere confirmación y registro. |
| RC9 — Fecha de aprobación | Compara la fecha de aprobación con la fecha de solicitud. | Requiere confirmación si la aprobación es anterior. |
| RC10 — Consistencia de valores | Verifica cantidad por precio unitario frente al total, con tolerancia de una unidad monetaria. | Bloquea si no coincide. |

La validación de estas reglas se realiza en código y no depende de que el modelo las calcule o interprete correctamente. El modelo comunica el resultado y solicita la decisión humana cuando el control lo requiere.

La parte que considero más importante desde el punto de vista de seguridad es que el backend no toma como autoridad el payload que propone el modelo. Antes de crear la orden vuelve a reconstruirlo desde las fuentes del proyecto y verifica su integridad.

## 6. Diseño del adaptador SAP real

La conexión con SAP real no está implementada, porque el alcance del reto contempla un simulador y no confirma la viabilidad de integración con un sistema SAP específico.

Como primera alternativa evaluaría la API OData `API_PURCHASEORDER_PROCESS_SRV`, siempre que la versión, configuración y autorizaciones del landscape la soporten. Esta alternativa permite trabajar mediante un contrato HTTP y facilita la integración y trazabilidad. Si el entorno requiere una integración basada en RFC/BAPI, evaluaría `BAPI_PO_CREATE1` a través de un middleware aprobado por la organización.

El mapeo contemplaría la cabecera de la orden, sociedad, organización de compras, proveedor, moneda, condiciones de pago, aprobador y posiciones, incluyendo descripción, cantidad, precio, centro de costo, subárea e indicador de IVA. También conservaría una referencia externa asociada al identificador de la solicitud.

Las credenciales no estarían disponibles para el agente ni para el modelo. Se administrarían desde un gestor de secretos o mecanismo corporativo de integración, con permisos mínimos y rotación.

Para evitar duplicados ante reintentos, usaría una referencia externa única de la solicitud y una verificación transaccional en el middleware o en la capa de integración. Si la respuesta de SAP fuera ambigua por un timeout, consultaría la orden por esa referencia antes de intentar crearla nuevamente. Los errores parciales se registrarían con identificador de correlación y estado de operación, sin asumir que una respuesta de error significa que la OC no fue creada.

Como plan alternativo, el agente podría generar el payload validado y un archivo de carga o formato de revisión para que el equipo de Compras complete la creación en SAP, conservando la trazabilidad y la evidencia de aprobación.

## 7. Lectura del proceso: compras retroactivas

El control de solicitudes retroactivas permite identificar casos en los que la factura tiene una fecha anterior a la solicitud de compra. Considero que estos casos deben tratarse como una desviación del proceso y no solamente como una validación de fechas.

La información que genera el agente permitiría medir cuántas solicitudes se tramitan de manera retroactiva, identificar las áreas y proveedores involucrados y analizar las causas. Recomendaría establecer un procedimiento para documentar y autorizar estas excepciones, y reforzar que la solicitud de compra y la aprobación se gestionen antes de adquirir el compromiso comercial, salvo situaciones justificadas.

En el reto, el agente identifica la condición, la marca y solicita confirmación; no define por sí mismo una política corporativa para aceptar o rechazar compras retroactivas.

## 8. Decisiones y trade-offs

1. **Validaciones deterministas en backend:** mantuve las reglas de negocio fuera del modelo para evitar que una interpretación del lenguaje natural pueda modificar controles o autorizar una compra. Esto requiere mantener lógica explícita, pero hace el resultado más verificable.
2. **Persistencia mediante archivos:** el simulador utiliza archivos locales y JSONL, lo que simplifica la demostración y permite inspeccionar los registros. No ofrece las garantías transaccionales de una base de datos distribuida.
3. **Confirmaciones vinculadas al payload:** la autorización se asocia a una sesión, solicitud, hash y expiración. Esto evita que una confirmación se reutilice sobre un contenido diferente, aunque en producción también sería necesario identificar y autorizar al usuario mediante mecanismos corporativos.
4. **Trazabilidad resumida en la interfaz:** se muestran resultados, estados y duración de las herramientas, sin presentar indiscriminadamente documentos completos o payloads en la interfaz.
5. **Servidor local:** la aplicación escucha en `127.0.0.1` para la demostración. No lo considero un despliegue público seguro; para compartirlo sería necesario incorporar autenticación, autorización, controles de red y gestión de secretos.
6. **Modelo como coordinador, no como autoridad de datos:** el modelo decide cuándo solicitar herramientas, pero los datos de negocio, los controles y la creación de la OC se verifican en el backend.

## 9. Supuestos

- Los fixtures y maestros entregados para el reto representan las fuentes de información disponibles y se utilizan como referencia para validar las solicitudes.
- El SAP del reto es un simulador local; no se realiza una creación de órdenes en un sistema SAP real.
- Los documentos están normalizados en JSON y texto. La lectura directa de archivos Excel o PDF binarios no está incluida en el alcance implementado.
- La autorización de excepciones en la demostración corresponde a la confirmación realizada desde la sesión de chat. No se valida la identidad corporativa del usuario.
- Las unidades y datos de las posiciones se normalizan conforme a la información disponible en los fixtures.
- La persistencia del simulador se realiza en archivos locales y no sustituye una base de datos ni una capa transaccional para producción.

## 10. Cobertura de historias de usuario

| Historia | Estado | Cobertura y pendiente para producción |
|---|---|---|
| HU-1 — Leer paquete | Implementada para fixtures | La lectura se realiza sobre JSON/TXT. Pendiente incorporar lectura de adjuntos binarios y conectores de correo/documentos. |
| HU-2 — Validar maestros y controles | Implementada para los fixtures | Aplica RC1–RC10 contra los maestros del reto. En producción se requerirían fuentes corporativas actualizadas y controles de acceso. |
| HU-3 — Construir payload | Implementada | Construcción, validación y trazabilidad del payload. Pendiente validación contra el customizing y estructura real de SAP. |
| HU-4 — Generar evidencia | Implementada en TXT y hash | Genera evidencia textual de aprobación y SHA-256. En producción se requeriría repositorio documental, retención y política de integridad. |
| HU-5 — Crear OC en SAP simulado | Implementada en el mock | Persistencia, consulta y control de idempotencia en el simulador. Pendiente integración SAP real. |
| HU-6 — Manejo de errores | Parcial | Se manejan errores de herramientas, validación y proveedor con respuestas legibles. Para producción falta observabilidad central, alertamiento y operación formal de incidentes. |

## 11. Uso de IA

Utilicé ChatGPT y Gemini como asistentes durante el desarrollo para apoyar el diseño de la solución, revisar código, analizar errores, mejorar la implementación de herramientas, preparar pruebas y revisar controles de seguridad.

Las propuestas se contrastaron con los requisitos del reto y con el comportamiento del código. No delegué en el modelo la decisión de validar una compra o autorizar una creación: esas decisiones se implementaron mediante controles deterministas en backend.

Descarté enfoques en los que el modelo pudiera modificar valores de negocio, resolver excepciones por su cuenta o considerar una confirmación sin validación del backend, porque no ofrecen suficiente trazabilidad ni control sobre la operación.

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación implementada o propuesta |
|---|---|
| Instrucciones maliciosas en documentos (prompt injection). | Los documentos se consideran datos y el agente tiene un conjunto limitado de herramientas. Los controles y la ejecución se mantienen en backend. |
| Manipulación del payload por el modelo o el cliente. | Reconstrucción canónica, esquema estricto y comparación integral antes de la creación. |
| Confirmación reutilizada o fuera de contexto. | Confirmación vinculada a sesión, solicitud, hash del payload y expiración. |
| Duplicados por concurrencia o reintentos. | Idempotencia por solicitud y bloqueo de escritura en el simulador local. Para producción se requiere unicidad transaccional. |
| Exposición de la API de demostración. | El servidor escucha en loopback y valida entradas y origen. Para despliegue compartido se requiere autenticación, autorización y controles de red. |
| Exposición de secretos. | La clave del modelo se obtiene desde una variable de entorno del backend y no se muestra en el endpoint de salud ni en los logs. |
| Pérdida de sesión. | Las sesiones son temporales y viven en memoria. Para producción se requeriría persistencia segura, expiración y cifrado. |
| Falsificación o falta de autenticidad de la aprobación. | En el reto se valida la estructura y el remitente contra los fixtures. En producción debe verificarse el origen del correo y la identidad mediante integración corporativa. |
| Integración real con SAP y errores parciales. | Diseñar idempotencia, correlación, consulta antes de reintentar y registro de estados en una capa de integración. |
| Auditoría y retención. | Los archivos locales sirven para la demostración. En producción se requiere almacenamiento central, políticas de retención y controles de acceso. |

## 13. Evidencias de validación

Durante las pruebas locales se observaron los siguientes registros en el simulador:

| Solicitud | Número de OC observado | Resultado |
|---|---:|---|
| SOL-2026-001 | 4500000001 | Creada |
| SOL-2026-004 | 4500000002 | Registro existente en el simulador, asociado al caso con excepción RC5 |
| SOL-2026-005 | 4500000003 | Registro asociado a la excepción retroactiva RC8 |
| SOL-2026-006 | 4500000004 | Registro asociado a la confirmación RC6 |

También se validó el bloqueo de `sol-002` por proveedor inexistente (RC1) y de `sol-003` por el control de aprobación (RC2) durante la demostración.

La evidencia de `sol-001` incluye el archivo de aprobación y su SHA-256. El hash reconstruido a partir del contenido del fixture coincidió con el registrado:

`c07ae6426133178cb0bfe83753e232fffab3886a67723b7a61c39cf92a0915ab`

Se incorporaron pruebas automatizadas de seguridad en `security-smoke.ts`, ejecutadas mediante `bun run test:security`, que verifican autorización vinculada para una excepción, rechazo de payload alterado, consulta de solo lectura y prevención de duplicados en solicitudes concurrentes. La comprobación de tipos se realiza con `bun run typecheck`.

Los registros de la ejecución local no se incluyen en el paquete de entrega; el archivo `EVIDENCIAS-VALIDACION.md` describe los resultados observados y las comprobaciones automatizadas.

