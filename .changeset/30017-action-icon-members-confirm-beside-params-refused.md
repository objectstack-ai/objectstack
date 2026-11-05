---
'@objectstack/spec': minor
---

fix(spec)!: a page `action:icon` (`ActionIconPropsSchema`) and each `action:group` / `action:menu` member refuse `confirmText` beside a non-empty array `params`, as `action:button`, a registered action (`ActionSchema`) and an inline action (`InlineActionSchema`) already do, instead of accepting a pair that opens two dialogs for one decision

The `action:icon` block forwards its row's `confirmText` and an array `params` (as `actionParams`) to the console's action runner, and both containers do the same for each member. The runner awaits the confirm dialog and only then opens the param dialog, so the user saw a confirm that already read as "the action ran" while nothing had been sent, then a second dialog. The other three action doors refused that pair; these two accepted it. They now refuse it with the same predicate and the same message, at the `confirmText` path: `confirmText` on the icon's properties, `actions.N.confirmText` on a container member.

Clause-②: no (narrowing) — `ActionIconPropsSchema` and the `action:group` / `action:menu` member rows refuse `confirmText` beside a non-empty array `params`, which they accepted before. Nothing is widened.

Metadata-protocol: narrowed (a page `action:icon`, and an `action:group` or `action:menu` member, may no longer declare `confirmText` beside a non-empty array `params`)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: the icon row and the container member already declared both keys and keep them, and this adds the pair refusal the other three action doors carry. There is no rewrite that keeps what the author meant without reading it (the confirm sentence may or may not suit the param dialog's description line), so the author decides, and the refusal names the remedy. The in-repo census at the base found no shipped action:icon or container member carrying the pair; the one carrier was this package's own test fixture, repaired here. -->

**BREAKING** accept-set narrowing at `ActionIconPropsSchema` and the `action:group` / `action:menu` member rows (`@objectstack/spec`), served where a page's component `properties` are judged: the component-props gate (`component-props-invalid`, `@objectstack/lint`) at every CLI command (`os validate`, `os compile`, the publish gate) and at the runtime `page` save door. `defineStack` does not parse a component's `properties` bag, so it does not refuse the pair.

- **Before.** `{ type: 'action:menu', properties: { actions: [{ name: 'reject', label: 'Reject', type: 'api', target: '/api/v1/approvals/reject', confirmText: 'Reject this request?', params: [{ name: 'reason', type: 'textarea' }] }] } }` parsed clean, and the console showed a confirm dialog and then the param dialog. The same held for an `action:icon` with both keys.
- **Now.** The same `properties` are refused at `actions.0.confirmText` (at `confirmText` on an `action:icon`) with the action doors' message: the pair shows TWO dialogs for one decision; carry the question in `description` and drop `confirmText`.
- **Unchanged.** `confirmText` with no `params`, beside `params: []`, or beside an object `params` (an icon's static parameter values; a `type: 'api'` member's request payload — neither opens a dialog) parses as before; so does an array `params` with `description`.
- **Who sees it.** An author whose page declares an `action:icon`, or an `action:group` / `action:menu` member, with both keys. A stored page keeps loading and serving; its next save is refused, with the remedy in the finding.

**The remedy.** Move the confirm sentence to the action's `description`, which the param dialog draws under its title, and drop `confirmText`. On an `action:icon` with no `label`, `description` is also the tooltip text.
