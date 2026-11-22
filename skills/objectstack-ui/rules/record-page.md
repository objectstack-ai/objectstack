# Record Page — the object declares it, the Console lays it out

Read in order — each step is the remedy for the one before it; author `*.page.ts` only at step 3 or 4 (ADR-0085).

**1 · The object's declarations produce the page.** With no page assigned, the
Console synthesizes the record page from the object alone: `nameField` is the
title, `stageField` the status tag beside it whose menu moves the stage (each
option declares `kind: 'open' | 'won' | 'lost'`; `false` suppresses it); there is
no stage bar or key-field strip (`highlightFields` feeds hover cards, pickers and
related-list columns). `fieldGroups` are the Details sections in array order,
each listing its members in `fields` (absent: the fields whose `group` names it);
`editMode` (`'modal'` | `'page'`) is how Edit opens. Layout follows the surface's
width, never a key: a full page fitting 320 px of details beside 400 px of tabs
pins the details left of the tabs, unless they hold a child table or no other
tab exists; else one column, Details first.

**2 · The parent's `relatedLists` is the tab list.** Without it nothing changes:
every related list is a tab, then `sys_attachment` (with `enable.files`),
`sys_approval_request`, `sys_activity`. Declared, only the named
lists show, in order (unlisted approvals and the stream still follow): "tasks
first" lists every tab to keep, `'task'` first; leaving out `'sys_attachment'`
drops attachments. `{ list, label, columns }` (child field names) titles one list;
a built-in is a bare name. A child list another package adds is hidden by a
`relatedLists` that does not name it (no package places its own list yet). On the
CHILD's reference field `relatedList: false` hides the list and
`relatedListFilter` (Query-DSL) is AND-composed with the parent condition;
rows follow the child's default list view `sort`. Only when asked for a child
table among the fields, a parent group `{ key, label, relatedList: 'quote_line' }`
(no `fields`) places it there; its tab stays unless a declared `relatedLists` omits it.

**3 · A slotted page overrides one slot.** `kind: 'slotted'` replaces only the
slots it names — `header`, `actions`, `alerts`, `highlights`, `details`,
`discussion` — each whole. There
is no `tabs` slot: `slots.tabs`, `slots.related` and `slots.relatedLists` are
refused by name. `isDefault: true` makes it the object's default record page.

**4 · `kind: 'full'` is the escape hatch, on the desktop full page.** A record page
that looks nothing like the default — a chart tab, a bespoke strip — is `kind: 'full'`: `regions` drawn as authored ([Pages](./pages.md)).
A phone and the drawer draw the standard page (steps 1–3); no key keeps a full page
there, only a page named in the URL (a print page) draws everywhere. The standard page
draws no `record_section` action: one that must show there also lists `record_more`.

**5 · On an object's list the name opens the page, its hover icon the drawer.**
`navigation.mode` is deprecated there: `drawer`, `page`, `new_window` change
nothing, so omit it; `none` still means rows open nothing (prefer
`preventNavigation: true`); a page block's `navigation` honours every value;
`modal` / `split` / `popover` are refused with their fix. A phone always pages.

**6 · The reader's own choices are not metadata.** ⛔ Never author these: the
tabs' order and hidden set (per user × object), the details column's and the
drawer's dragged widths. On `navigation` only the `size`
bucket (`sm`…`full`) nudges the drawer's starting width.

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';

export const Quote = ObjectSchema.create({
  name: 'quote', sharingModel: 'private',
  fields: { name: { type: 'text' }, amount: { type: 'currency' } },
  fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['amount', 'name'] }],
  relatedLists: [{ list: 'quote_line', label: 'Lines', columns: ['product'] }, 'sys_activity'],
});
```
