---
'@objectstack/spec': minor
---

fix(spec)!: a page `action:button` (`ActionButtonPropsSchema`) refuses `confirmText` beside a non-empty array `params`, as a registered action (`ActionSchema`) and an inline action (`InlineActionSchema`) already do, instead of accepting a pair that opens two dialogs for one decision

The `action:button` block forwards its row's `confirmText` and an array `params` (as `actionParams`) to the console's action runner, which awaits the confirm dialog and only then opens the param dialog. So a button carrying both keys showed the user a confirm that already read as "the action ran" while nothing had been sent, then a second dialog. The two action doors refused that pair; the button row accepted it. It now refuses the pair with the same predicate and the same message as the other two doors, at the `confirmText` path. The predicate and the refusal move from `action.zod.ts` to a sibling module (`ui/action-confirm-beside-params.ts`) that all three doors read; neither is exported from the package.

Clause-②: no (narrowing) — `ActionButtonPropsSchema` refuses `confirmText` beside a non-empty array `params`, which it accepted before. Nothing is widened.

Metadata-protocol: narrowed (a page `action:button` may no longer declare `confirmText` beside a non-empty array `params`)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: the button row already declared both keys and keeps them, and this adds the pair refusal ActionSchema and InlineActionSchema carry. There is no rewrite that keeps what the author meant without reading it (the confirm sentence may or may not suit the param dialog's description line), so the author decides, and the refusal names the remedy. The in-repo census at the base found no shipped action:button carrying the pair. -->

**BREAKING** accept-set narrowing at `ActionButtonPropsSchema` (`@objectstack/spec`), served where a page's `action:button` `properties` are judged: the component-props gate (`component-props-invalid`, `@objectstack/lint`) at every CLI command (`os validate`, `os compile`, the publish gate) and at the runtime `page` save door. `defineStack` does not parse a component's `properties` bag, so it does not refuse the pair.

- **Before.** `{ type: 'action:button', properties: { label: 'Reject', actionType: 'api', target: '/api/v1/approvals/reject', confirmText: 'Reject this request?', params: [{ name: 'reason', type: 'textarea' }] } }` parsed clean, and the console showed a confirm dialog and then the param dialog.
- **Now.** The same `properties` are refused at `confirmText` with the action doors' message: the pair shows TWO dialogs for one decision; carry the question in `description` and drop `confirmText`.
- **Unchanged.** `confirmText` on an `action:button` with no `params`, beside `params: []`, or beside an object `params` (the static parameter values, which open no dialog) parses as before; so does an array `params` with `description`. `action:icon` and the `action:group` / `action:menu` members are not changed here.
- **Who sees it.** An author whose page declares an `action:button` with both keys. A stored page keeps loading and serving; its next save is refused, with the remedy in the finding.

**The remedy.** Move the confirm sentence to the button's `description`, which the param dialog draws under its title, and drop `confirmText`.
