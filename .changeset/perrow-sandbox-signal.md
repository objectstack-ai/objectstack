---
"@objectstack/runtime": minor
"@objectstack/spec": patch
---

Hook body sandbox context now carries the per-row dispatch signal and the D2 options projection (#11552). A shipped (L2 sandboxed) hook body observes `ctx.dispatch` — a frozen `{ mode: 'record' | 'per-row', index }` copy of the engine's #6966 dispatch marker (`scope` deliberately does not cross: a JSON copy cannot keep its shared-identity contract) — and `ctx.input.options` — a frozen, non-enumerable `{ multi?, where? }` projection of the caller's bag, the two members ADR-0058 Addendum II D2 declares visible to the `before*` phase. This closes the declared≠observable gap that made D3's routes 1 (batch-scoped throw) and 2 (`ctx.api` per row) inexpressible from a body-only hook: a guard written `ctx.dispatch?.mode === 'per-row'` previously evaluated `false` on every production dispatch. `Object.keys(ctx.input)` still enumerates payload fields only, `ctx.input.id` stays absent (read `ctx.previous.id`), and the post-run input write-back cannot carry the grafted keys back to the engine. The spec change is documentation-only: `HookContextSchema`'s `input`/`dispatch` TSDoc now states the body-face visibility.
