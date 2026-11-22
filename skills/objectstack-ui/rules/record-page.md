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
from 760 px (details | Activity and the related panels), three-column sections
from 1120 px, one column below; a tab row under the header (Overview, Activity,
one tab per panel with its count) enlarges a panel at `?related=object.field`.

**2 · Relationship flags shape the related column.** On the CHILD object's
reference field: `relatedList: 'primary'` draws the child as a full-width body
table in the details after the open field sections (the default for a
`master_detail`); `true` (a `lookup`'s default) is a panel in the right
column; `false` leaves the child off the page. `relatedListTitle` /
`relatedListColumns` (child field names) replace the derived title / columns;
`relatedListFilter` (Query-DSL) is AND-composed
with the parent condition, and the panel's count honours it. Rows follow the
child's default list view `sort` (`isDefault`, else the first declared); the
parent's `relatedLists` orders tables and panels alike. "Put the tasks first on
the lead page" is `relatedLists: ['task']` on `lead` — no page file.

**3 · A slotted page overrides one slot.** `kind: 'slotted'` replaces only the
slots it names — `header`, `actions`, `alerts`, `highlights`, `details`,
`discussion` — each whole; the synthesizer fills the rest. There
is no `tabs` slot: `slots.tabs`, `slots.related` and `slots.relatedLists` are
refused by name. `isDefault: true` makes it the object's default record page.

**4 · `kind: 'full'` is the escape hatch, on the desktop full page.** A record page
that looks nothing like the default — a filtered split (Open vs Closed), a chart tab, a
bespoke strip — is `kind: 'full'`: `regions` drawn as authored ([Pages](./pages.md)).
A phone and the drawer draw the standard page (steps 1–3); no key keeps a full page
there, only a page named in the URL (a print page) draws everywhere. The standard page
draws no `record_section` action: one that must show there also lists `record_more`.

**5 · The drawer, unless the object declares `page`.** A clicked row opens the
record in the drawer (always the standard page), which expands to the full page;
`navigation: { mode: 'page' }` on the object's list view opens it as the full page
(`new_window`, `none` are the other members). `modal` / `split` / `popover` were
removed in @objectstack/spec 18.3.0 (ADR-0087 D2) and are refused with their fix.
Field count never decides; a phone always pages.

**6 · The reader's own choices are not metadata.** ⛔ Never author these: the
Display menu's **Open records** (drawer or full page, for a drawer-mode object), the
⊟ right-column switch (per object), the related panels' order and hidden set (per
user × object), the drawer's dragged width and ⤢. On `navigation` only the `size`
bucket (`sm`…`full`) nudges the drawer's starting width (`width` / `drawerWidth`
deprecated).

<!-- os:check -->
```typescript
import { Field, ObjectSchema } from '@objectstack/spec/data';

export const Task = ObjectSchema.create({
  name: 'task', sharingModel: 'controlled_by_parent',
  fields: {
    lead: Field.masterDetail('lead', { relatedListFilter: { status: { $ne: 'done' } } }), // a body table
  },
});
```
