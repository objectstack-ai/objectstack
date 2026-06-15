# Audit: ActionSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ui/action.zod.ts`. **Consumers**: objectui action renderers (`components/.../action/*`, `RowActionMenu`, `record-quick-actions`), runtime dispatcher (`useConsoleActionRuntime`, `ActionRunner`), server (`runtime/http-dispatcher`→`engine.executeAction`→`body-runner`), AI bridge (`service-ai/tools/action-tools.ts`).

## 🔴 `disabled` → `enabled` naming drift (CEL form silently ignored)
Spec's canonical field is `disabled` (bool | CEL), but the primary renderers (`action-button.tsx:56,116`, action-menu, action-group) read a **non-spec `schema.enabled`** and invert it. Only detail/quick-action toolbars read spec `disabled`, and only its **boolean** form. **The CEL-predicate form of `disabled` has zero consumers** — authoring `disabled: "<expr>"` is silently ignored.

## 🔴 Aspirational / half-built
- **`type:'form'`** — in the enum, marks `target` required, documents a `/console/forms/:name` route, but **no renderer or runtime consumes it** (AI bridge classifies it unsupported). Dead action type.
- **`shortcut`** — `ActionEngine` registers it + exposes `handleShortcut`, but **no keydown listener** pumps events → never fires.
- **`bulkEnabled`** — engine has `getBulkActions`/`executeBulk`, but no spec-driven view path calls `executeBulk`.
- **`timeout`** (action-level) — DEAD; server uses `body.timeoutMs`, no UI consumer.
- **`mode`** — consumed only by the AI HITL heuristic, never by UI. **`aria`** — honored by a few renderers but not the core action buttons/menus.

## LIVE & well-wired
`name`, `label`, `objectName`, `icon`, `type`, `target` (+`${param}`/`${ctx}` interpolation), `body` (server script only), `params` (+ field/objectOverride/defaultFromRow/options/placeholder/helpText/defaultValue/required/name), `variant`, `component`, `locations`, `confirmText`, `successMessage`, `refreshAfter`, `resultDialog` (one-shot reveal), `visible` (CEL, fail-closed), `recordIdParam`/`recordIdField`, `bodyShape{wrap}`, `bodyExtra`, `method`, `opensInNewTab`/`newTabUrl`, the full `ai.*` bridge. **Action types**: api/script/flow fully wired; url thinner; **modal PARTIAL** (console maps modal→serverActionHandler, not a real modal opener); form DEAD.

## 🟠 Two parallel prop-readers with different coverage
The **AI bridge** (`action-tools.ts`) reads almost every advanced prop; the **visual button** (`action-button.tsx`) forwards only a fixed subset and relies on the grid path (`ObjectGrid.tsx:1333 ...rest`) to carry the full def into handlers. Divergent coverage = maintenance risk.

## Recommendation
Fix `disabled`↔`enabled` and wire the CEL form (correctness + matches `visible`). Decide `type:'form'`/`shortcut`/`bulkEnabled`/`timeout`/`mode`/`aria` — wire or remove. Make the modal action a real modal opener or drop it. Unify the two prop-readers.
