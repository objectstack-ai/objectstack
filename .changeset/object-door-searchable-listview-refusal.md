---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

The object publish door now refuses an object whose `searchableFields` entry, or whose built-in list view's `columns` (and every other field-naming position on that list view), names a field the object does not have.

`#15254` closed this one key over: it crossed the reference-integrity suite onto the object write door for the object's own field-name **lists** (`highlightFields`, `publicSharing.redactFields`). The two members that read the *other* field surfaces an object carries — its ADR-0061 search set and its built-in `listViews` — still declared `runtimeTypes: ['flow', 'view']`, so on the only door a Studio, REST `/meta` or MCP author has they never judged the snapshot that arrived. An object could publish clean with `searchableFields: ['gone_field']` or a list-view column resolving to nothing, and both fail the same silent way downstream: the engine filters a stale search entry out without a word (`resolveSearchFields`), so `$search` scans a narrower set than declared — or, once every entry is stale, the auto-default set the author never chose — and a dangling column renders one field short.

- **`validateSearchableFields` and `validateListViewFieldRefs` gain `object`** in their suite-member `runtimeTypes`. No new rule and no new finding class: the rule ids (`searchable-field-unknown`, `searchable-field-unsearchable`, `list-view-field-unknown`, `list-view-field-dotted`) and their severities are unchanged — they now reach the door where the author actually is.
- **The crossing carries the #9313 precondition.** Both members resolve only against `stack.objects`, the one collection every per-write snapshot carries, so neither opens a missing-collection false-positive channel; their `views[]` rungs simply find no `stack.views` on an object snapshot.
- **Measured before crossing**, at the door's own snapshot shape and differential, over every shipped object definition in the monorepo: 116 objects (platform-objects 48, showcase 24, plugins 19, services 12, crm 6, metadata-core 5, todo 1, qa 1), 105 built-in list views on 40 objects, 666 list-view field-naming positions and 5 `searchableFields` entries judged — **0 findings for both members, precision 1.0**, against synthetic probes that are refused.
- **`validateSortableFields`, the third sibling, is deliberately not crossed** — it measured equally clean, but that crossing is its own adjudication.

## Migration

**A publish that used to succeed can now be refused (HTTP 422, `INVALID_METADATA`).** The receipt names the rule id and the offending path, name-keyed on the wire — for example `objects.proj_task.searchableFields[1]` or `objects.proj_task.listViews.all.columns[1]` — plus the string that was written and the fields the object actually has.

To fix a refusal, do one of:

- rewrite the entry to the field's current API name (after a Studio label edit the derived name is the one to use — `field_10` becomes `health_score`); or
- drop the entry from the declaration; or, for `searchable-field-unsearchable`, target a text-like stored column instead of a virtual or non-scannable one.

`os validate` / `os build` / `os lint` already reported these findings at the same severity, so a code-authored stack can be repaired before it reaches a publish. Objects that name a platform-injected system column are unaffected — both members resolve those per object and stay silent where the platform really provisions them.
