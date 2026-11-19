import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool, type ToolContext } from "./src/tools/oc";
import { sha256, stableStringify } from "./src/utils";

type Result = { ok: boolean; data?: Record<string, unknown>; error?: string };
async function call(root: string, sessionId: string, name: string, args: Record<string, unknown>, authorization?: ToolContext["authorization"]): Promise<Result> {
  const raw = await executeTool(name, args, { directory: root, sessionId, authorization });
  return JSON.parse(raw) as Result;
}
function assert(condition: boolean, message: string): void { if (!condition) throw new Error(`FAIL: ${message}`); console.log(`PASS: ${message}`); }

async function prepareCase(root: string, sessionId: string, caso: string): Promise<Record<string, unknown>> {
  const pkg = await call(root, sessionId, "oc_leer_paquete", { caso });
  assert(pkg.ok, `${caso}: lectura del paquete`);
  const validation = await call(root, sessionId, "oc_validar", { caso, paquete: pkg.data ?? {} });
  assert(validation.ok && validation.data?.apta === true, `${caso}: validación de negocio`);
  const evidence = await call(root, sessionId, "oc_generar_evidencia", { caso });
  assert(evidence.ok, `${caso}: generación de evidencia`);
  const payload = await call(root, sessionId, "oc_construir_payload", { caso, paquete: pkg.data ?? {}, derivados: validation.data?.derivados ?? {}, retroactiva: validation.data?.retroactiva === true });
  assert(payload.ok && typeof payload.data?.payload === "object", `${caso}: construcción del payload canónico`);
  return payload.data?.payload as Record<string, unknown>;
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "periferia-oc-security-"));
  try {
    await cp(path.join(projectRoot, "fixtures"), path.join(tempRoot, "fixtures"), { recursive: true });
    const sessionId = "security-smoke-session";

    const exceptionPayload = await prepareCase(tempRoot, sessionId, "sol-004");
    const unauthorized = await call(tempRoot, sessionId, "oc_crear", { caso: "sol-004", payload: exceptionPayload, confirmado: true });
    assert(!unauthorized.ok && (unauthorized.error ?? "").toLowerCase().includes("confirmación humana"), "excepción RC5 no permite crear sin autorización vinculada");

    const tampered = structuredClone(exceptionPayload);
    const line = (tampered.posiciones as Array<Record<string, unknown>>)[0];
    line.descripcion = "Descripción manipulada por el modelo";
    const payloadHash = sha256(stableStringify(exceptionPayload));
    const authorization: NonNullable<ToolContext["authorization"]> = { sessionId, payloadHash, confirmedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000 };
    const tamperedResult = await call(tempRoot, sessionId, "oc_crear", { caso: "sol-004", payload: tampered, confirmado: true }, authorization);
    assert(!tamperedResult.ok && (tamperedResult.error ?? "").includes("payload"), "payload manipulado es rechazado por comparación canónica");

    const created = await call(tempRoot, sessionId, "oc_crear", { caso: "sol-004", payload: exceptionPayload, confirmado: true }, authorization);
    assert(created.ok && created.data?.numero_oc === "4500000001", "autorización válida permite la creación en SAP simulado");

    const query = await call(tempRoot, sessionId, "oc_consultar_orden", { caso: "sol-004" });
    assert(query.ok && query.data?.existe === true, "consulta de orden es de solo lectura y encuentra el registro");

    const plainPayload = await prepareCase(tempRoot, sessionId, "sol-001");
    const concurrent = await Promise.all([
      call(tempRoot, sessionId, "oc_crear", { caso: "sol-001", payload: plainPayload, confirmado: false }),
      call(tempRoot, sessionId, "oc_crear", { caso: "sol-001", payload: plainPayload, confirmado: false })
    ]);
    assert(concurrent.every(x => x.ok), "dos solicitudes concurrentes finalizan correctamente");
    const orderLines = (await readFile(path.join(tempRoot, "out", "sap", "ordenes.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x) as { solicitud_id: string });
    assert(orderLines.filter(x => x.solicitud_id === "SOL-2026-001").length === 1, "bloqueo de archivo impide duplicados concurrentes");
    console.log("\nPruebas de seguridad finalizadas correctamente.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Error inesperado"); process.exitCode = 1; });
