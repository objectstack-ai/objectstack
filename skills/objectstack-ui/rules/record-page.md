# Record Page — the object declares it, the Console lays it out

Read in order — each step is the remedy for the one before it; author `*.page.ts` only at step 3 or 4 (ADR-0085).

**1 · The object's declarations produce the page.** With no page assigned, the
Console synthesizes the record page from the object alone: `nameField` is the
title, `highlightFields` the strip under it, `stageField` the stage path (each
option declares `kind: 'open' | 'won' | 'lost'`; `false` suppresses it),
`fieldGroups` + `Field.group` the detail sections, `relatedLists` the business
order of the related lists, `editMode` (`'modal'` | `'page'`) how Edit opens.
Layout follows the width of the surface the page occupies, never a key (the
object's `detail` block and `relatedLayout` are removed, ADR-0085): two columns
from 760 px (details | 动态 and the related panels), three-column sections from
1120 px, one column below; a tab row under the header (Overview, 动态, one tab
per panel with its count) enlarges a panel at `?related=object.field`.

**2 · Relationship flags shape the related column.** On the CHILD object's
reference field: `relatedList: 'primary'` draws the child as a full-width body
table in the details after the first field section (the default for a
`master_detail` with `inlineEdit`); `true` / absent is a panel in the right
column; `false` leaves the child off the page. `relatedListTitle` /
`relatedListColumns` (child field names) replace the derived title / columns;
`relatedListFilter` (Query-DSL, `{ status: { $ne: 'done' } }`) is AND-composed
with the parent condition, and the panel's count honours it. Rows follow the
child's default list view `sort` (`isDefault`, else the first declared); the
parent's `relatedLists` orders tables and panels alike. "Put the tasks first on
the lead page" is `relatedList: 'primary'` on `task.lead` — no page file.

**3 · A slotted page overrides one slot.** `kind: 'slotted'` replaces only the
slots it names — `header`, `actions`, `alerts`, `highlights`, `details`,
`discussion` — each whole (no deep merge); the synthesizer fills the rest. There
is no `tabs` slot: `slots.tabs`, `slots.related` and `slots.relatedLists` are
refused by name. `isDefault: true` makes it the object's default record page.

**4 · `kind: 'full'` is the escape hatch.** A record page that looks nothing like
the default — a filtered split (Open vs Closed), a chart tab, a bespoke strip — is
`kind: 'full'`: `regions` drawn as authored ([Pages](./pages.md)), reached for only
when steps 1–3 cannot express the page.

**5 · The drawer, unless the object declares `page`.** A clicked row opens the
record in the drawer, which expands to the full page (one page at two widths);
`navigation: { mode: 'page' }` on the object's list view is for an object whose
record should open as the full page (`new_window`, `none` are the other members).
`modal` / `split` / `popover` were removed in @objectstack/spec 18.3.0 (ADR-0087
D2) and are refused with their fix. Field count never decides; a phone always pages.

**6 · The reader's own choices are not metadata.** ⛔ Never author these: the
Display menu's **Open records** (split beside the list — the default — or drawer,
or full page; offered for a drawer-mode object only), the ⊟ right-column switch
(`⌘⇧,`, per object), the related panels' order and hidden set (⠿ drag, ⌥↑ / ⌥↓,
per user × object), the pane's dragged width and ⤢. They live in the console's
preference store, never in the object; on `navigation` only the `size` bucket
(`sm`…`full`) nudges the drawer's starting width (`width` / `drawerWidth` deprecated).

<!-- os:check -->
```typescript
import { Field, ObjectSchema } from '@objectstack/spec/data';

export const Task = ObjectSchema.create({
  name: 'task',
  fields: {
    lead: Field.masterDetail('lead', { relatedList: 'primary', relatedListFilter: { status: { $ne: 'done' } } }),
  },
});
```
