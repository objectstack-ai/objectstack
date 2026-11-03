---
'@objectstack/spec': minor
---

fix(spec)!: an inline action (`InlineActionSchema`, a page button's `properties.action`) refuses `confirmText` beside a non-empty `params`, as a registered action (`ActionSchema`) already does, instead of accepting a pair that opens two dialogs for one decision

The console runs an inline action through the registered action's runner: it awaits the confirm dialog, and only then opens the param dialog. So an inline action carrying both keys showed the user a confirm that already read as "the action ran" while nothing had been sent, then a second dialog. `ActionSchema` refused that pair; the inline door accepted it, because until the inline pick carried `description` there was nowhere to move the question. It carries `description` now, so the inline door refuses the pair with the same predicate and the same message as the registered door, at the `confirmText` path.

Clause-②: no (narrowing) — `InlineActionSchema` refuses `confirmText` beside a non-empty `params`, which it accepted before. Nothing is widened.

Metadata-protocol: narrowed (an inline action may no longer declare `confirmText` beside a non-empty `params`)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: the inline door already picked both keys and keeps them, and this adds the pair refusal ActionSchema carries. There is no rewrite that keeps what the author meant without reading it (the confirm sentence may or may not suit the param dialog's description line), so the author decides, and the refusal names the remedy. The in-repo census at the base found no shipped inline action carrying the pair. -->

**BREAKING** accept-set narrowing at `InlineActionSchema` (`@objectstack/spec`), served wherever a page component's inline `properties.action` is parsed: `defineStack`, `os validate`, `os compile` and the publish gate.

- **Before.** `{ type: 'api', target: '/x', confirmText: 'Reject this request?', params: [{ name: 'reason', type: 'textarea' }] }` parsed clean, and the console showed a confirm dialog and then the param dialog.
- **Now.** The same body is refused at `confirmText` with the registered door's message: the pair shows TWO dialogs for one decision; carry the question in `description` and drop `confirmText`.
- **Unchanged.** `confirmText` on an inline action with no `params`, or beside `params: []`, parses as before; so does an inline action with `params` and `description`. A view's `bulkActionDefs` keep the pair, which renders one dialog by that schema's own contract.
- **Who sees it.** An author whose page button declares an inline action with both keys.

**The remedy.** Move the confirm sentence to the inline action's `description`, which the param dialog draws under its title, and drop `confirmText`.
