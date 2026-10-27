---
'@objectstack/spec': minor
'@object-ui/components': minor
'@object-ui/types': minor
'@object-ui/plugin-detail': minor
---

feat(spec)!: the action blocks spell the destructive variant `danger`, the word `ActionSchema.variant` uses

An action's variant was spelled in two dialects. `ActionSchema.variant`, the declaration the action runner dispatches, takes `primary | secondary | danger | ghost | link`. The four action blocks (`action:button`, `action:icon`, `action:group`, `action:menu`) and the group/menu members took the Button primitive's `default | destructive | outline | secondary | ghost | link` (plus `primary` on the button, the icon and the members) and refused `danger`. So one destructive action was `danger` as a declaration and `destructive` as a block, and each block renderer translated between the two.

The block rows now take `danger` in place of `destructive`: `default | danger | outline | secondary | ghost | link`, plus `primary` where it was accepted before. `danger` draws the destructive button (a red item in a dropdown or `action:menu`) and asks a `confirmText` question through the destructive confirm button. `destructive` is refused at `variant` with the rename. Other components that draw the Button primitive directly (`element:button`, toasts, alerts, badges and the like) keep `destructive`, the primitive's own word, and are not touched.

The four block renderers forward `danger` to the runner as it is and draw it as the primitive's `destructive`. They no longer read `destructive`: stored pages are rewritten by the conversion below, so no renderer keeps a bridge for the old word. `UIActionSchema.variant` (`@object-ui/types`) follows the rows by reference. The record detail views' Delete entry in the `⋯` menu is spelled `danger` too.

Stored rows and older built artifacts: the ADR-0087 D2 conversion `page-action-block-variant-destructive-to-danger` rewrites `variant: 'destructive'` to `'danger'` on the four blocks' `properties.variant` and on each `action:group` / `action:menu` member's `variant`, at every position a page nests a component (regions, slots, nested containers). A stored `page` row is rewritten when it is rehydrated, so it keeps drawing the destructive button and confirming through the destructive confirm button. The conversion is retired from the load path, so a source that still writes `destructive` on a block is refused, not rewritten. The D3 entry `ui-page-action-block-variant-destructive-refused` carries the judgment for `os migrate meta`.

Clause-②: no (narrowing) — the action block rows refuse `destructive`, a value they used to accept. `danger` takes its place on the same rows.

Metadata-protocol: narrowed (`variant: 'destructive'` is refused on the action blocks and their members; write `danger`)

<!-- adr-0087: registered page-action-block-variant-destructive-to-danger, ui-page-action-block-variant-destructive-refused -->

**BREAKING** for an author who wrote `variant: 'destructive'` on an action block.

**`destructive` → `danger`.**

- **Before.** `{ type: 'action:button', properties: { label: 'Purge', actionType: 'script', variant: 'destructive' } }` parsed; `variant: 'danger'` was refused.
- **Now.** `destructive` is refused at `variant` (or at `actions.N.variant` on a group or menu member) with a message naming the rename.
- **Fix.** Write `variant: 'danger'` on the block or member. Nothing else changes: it draws the same destructive button. `os migrate meta --from 17 --write` applies the rename to your sources.
