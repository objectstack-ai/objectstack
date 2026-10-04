---
'@objectstack/spec': minor
---

feat(spec)!: an `object-master-detail-form` detail entry's `sortField` is retired — the console derives the line-position field from the child object and reads no authored value (#21589)

Clause-②: no (narrowing)

<!-- adr-0087: registered object-master-detail-form-detail-sort-field-removed, object-master-detail-form-detail-sort-field-retired -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

`ComponentPropsMap['object-master-detail-form'].details[].sortField` named the child field the line grid stamps with each line's position on drag-reorder. The console stopped reading it: the field it stamps is derived from the child object, and the pinned console crossed that change while the spec still declared the key. So an authored `sortField` went through `os validate` clean and was dropped, and a drag-reorder stamped the derived field, or none (ADR-0049 enforce-or-remove).

### FROM → TO

| before | what to write instead |
| --- | --- |
| `details: [{ childObject: 'crm_invoice_line', sortField: 'line_no' }]` | delete `sortField`. The grid stamps the child object's first field named `position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`. |
| `sortField` naming a field outside that list | give the child object one of those fields; the line order is kept there. |
| an entry that names `relationshipField` and at least one column and gives every column a `type` | unchanged: the renderer keeps that entry exactly as authored, loads no child schema for it, and stamps no line position, before and after the upgrade alike. |

**The one-line fix: delete `sortField` from every `object-master-detail-form` detail entry.** `os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

**What an author now sees.** Writing the key fails `tsc` (its input type is the retired-key mark), and `os validate`, `os build` and `os lint` report it as a `component-props-invalid` warning carrying the prescription at `properties.details.N.sortField`. A page that carries it still saves and loads: a page component's `properties` is not parsed on the metadata save or load path.

### The retirement kit

- **Tombstone.** `sortField` is a `retiredKey()` on the strict detail entry. Its prescription prints the derived field names from their one declaration, a module reached by relative import only (`data/inline-grid-sort-fields.ts`), which the derived inline-grid columns read too.
- **D2 conversion `object-master-detail-form-detail-sort-field-removed`** (step 18, retired from the load path): a lossless delete of `sortField` from every `properties.details[]` entry of an `object-master-detail-form`, scoped by component type and by position. Stored `sys_metadata` pages and built artifacts replay it, one notice per entry.
- **D3 entry `object-master-detail-form-detail-sort-field-retired`** carries the judgment the delete cannot make: whether the child object declares the field the line order is kept in.
- **`RETIRED_KEYS_BY_MAJOR[18]`** registers the nested key `ui/ObjectMasterDetailFormProps:details.sortField`.
- **`record:line_items`' answer to `sortField`** no longer sends the author to the detail entry: no block takes an authored `sortField` any more.
- **No deprecation window**: the writer census is zero.

**Measured producers: none.** On origin/main 9a4182a752, no `object-master-detail-form` detail entry in `examples/`, `apps/`, `packages/`, `skills/` or `content/docs/` writes `sortField`, against the sibling detail-entry key `addLabel` on the showcase project workspace's entry as the control, through the same instrument. At the objectui pin `89cad75d5570` the only detail entries that write it are probes asserting that nothing reads it. Deployed metadata NOT MEASURED.
