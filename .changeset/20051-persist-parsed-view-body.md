---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

fix(metadata-protocol,spec)!: a saved view stores the parsed value of every key its body carried, and a ViewItem record's top-level `options` bag is refused by name (#20051)

**BREAKING** — two narrowings on the `view` write door (`PUT /api/v1/meta/view/:name`, the Studio and MCP save). They ship as `minor` under the repo's launch-window convention for breaking changes. This is stage (iv), the last stage, of ruling 甲 on #20051. The storage half follows the maintainer's ruling on its Q2, letter B (「同意  批次 #256」).

Clause-②: no (narrowing)

## What changes

**1. What a saved view stores.** `saveMetaItem` used to validate a `view` body and then store the request body as sent, with two normalizations grafted back (filter operator spellings, and form `groups` → `sections`). It now stores the parsed value of every key the body carried, and nothing else:

- **An undeclared key is dropped.** The members' top-level `.strip()` used to drop it from the parse only, so it lived in the store and nowhere in the contract. Every key the console reads back off a stored row is declared (`VIEW_CONSOLE_ROUND_TRIP_KEYS`), so nothing the console relies on is lost. The keys the console writes that are dropped are the ones mapped rather than declared in that record: a sort row's `id` (the builders mint a fresh one), a top-level `id` (read only when a row has no `name`), and `objectName` (every reader falls back to `object`, which both writers stamp).
- **A declared key keeps its normalized value.** Examples: `notEquals` → `not_equals`, `exportOptions: ['csv']` → `{ formats: ['csv'] }`, and a CEL string → its expression object.
- **A moved key is stored under its canonical spelling.** Examples: `groups` → `sections`, and `visibleOn` → `visibleWhen`. The second was never grafted before, so a form stored with `visibleOn` kept the legacy spelling.
- **A schema default the author did not write is NOT stored.** This is ADR-0087's `storable` rule, the one flows already follow: a stored row never pins the day's default. A console toolbar save (sort, density, hidden fields, column widths, inline edit) stores no `type: 'grid'`. A form stores no `sharing.enabled` and no section `collapsible` / `collapsed` / `columns` it did not write. Storing the whole parse output instead would also have minted rows that fail their own re-save: a column-less toolbar patch carrying the `grid` default is refused as "sets `type` but lists no `columns`".

The stored row re-parses to exactly what the save accepted, so a GET → PUT of it is judged the same. Every other metadata type keeps its request body, with the two grafts, as before.

**2. A ViewItem record's top-level `options` bag is refused.** On a record (`{ name, object, viewKind, config }`), the member's top-level strip used to drop `options` from the parse unread while the save stored it. The interface page then rendered it and the object page did not. It is now refused by name with `422 INVALID_METADATA` at `options`, and the message prescribes `config.KIND`. No console write puts the bag on a record. The flattened list overlay's legacy `options` bag is unchanged: it is judged key by key, and objectui pins it.

## FROM → TO

| you wrote | the stored row / the door now |
|:--|:--|
| a view body with a key its member does not declare (`objectName`, a form-only `layout` on a list view, `isPinned` on a form) | the key is not stored: write only declared keys (`object`, not `objectName`) |
| a view body relying on a schema default being written into the row | the row carries only what you wrote; the parse applies the default on every read |
| `sort: [{ id, field, order }]` | stored as `sort: [{ field, order }]` |
| `groups: [...]` / `visibleOn: '…'` on a form | stored as `sections: [...]` / `visibleWhen: { dialect: 'cel', source: '…' }` |
| a ViewItem record with `options: { kanban: {...} }` | `422` at `options`: move it to `config: { kanban: {...} }` (`config.KIND`), or remove it |

**The one-line fix:** write the declared spelling. A stored view you read back is what the contract accepts, and a record's per-kind blocks live under `config`.

## Existing rows

Stored rows are not migrated and not re-read differently. The maintainer's word on this card is 「20051 不考虑现有的数据」. A row keeps its bytes until its next save, and that save stores it as described above. A record carrying a top-level `options` is refused on its next save and served as stored until then.

<!-- adr-0087: registered view-item-options-bag-refused -->
