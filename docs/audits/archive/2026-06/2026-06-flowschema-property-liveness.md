# Audit: FlowSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/automation/flow.zod.ts`. **Consumers**: framework `service-automation` engine + node executors; objectui Studio flow designer (canvas/inspector/palette). Per ADR-0018 `node.type` is an open string validated against the live registry, not the enum.

## 🔴 The `FlowNodeAction` enum is significantly out of sync with reality
- **Lists (but DEAD — no executor)**: `parallel_gateway`, `join_gateway`, `boundary_event` (BPMN-interop, "import/export-only"). `boundary_event` is still editable in the inspector (`flow-node-config.ts:479`) and drives the otherwise-dead node prop `boundaryConfig`.
- **Omits (but LIVE — real executors)**: `loop`, `parallel`, `try_catch`, `map`, `approval` (plugin-contributed). The enum is now misleading documentation.

## 🔴 http vs http_request drift
Engine canonical type is `http` (`HTTP_TYPE`); `http_request` is a registered **deprecated alias** (`engine.ts:486`). The Studio palette/config/type-picker author **`http_request`** and never offer `http` → new Studio flows bake in the deprecated alias.

## 🟠 Execution-config props that are display-only at runtime (incl. security-relevant)
- **`runAs`** — ✅ **ENFORCED 2026-06-24** (#1888, ADR-0049; was the dead security item). The engine establishes the run's data-layer identity at setup and restores the caller's context afterward: `runAs:'system'` runs elevated (a full-access, RLS-bypassing system principal); `runAs:'user'` (default) runs as the triggering user, so CRUD nodes' ObjectQL reads/writes respect that user's RLS (roles/tenant forwarded from the trigger). The `[EXPERIMENTAL — not enforced]` marker is removed from the schema. Proven both directions by the dogfood gate (`flow-runas.dogfood.test.ts`, restricted-member read+write) and service-automation unit + regression tests (`crud-runas.test.ts`).
- **`status` / `active`** — engine gates on its in-memory `flowEnabled` map (`toggleFlow`), **not** on `status`/`active`. `active` is spec-flagged Deprecated and redundant with `status`.
- **`errorHandling.fallbackNodeId`** — DEAD (engine uses per-node fault edges). Node **`outputSchema`** — DEAD (declared, never validated). `flow.template`, `flow.description` — no reader either layer.

## LIVE & well-wired
Top-level: `name`, `label`, `version`, `runAs` (identity switch — #1888), `variables[]{name,isInput,isOutput}`, `nodes[]`, `edges[]{source,target,condition(CEL),label}`, `errorHandling.{strategy,maxRetries,retryDelayMs,backoffMultiplier,...}`. Node common: `id`, `type`, `label`, `config`, `connectorConfig`, `timeoutMs`, `inputSchema` (runtime-validated), `waitEventConfig`. **Executors (LIVE)**: start/end/decision/assignment/get|create|update|delete_record/script/screen/http(+alias)/notify/connector_action/wait/subflow/map/loop/parallel/try_catch/approval.

## 🟠 `notify` invisible in the static designer
Full executor + descriptor (`paradigms:['flow']`) but reaches the palette only via the server-driven `/automation/actions` overlay — absent from the hardcoded fallback palette + `flow-node-config.ts`. Against an older/offline backend it can't be authored and renders only generic JSON config.

## Recommendation
Resync `FlowNodeAction` enum with the live registry (add loop/parallel/try_catch/map/approval; remove or mark import-only the 3 gateways). Make the Studio palette author `http` (canonical). ~~Enforce `runAs`~~ → **DONE** (#1888 — elevate/de-elevate now honored at the data layer). Collapse `status`/`active`. Prune `fallbackNodeId`/`outputSchema`/`template`. Add `notify` to the static palette.
