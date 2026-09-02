---
'@objectstack/objectql': patch
---

Startup `[action-governance]` resolves declarations through the same rungs the router does

The boot inventory built its declaration set from object-embedded `actions[]` plus the
metadata service's `action` rows. `resolveRouteActionDeclaration` resolves through a third
source between those two — the engine registry's standalone `action` items,
`registry.getItem('action', name)`, accepted when the item owns the route. On the in-process
boot (`new AppPlugin(...)` then `kernel.bootstrap()`), where the metadata plane holds no
`action` rows at all, every object-less `defineAction` was therefore reported as a
"registered handler with NO declaration — REFUSED at dispatch (ADR-0110 D3) and there is no
opt-out" in the same boot in which the router resolved it at that rung and dispatched it.
Both remedies the message offered were wrong for that shape: the action was already declared
with `defineAction`, and dropping the registration would have broken a working endpoint under
a green `pnpm validate`.

The registry rung is now injected into the audit by `ObjectQLPlugin` — the one caller holding
the engine, because objectql cannot import the router — and judged by the same ownership test
the router applies. The warning also stops asserting a dispatch outcome it never checked: it
names the three sources it read, says it did not dispatch, and points an author whose action
IS declared at the real bug instead of at deleting the registration. The other finding in the
block, `declared script actions with NO handler`, is unchanged in wording and in population.
