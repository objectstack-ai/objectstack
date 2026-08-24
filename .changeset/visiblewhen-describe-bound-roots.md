---
'@objectstack/spec': patch
---

`visibleWhen`'s describe now states the roots it actually binds, split by what is contract and what is renderer behaviour.

`PageComponentSchema.visibleWhen` named three roots (`record`, `current_user`, `page.<var>`) while the shipping renderer binds nine. The describe now separates the two claims instead of widening one into the other:

- **Contract-bound**: `record`, `current_user` — with ADR-0068's aliases `user` and `ctx.user`, one object under three spellings — and `page.<var>`. These are transcribed from a ruling, not from the renderer: ADR-0068 D1 rules a predicate "evaluates identically in a formula, an RLS policy, and a client `visible` gate", and `EvalUser`'s docblock already states the same alias set for "client UI gates". The platform's own `sys_user` alert gate uses `ctx.user`, which the old describe implied was unavailable.
- **Renderer-provided, not guaranteed**: `app`, `features`, `os.user` and `data`. ADR-0068's Non-goals fence its ruling to the user object, so nothing rules these on this surface; they are recorded as measured behaviour rather than promised.
- **`data` is surface-dependent** and is now called out as such: the data-source **adapter** on a component node, the record **row** on a `page:tabs` item-level `visibleWhen`.

The `page:tabs` item `visibleWhen` (`ComponentSchema`) carried the identical three-root sentence plus a "binds the same environment as page-component `visibleWhen`" claim that measurement disproves; it is corrected the same way and now names its two real divergences (row-bound `data`, bare-field spread).

Describe/prose only — no accept/reject change, no shape change, no new keys.
