---
'@objectstack/spec': minor
---

fix(spec)!: a flattened `view` overlay is judged by the member its `viewKind` names, so a column-less list patch has its list keys judged instead of stripped by the form member (#20186)

**BREAKING** accept-set change on the `view` write door (`PUT /api/v1/meta/view/:name`, the Studio and MCP save), and on every door that parses `ViewMetadataSchema` (the assembled-manifest `viewItems:` union included). It narrows, and it widens two small classes, both declared below. It ships as `minor` under the repo's launch-window convention for breaking changes.

Clause-②: yes (narrowing)

## What was wrong

The two flattened overlay members of `ViewMetadataSchema` shared one `viewKind: 'list' | 'form'` enum. The list member required `columns`, so it refused a column-less `viewKind: 'list'` body. The union then tried the form member, which requires no list key and `.strip()`s every one, and ACCEPTED the body. `diagnoseViewMetadata` named `formOverlay`, the parse output was `type: 'simple'` (a form), and the body's `sort`, `searchableFields` and `timeline` were never judged. Measured through the real `saveMetaItem` on `origin/main` @ `4df101c3`, and again at `ce70876e`: a retired bare-string `sort`, a `timeline.metaFields` and a non-array `searchableFields` each answered `success: true`, and the row held them as sent. The mirror held too: the list member accepted a `viewKind: 'form'` body carrying list `columns`.

That column-less list body is not a malformed one. It is what the console stores on every toolbar save (sort, hidden fields, inline edit, column widths) for a code-defined list view: objectui's `persistViewPatch` stores the patch and nothing else, per the maintainer ruling 「`persistViewPatch` 只存 patch,不存 merged base」.

## What it does now

- **One `viewKind` per member.** The list overlay member admits `viewKind: 'list'` only; the form overlay member admits `viewKind: 'form'` only. A flattened body is judged by the member its `viewKind` names, and `diagnoseViewMetadata` names that member.
- **The list member judges a column-less patch.** `columns` is optional on the flattened list overlay member only. The authoring `ListViewSchema` keeps it required: an authored list view is a full config, never a patch. The console's patch-only writes keep saving, stored verbatim, and a lean list patch now parses to a list (`type: 'grid'`), not to `type: 'simple'`.
- **A column-less body that names a `type` is still refused**, now located at `columns`: a body that sets `type` is a full inline config, and a full config lists its columns. The refusal names both ways out.
- **A field list under a form overlay's `columns` is refused** at `columns`: on a form view `columns` is the body-column count.
- The served JSON Schema (`/api/v1/meta/types/view`) is still an `anyOf` of four members. The only movements: each overlay member's `viewKind` enum names one value, the list overlay member no longer lists `columns` as required, and in the output direction it no longer lists `type` as required (the `grid` default is still declared and still applied).

## FROM → TO

Each row is refused now and was accepted before, on a flattened overlay:

| you wrote | write instead |
|:--|:--|
| `viewKind: 'list'`, no `columns`, `sort: 'name desc'` | `sort: [{ field: 'name', order: 'desc' }]` — the bare string clause was retired in 17.5.0 |
| `viewKind: 'list'`, no `columns`, `sort: [{ field, direction: 'desc' }]` | `sort: [{ field, order: 'desc' }]` |
| `viewKind: 'list'`, no `columns`, `timeline: { …, metaFields: [...] }` | delete `metaFields`: the timeline block has no such key |
| `viewKind: 'list'`, no `columns`, `searchableFields: 'name'` | `searchableFields: ['name']` |
| `viewKind: 'list'`, no `columns`, `sharing: { enabled: true, publicLink, … }` (the form public-link block) | the list `sharing` block, `sharing: { type: 'personal' \| 'collaborative', lockedBy? }`, or delete `sharing` |
| any other list key the list view schema refuses, on a column-less list overlay | the value the list view schema accepts — the refusal names the key |
| `viewKind: 'form'` with `columns: ['name', …]` | a field list means a list view: `viewKind: 'list'`; for a form, `sections: [{ fields: ['name', …] }]` and `columns` as a count (`columns: 2`) |

**The one-line fix:** read the refusal. It is located at the key it refuses and says what that key takes.

A column-less list overlay that names a `type` (`{ viewKind: 'list', type: 'kanban', … }` without `columns`) was refused before and is refused now; only its location moved, to `columns`. Add `columns`, or drop `type` to save the body as a patch.

## Declared widening (why `Clause-②: yes`)

Two classes of column-less, type-less `viewKind: 'list'` bodies go from refused to accepted:

- **W2** — a list-legal value under a key both members declare with different schemas: `aria` (the form member carries a retirement tombstone there), an i18n `description` (the form member takes a plain string only), and the list `sharing` block (the form member's is the public-link block). Measured: `{ name, object, viewKind: 'list', aria: { ariaLabel: 'Leads' } }` was refused, and is accepted. This is the change working: a list body is judged by list rules.
- **W1** — an invalid value under one of the 19 form-only keys (`layout`, `sections`, `title`, …). Measured: `{ name, object, viewKind: 'list', isPinned: true, layout: 'diagonal' }` was refused (the form member judged `layout`), and is accepted with `layout` dropped unread. That is the list member's existing handling of a key it does not declare: a list overlay WITH `columns` and `layout: 'diagonal'` was already accepted the same way. It is a named residual, not a contract.

## Census

- **objectstack** @ `4df101c3` (examples, packages): no source writes a flattened `viewKind: 'list'` body without `columns` as a literal; every literal hit is a test fixture, a changelog line or a comment. `examples/**` authors views as containers (15 files with `listViews`) and carries no `viewKind` at all.
- **objectui**, at the `.objectui-sha` pin `f8a9d0fb0` and at `main` `25c7d584e`, and **cloud** `main` `48d7066`: no source literal either. The one real producer is dynamic: objectui's `buildPersistedViewBody` returns `{ ...patch, viewKind }` for an overlay and `updateViewConfig` stamps `object`, `name` and the overlay marker. Those bodies keep saving, now judged by the list member.
- **Production `sys_metadata` rows: NOT MEASURED.** No deployment's store is reachable from the repository. A stored row that fails keeps being read and served exactly as stored. It is refused only on its next save, and the refusal names the key.

<!-- adr-0087: registered view-overlay-judged-by-viewkind-arm -->
