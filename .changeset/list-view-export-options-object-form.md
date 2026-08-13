---
"@objectstack/spec": major
---

refactor(spec)!: `view.exportOptions` adopts the object form the renderer reads; `'pdf'` leaves the format enum (#8010, ruling 2026-08-12)

`ListViewSchema` (and its `ObjectListViewSchema` copy) typed `exportOptions` as
a bare format array while the only renderer of the property — objectui
`ObjectGrid.tsx` — reads an **object** (`schema.exportOptions?.formats`, plus
`maxRecords`, `includeHeaders`, `fileNamePrefix` and an undeclared `streaming`
opt-out; measured on objectui `origin/main@878140b`, `:1596–:1642`). A project
following the published type wrote `exportOptions: ['xlsx']`, the renderer saw
`.formats === undefined` and fell back to `['csv', 'json']` — so **no
declaration was both type-legal and functional** (reported from a live customer
project). The maintainer ruling adopts option A: the spec's contract is now the
object form, declaring exactly the five renderer-read keys, `streaming`
included so no undeclared-but-read key survives the fix.

The same ruling removes `'pdf'` from the format enum: PDF export was declined
platform-side (#1301 NOT_PLANNED), so the member was declared-but-unrenderable
— ObjectGrid dropped it from the menu with only a runtime `console.warn`. This
is an enum-VALUE narrowing (the `crypto.hash` precedent): the enum's own error
map carries the prescription, keyed on the received value so only the spelling
that used to be legal is told it "was removed", and a union-level dispatch
makes the refusal the top-level parse message in either authored form.

FROM → TO:

| Was | Now |
|:--|:--|
| `exportOptions: ['csv', 'xlsx']` | still accepted (legacy spelling) — lifts to `{ formats: ['csv', 'xlsx'] }` at parse; prefer the object form |
| `exportOptions: ['xlsx', 'pdf']` | refused at parse with the prescription — delete `'pdf'`; the surviving formats are `'csv'`, `'xlsx'`, `'json'` |
| *(unwritable before)* `{ formats?, maxRecords?, includeHeaders?, fileNamePrefix?, streaming? }` | the contract — a strict object; unknown keys are refused with a suggestion |

The retirement kit (for the `'pdf'` half):

- **No `retiredKey()` tombstone** — an enum VALUE has no key to tombstone; the
  format enum's error map + the union error carry the prescription
  (why the member never worked, the surviving formats, the one-line fix).
- **ADR-0087 D2 conversion + D3 chain step** (`view-export-options-pdf-removed`):
  `os migrate meta --from 16` strips `'pdf'` from `list.exportOptions` and named
  `listViews.*.exportOptions` in both spellings, one notice per occurrence,
  keeping an emptied `formats` array. `retiredFromLoadPath` — the enum owns the
  refusal; stored pre-removal rows replay clean via the stored-row chain. The
  conversion deliberately does **not** rewrite the array spelling to the object
  form — the array is back-compat, not retired.
- **Liveness ledger**: the `view.json` `exportOptions` row stays `live`, re-cited
  to the five measured renderer reads and re-dated.

**Behaviour that changes:** a declaration carrying `'pdf'` is now refused at
parse with the reason instead of silently rendering a menu without PDF. The
object form — the only spelling the renderer has ever read — becomes type-legal
for the first time. The objectui side (type comment claiming alignment, the
undeclared `streaming` read, `'pdf'` in its local type) is reconciled in a
follow-up card on that repo.

<!-- adr-0087: registered view-export-options-pdf-removed -->
