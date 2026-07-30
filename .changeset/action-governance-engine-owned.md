---
'@objectstack/objectql': minor
'@objectstack/runtime': patch
---

**[ADR-0110 D5] The action-governance inventory moves to the engine plugin —
AppPlugin never ran it on the platform's own dev path.**

Dogfooding the inventory with a positive control (an injected undeclared
handler) showed the `kernel:ready` hook it hung on never fired under `os dev`:
AppPlugin is registered conditionally (`serve.ts` skips it when the host wraps
itself; the dev fast path loads apps without it), so the checklist that
justifies D3's no-opt-out refusal was never printed where an upgrade most
needs it.

- The addressing vocabulary (`GLOBAL_ACTION_OBJECT_KEY`,
  `actionHandlerObjectKeys`, `isObjectLessActionKey`,
  `resolveActionHandlerKeys`) and the reconciliation move into
  `@objectstack/objectql` — the engine owns the map they describe, and the
  dependency direction (runtime → objectql) permits no other home.
  `@objectstack/runtime` re-exports them unchanged, so dispatch, the MCP
  bridge and existing importers keep reading ONE implementation.
- `ObjectQLPlugin` now runs the inventory in its existing `kernel:ready`
  handler — after `resyncAuthoredActions`, so the audited registry is final —
  and again on `metadata:reloaded`, fingerprint-suppressed so a reload that
  changed nothing action-related logs nothing. A Studio edit that orphans or
  binds a handler updates the report live; the old boot-only snapshot went
  stale on the first edit.
- Verified end-to-end with a programmatic kernel: the injected orphan is
  named, a clean registry is silent. The `os dev` / `os serve` consoles still
  swallow ALL plugin boot logs (pre-existing, tracked separately) — on those
  surfaces the inventory becomes visible once that sink is fixed.
