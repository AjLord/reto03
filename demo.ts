import { executeTool, type ToolContext } from "./src/tools/oc";
import { rm } from "node:fs/promises";
import path from "node:path";
import { sha256, stableStringify } from "./src/utils";

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ValidationData = { apta: boolean; retroactiva: boolean; bloqueos: unknown[]; confirmaciones: unknown[]; derivados: Record<string, unknown> };
type PayloadData = { payload: Record<string, unknown> };
const root = process.cwd();
const ctx: ToolContext = { directory: root, sessionId: "demo" };

async function call(name: string, args: Record<string, unknown>, authorization?: ToolContext["authorization"]): Promise<ToolResult> {
  const raw = await executeTool(name, args, { ...ctx, authorization });
  return JSON.parse(raw) as ToolResult;
}

async function processCase(caso: string, confirm: boolean): Promise<void> {
  console.log(`\n===== ${caso} =====`);
  const packageResult = await call("oc_leer_paquete", { caso });
  if (!packageResult.ok) throw new Error(packageResult.error);

  const validationResult = await call("oc_validar", { caso, paquete: packageResult.data as Record<string, unknown> });
  if (!validationResult.ok) throw new Error(validationResult.error);
  const validation = validationResult.data as ValidationData;
  console.log("Apta:", validation.apta, "| Retroactiva:", validation.retroactiva);
  console.log("Bloqueos:", validation.bloqueos);
  console.log("Confirmaciones:", validation.confirmaciones);
  if (!validation.apta) { console.log("RESULTADO: BLOQUEADO"); return; }

  const evidence = await call("oc_generar_evidencia", { caso });
  if (!evidence.ok) throw new Error(evidence.error);
  const payloadResult = await call("oc_construir_payload", {
    caso,
    paquete: packageResult.data as Record<string, unknown>,
    derivados: validation.derivados,
    retroactiva: validation.retroactiva
  });
  if (!payloadResult.ok) throw new Error(payloadResult.error);
  const payload = (payloadResult.data as PayloadData).payload;

  if (validation.confirmaciones.length > 0 && !confirm) {
    console.log("RESULTADO: PENDIENTE DE CONFIRMACIÓN. No se crea la OC.");
    return;
  }
  const authorization = validation.confirmaciones.length > 0 && confirm ? { sessionId: ctx.sessionId, payloadHash: sha256(stableStringify(payload)), confirmedAt: new Date().toISOString(), expiresAt: Date.now() + 10 * 60 * 1000 } : undefined;
  const created = await call("oc_crear", { caso, payload, confirmado: confirm }, authorization);
  console.log("RESULTADO:", created.ok ? "CREADO" : "ERROR", created.data ?? created.error);
}

async function main(): Promise<void> {
  await rm(path.join(root, "out"), { recursive: true, force: true });
  await processCase("sol-001", false);
  await processCase("sol-002", false);
  await processCase("sol-003", false);
  await processCase("sol-004", false);
  console.log("\n--- Confirmación explícita de sol-004 ---");
  await processCase("sol-004", true);
  await processCase("sol-005", false);
  console.log("\n--- Confirmación explícita de sol-005 ---");
  await processCase("sol-005", true);
  await processCase("sol-006", false);
  console.log("\n--- Confirmación explícita de sol-006 ---");
  await processCase("sol-006", true);
  console.log("\n--- Prueba de idempotencia sol-001 ---");
  await processCase("sol-001", false);
  await call("oc_consultar_orden", { caso: "sol-001" }).then(r => console.log("Consulta de orden:", r.data ?? r.error));
  console.log("\nEvidencias generadas en ./out");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Error inesperado en demo");
  process.exitCode = 1;
});
