---
'@objectstack/spec': minor
---

**BREAKING** — `aria` on an action (`ActionSchema`, top-level `actions[]` and `objects[].actions[]`) is now refused at parse: no action surface ever applied it. Write the accessible name in the action's rendered `label`, and name the region that places the actions with `ariaLabel` / `ariaDescribedBy` / `role` in the placing node's `aria` block (`page.components[].aria` or the list view `aria`).

Clause-②: yes

`ActionSchema` declared a per-action ARIA block, and the liveness ledger graded it `live` on an uncited note — 「PARTIAL — honored by a few objectui renderers, not the core action buttons/menus」 — with no reader behind it. Re-measured at this checkout's own `.objectui-sha` pin `f8a9d0fb05`: none of the surfaces that render an action reads an action's `aria` — not `action:button`, `action:icon`, `action:menu`, `action:group` or `action:bar`, not the grid's row and bulk action menus, not `record:quick_actions`, not the declared-actions bar. The only `schema.aria` readers there are the placing nodes' own blocks (the `record:*` page components, the list view, `element:button`'s props), none of which looks inside an action. So an author — or an AI — who filled in `aria` got no accessible name on the rendered button, and nothing said so.

It is the fourth member of the `aria` family retired for exactly this, after `dashboard.aria`, `dashboard.widgets[].aria` and the chart config's `aria`.

**Removed rather than enforced** (ADR-0049 enforce-or-remove; the triage direction on the card, following the chart config retirement `2bf6ef18d`). The capability is already delivered under another key. Every one of those surfaces derives the accessible name from the action's **required** `label` — the visible button or menu-item text, and the `aria-label` of the icon-only `action:icon` and of the overflow-menu trigger — and the node that places the actions carries the node-level `ariaLabel` / `ariaDescribedBy` / `role`. The reversal condition the triage named (an icon-only action rendered with no accessible name at all) was measured and does not hold on any of them. A per-action block would be a second spelling of both, behind a precedence rule nobody has written.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `aria: { ariaLabel: 'Escalate this case' }` on an action, top-level or under `objects[].actions[]` | the name in the action's `label` — it is what every action renderer announces |
| `aria: { ariaDescribedBy: … }` / `aria: { role: … }` on an action | delete it; to describe or role the toolbar or list the actions sit in, put it in the `aria` block of the node that places them — `page.components[].aria` or the list view `aria` |
| `ariaLabel` / `ariaDescribedBy` / `role` on a page, page component or list view | unchanged — the shared `AriaProps` block stays live there |

**The one-line fix:** delete `aria` from the action; put the accessible name in its `label`.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

## The retirement kit

- **A `retiredKey()` tombstone, not a bare deletion** — even though `ActionSchema` is a `strictObject`. A bare delete would still be loud, but only as a generic unrecognized-key report that cannot carry the prescription; the tombstone types the key `never` for `tsc` and raises the upgrade text at parse. The key therefore stays in the walked shape: its liveness row stays (regraded `live` → `dead` with a `REMOVED` note that records the uncited 「PARTIAL」 claim it replaces) and the authorable-surface baseline marks `ui/Action:aria` `[RETIRED]`.
- **The D2 conversion `action-aria-removed`** (protocol 18, retired from the load path) strips the key from stack `actions[]` and from `objects[].actions[]` as a pure lossless delete — it never had an effect to lose. Its D3 record is the semantic entry `action-aria-retired`: its own family, not a member of the chart config's.
- **`AriaPropsSchema` is untouched** — a key retirement, not a def retirement; it stays live on pages, page components, the list view and the element props.
- **No form input and no locale bundle move.** The key never reached `action.form.ts`. The Studio action inspector's "More fields" section is derived from the served schema, where a tombstone node is dropped from the payload, so the served `aria` column goes with this release.

## Reach, measured

- This repository: **0** authors of `aria` on an action in `examples/**`, `packages/**` fixtures or the published skills (control: 15 `variant:` lines in `examples/**`). Two hand-written docs pages taught the key and are corrected here.
- HotCRM at `origin/main` `2f7b2326`: **0** on an action; its 6 `aria:` blocks are all page-level `page.aria`, which stays live (control: HotCRM authors actions — 7 files under `src/**/actions/` declare `locations:`, 17 times).
- Other out-of-repo authors: NOT MEASURED.

## What an operator with a STORED action sees

A `sys_metadata` `action` or `object` row written before this release can carry the key. Nothing breaks at read: the conversion replays on rehydration and strips it, so the row is served canonical and parses. `os migrate meta --stored --apply` rewrites the rows.

<!-- adr-0087: registered action-aria-removed, action-aria-retired -->
