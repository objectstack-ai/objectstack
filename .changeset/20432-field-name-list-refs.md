---
'@objectstack/lint': minor
---

fix(lint)!: `object-field-ref-unknown` judges the field-name lists on a field — `relatedListColumns`, `lookupColumns`, `lookupFilters[].field`, `dependsOn` — and an object's `indexes[].fields`

<!-- adr-0087: not-required (no-migration-prescription) an authoring-time lint rule judges names on five more declaration positions; no key, symbol, enum member or stored value moves, so a stored metadata row is structurally identical before and after and `objectstack migrate meta` has nothing to rewrite -->

**BREAKING** in the accept-set sense — a declaration that passes today can fail tomorrow.
Landing in the launch window as `minor` (the lockstep convention: `major` is refused by
`check-changeset-no-major`, and breaking-ness is carried by this banner plus the ADR-0087
disposition above).

**Clause-②: no (narrowing)** — the rule refuses more than it did; no key is added to any
published payload and no public surface grows. Narrowing is still a semantic-surface change,
which is why it is declared here rather than shipped silently.

Each of these five lists holds bare field names that the schema cannot judge, and until now no
authoring door read them for existence, so a misspelling surfaced only when a user opened the
view or the picker — or never:

- a misspelt `relatedListColumns` entry asked the child object for a column it does not have,
  when the parent's detail page opened;
- a misspelt `lookupColumns` entry rendered an empty picker column;
- a misspelt `lookupFilters[].field` filtered the picker's query by a field the referenced
  object lacks;
- a misspelt `dependsOn` name kept its field gated for good;
- a misspelt `indexes[].fields` column made the SQL driver skip the WHOLE index at sync, with a
  warning, and drift dropped it too — so a `unique` index was silently unenforced while
  everything looked normal.

`os validate`, `os build` and `os lint` now refuse each of them at `error` (exit 1), under the
existing rule id `object-field-ref-unknown`, and so does the runtime publish door on an object
write (`422`), exactly as they already did for `highlightFields` and
`publicSharing.redactFields`. The finding sits at the exact path —
`objects[i].fields.<field>.lookupColumns[j].field`, `objects[i].indexes[j].fields[k]`, and so
on — names the string that was written and the object it was judged against, offers the
nearest name when one is close, and lists that object's fields.

**Which object a name is judged against** — read off each key's runtime reader, not assumed:

| Position | Judged against |
|:---|:---|
| `relatedListColumns[]` | the object that owns the field — the related list shows that (child) object's rows |
| `lookupColumns[]`, both arms | the referenced object — the picker lists its records |
| `lookupFilters[].field` | the referenced object — the picker's query runs on it |
| `dependsOn[]` name, or `{ field }` | the object that owns the field — the form gate reads this record |
| `dependsOn[]` `param` (or the bare name, on a picker) | the referenced object — the picker filters its candidates by that key |
| `indexes[].fields[]` | the object itself, including the columns the platform injects (`created_at`, `organization_id`, …) |

The referenced-object positions are judged on `lookup`, `master_detail` and `user` fields (a
`user` field references `sys_user`), and only when the referenced object is in the stack being
checked. `lookupColumns`, `dependsOn` and index columns are read verbatim by their readers, so a
dotted name there is refused as a name that is not a field. The family's three skips hold
unchanged: an object outside the stack, an object with no readable field map (ADR-0015
`external`), and a registry-injected column resolved per object.

**What an author does.** Nothing is renamed or rewritten for you. Fix the name the finding
points at, or drop the entry. On a lookup whose `dependsOn` field is spelled differently on the
two records, write the entry with its `param` naming the referenced object's field. An existing
object carrying one of these misspellings is refused when it is next republished through the
publish door, and `os validate` reports it on the next run.

Unchanged: the object schema's own parse still admits these names, so a draft save does not
judge them. An index column that resolves to a real but virtual field (a `formula`) passes this
rule; whether the column is materialized stays the SQL driver's question at sync.
