---
"@objectstack/lint": minor
---

feat(lint): a standalone ViewItem record's nested `config.sort` / `config.searchableFields` reach the runtime publish gate (#10001)

An `active`-state `view` save through `saveMetaItem` (Studio, REST `/meta`
item CRUD, an MCP/AI author) whose body is a standalone ViewItem RECORD —
`ViewMetadataSchema`'s member 1, `{ name, object, viewKind: 'list', config }`,
the shape a Studio-saved view takes and the shape objectui's `updateView`
round-trips on every pin/reorder toggle — is now refused with the existing
422 `invalid_metadata` envelope when its `config.sort` / `config.searchableFields`
declares a field the bound object cannot honor: an unknown name, a virtual
(`formula`) sort target with no stored column to ORDER BY, or a search
narrowing the #4254 ingress gate would refuse on every toolbar search. #9313
closed the same gap for the flattened list overlay, one union member over;
the record's declarations live one level down, inside `config`, and were
judged by neither list-view field rule — so a record write carrying
`config.sort: [{ field: '' }]` published in silence and answered
`400 INVALID_SORT` (#6994/#7095) on the view's first fetch, every load.

Walk-only, by design: #9313 already widened the reference-integrity suite
entry and exactly these two members onto `view` writes, so this change adds
the RECORD rung to both twin walks — recognised by the wire union's own
member discrimination (`viewKind: 'list'` AND a record-shaped `config`; the
flattened-overlay rung keeps its `no nested config` guard, a strict container
carries neither key, and a `form` record has no list-field surface), judged
against `listViewObject(config) ?? record.object` at path
`views[i].config.sort[…]` / `views[i].config.searchableFields[…]`. The
per-member granularity split is unchanged: no further suite member crosses
onto `view`. Measured before shipping: 0 refusals and 0 advisories over 39
record-shaped console round-trip bodies (one per shipped list surface,
`config.sort[].id` decorations and `isPinned`/`sortOrder` riding along, the
shape `saveMetaItem` really stores) across the four shipped stacks — a lower
bound, as every authored corpus is. Draft saves are untouched (D1), stored
rows keep being served (ADR-0087 asymmetry), and
`OS_ALLOW_UNLINTED_METADATA_WRITES=1` still degrades the refusal to a loud log.
