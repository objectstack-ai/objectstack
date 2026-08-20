---
"@objectstack/lint": minor
---

feat(lint): the two list-view field rules reach a standalone list view at the runtime publish gate — `view` writes are now judged by `validateSearchableFields` and `validateSortableFields` (#9313)

An `active`-state `view` save through `saveMetaItem` (Studio, REST `/meta` item
CRUD, an MCP/AI author) is now refused with the existing 422 `invalid_metadata`
envelope when its list view declares a `sort` or `searchableFields` entry the
bound object cannot honor — an unknown field name, a virtual (`formula`) sort
target with no stored column to ORDER BY, or a search narrowing the #4254
ingress gate would refuse on every toolbar search. Both rules already gated
`os validate` / `os build` / `os lint`; the runtime door — the only door a
Studio tenant or an MCP/AI author has — ran neither, and an author writing the
exact declaration these rules exist to refuse got it accepted.

Two halves, because either alone is a silent no-op: the reference-integrity
suite's registry entry gains `runtimeTypes: ['view']`, and both rules' metadata
walks gain the SELF rung — a `views[]` entry that IS a flattened standalone
list overlay (`ViewMetadataSchema`'s list-overlay member: `viewKind: 'list'`,
no nested `config`), the shape a standalone list view takes on the wire and the
shape the gate snapshots as `views: [item]`.

The suite dispatches per member on this door: a `view` snapshot reaches exactly
the two list-view field rules (`ReferenceIntegrityRule.runtimeTypes`, default
`['flow']`), never the members whose resolution universe the per-write snapshot
does not carry — `validateActionNameRefs` resolving against `stack.actions`
would otherwise refuse legitimate view writes. CLI behaviour is unchanged (the
commands run the full suite as before); `flow` snapshots keep every member.
Measured before crossing: 0 refusals and 0 advisories over 50 shipped
view-door bodies (11 containers + 39 console-shaped personalization overlays,
`sort[].id` decorations included) across four authoring lineages — a lower
bound, as every authored corpus is. Draft saves are untouched (D1), stored rows
keep being served (ADR-0087 asymmetry), and
`OS_ALLOW_UNLINTED_METADATA_WRITES=1` still degrades the refusal to a loud log.
