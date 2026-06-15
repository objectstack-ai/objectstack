# Audit: FlowSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/automation/flow.zod.ts`. **Consumers**: framework `service-automation` engine + node executors; objectui Studio flow designer (canvas/inspector/palette). Per ADR-0018 `node.type` is an open string validated against the live registry, not the enum.

## 🔴 The `FlowNodeAction` enum is significantly out of sync with reality
- **Lists (but DEAD — no executor)**: `parallel_gateway`, `join_gateway`, `boundary_event` (BPMN-interop, "import/export-only"). `boundary_event` is still editable in the inspector (`flow-node-config.ts:479`) and drives the otherwise-dead node prop `boundaryConfig`.
- **Omits (but LIVE — real executors)**: `loop`, `parallel`, `try_catch`, `map`, `approval` (plugin-contributed). The enum is now misleading documentation.

## 🔴 http vs http_request drift
Engine canonical type is `http` (`HTTP_TYPE`); `http_request` is a registered **deprecated alias** (`engine.ts:486`). The Studio palette/config/type-picker author **`http_request`** and never offer `http` → new Studio flows bake in the deprecated alias.

## 🟠 Execution-config props that are display-only at runtime (incl. security-relevant)
- **`runAs`** — engine **never switches execution identity** on it (`FlowPreview` shows it; execution always runs as-is). Security-relevant: a flow declaring `runAs: system` does not actually elevate/de-elevate.
- **`status` / `active`** — engine gates on its in-memory `flowEnabled` map (`toggleFlow`), **not** on `status`/`active`. `active` is spec-flagged Deprecated and redundant with `status`.
- **`errorHandling.fallbackNodeId`** — DEAD (engine uses per-node fault edges). Node **`outputSchema`** — DEAD (declared, never validated). `flow.template`, `flow.description` — no reader either layer.

## LIVE & well-wired
Top-level: `name`, `label`, `version`, `variables[]{name,isInput,isOutput}`, `nodes[]`, `edges[]{source,target,condition(CEL),label}`, `errorHandling.{strategy,maxRetries,retryDelayMs,backoffMultiplier,...}`. Node common: `id`, `type`, `label`, `config`, `connectorConfig`, `timeoutMs`, `inputSchema` (runtime-validated), `waitEventConfig`. **Executors (LIVE)**: start/end/decision/assignment/get|create|update|delete_record/script/screen/http(+alias)/notify/connector_action/wait/subflow/map/loop/parallel/try_catch/approval.

## 🟠 `notify` invisible in the static designer
Full executor + descriptor (`paradigms:['flow']`) but reaches the palette only via the server-driven `/automation/actions` overlay — absent from the hardcoded fallback palette + `flow-node-config.ts`. Against an older/offline backend it can't be authored and renders only generic JSON config.

## Recommendation
Resync `FlowNodeAction` enum with the live registry (add loop/parallel/try_catch/map/approval; remove or mark import-only the 3 gateways). Make the Studio palette author `http` (canonical). **Enforce `runAs`** (or remove — a non-enforcing identity switch is a security footgun). Collapse `status`/`active`. Prune `fallbackNodeId`/`outputSchema`/`template`. Add `notify` to the static palette.
