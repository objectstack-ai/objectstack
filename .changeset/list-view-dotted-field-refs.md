---
"@objectstack/lint": minor
---

fix(lint): refuse a list view's dotted field reference at author time where the runtime door refuses it (#14282)

An accept-set narrowing on `validateListViewFieldRefs`, the #14107 rule — shipped
as `minor`, matching the level that landing and the two family landings before it
(#14105, #14148) were given.

#14107 judges only the HEAD segment of a list-view field reference, so a dotted
path whose head resolves to a real relationship field (`columns: [{ field:
'owner.name' }]`) passed `os validate` and `os build` clean while every query
door a list view reaches refuses it by name. That half was recorded in the rule's
docblock and pinned in tests rather than closed, because its failure mode is the
opposite of the silent-blank class #14107 gates: a loud `400 INVALID_FIELD` on
the first fetch. This is the ruled resolution of that half, as a second finding
class with its own id, `list-view-field-dotted`, so one class can be suppressed
or filtered without silencing the other (the convention
`validate-sortable-fields` and `validate-searchable-fields` already follow).

The class is scoped by the DOOR, not by the position table, because some
list-view positions are read client-side out of the fetched row and walk a dotted
path perfectly well:

- **Projection** — `columns[]`, in both authored spellings. Clients build the
  `$select` projection from them, and both doors refuse a dotted entry
  unconditionally (`assertProjectionHasNoDottedPaths` on the engine boundary,
  `assertProjectionFieldsExist` at the REST ingress).
- **Filter** — the view's `filter`, its `tabs[].filter`, its
  `userFilters.tabs[].filter`, and the two positions declaring which names an end
  user may filter on (`filterableFields`, `userFilters.fields`). Here the rule
  asks the same `classifyDottedFilterHead` the runtime doors ask, so the #8371
  carve-outs the doors serve — structured/JSON heads, array-valued heads, heads
  whose type is unreadable — are NOT refused at author time.

Deliberately excluded, each measured rather than assumed:
`gantt.quickFilters[].field` and `gantt.tooltipFields[]`, which the renderer
resolves IN MEMORY over already-fetched rows through walkers that split on `.`
(the spec describes the former as "Record field / dot-path", and the measurement
agreed); and every renderer binding that reaches no query door, which stays
unjudged rather than acquiring a verdict nobody measured.

Existing behaviour is untouched: a dotted path whose head resolves to nothing
still reports `list-view-field-unknown`, `sort[]` keeps its owner, and the
shipped example corpus was measured at zero findings both before and after.
