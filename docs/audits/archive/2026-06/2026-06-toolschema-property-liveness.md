# Audit: ToolSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ai/tool.zod.ts`. **Consumers**: framework `service-ai` (`tool-registry`, `action-tools`, `vercel-adapter`, `plugin.ts`), objectui `ToolPreview`.

## 🔴 `tool` metadata is write-only
The metadata `ToolSchema` is **not** the runtime tool contract — the runtime uses a separate `AIToolDefinition` (`contracts/ai-service.ts:158`). Tools are **built imperatively in code** (built-ins + Action-derived `action_*`), registered into `ToolRegistry`, then **projected one-way** into `tool` metadata (`plugin.ts:813`) so Studio can display them. **No code reads `tool` metadata back** to build an LLM call or execute (zero `metadataService.get/find/list('tool')` in service-ai). **You cannot author a working tool by writing `*.tool.ts` alone** — there's no `implementation`/`handler` field and no executor that loads metadata; tools are agent-resolved by name and executed by a code-registered handler closure (`tool-registry.ts:116`).

## LIVE (the LLM-facing subset)
`name` (selection + function key), `description` (sent to LLM), `parameters` (LLM function schema), `objectName` (action-tool dispatch). Evidence: `vercel-adapter.ts:46-48`, `action-tools.ts:535`.

## DEAD / cosmetic on the definition
- `requiresConfirmation` — populated but **never read off the def**; the real HITL gate re-derives from `action.ai.requiresConfirmation` (`action-tools.ts:239`). Redundant mirror.
- `active`, `builtIn` — **never set** by any registration path; ToolPreview shows defaults only.
- `permissions` — in `tool.form.ts` only; not on `AIToolDefinition`, not persisted, no consumer.
- `outputSchema` — aspirational: docstring claims output validation + chaining, but the only use folds its **keys** into the LLM description string (`action-tools.ts:437`); no output validation anywhere.
- `category` — enum drift: spec closed enum vs `AIToolDefinition.category` free string, "not sent to the model"; listing/preview tag only.

## Bug
ToolPreview's API-Console link targets `/ai/tools/{name}/invoke` but the route is `/ai/tools/:toolName/execute` (`tool-routes.ts:70`) — broken affordance.

## Recommendation
Decide the model: either make `tool` metadata authoritative (add `implementation`/`handler`, load+execute from metadata) **or** stop projecting a schema that implies authorability. Remove `active`/`builtIn`/`permissions`/`requiresConfirmation` from the definition (cosmetic). Wire `outputSchema` or drop it. Fix the ToolPreview route.
