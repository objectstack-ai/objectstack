---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
"@objectstack/objectql": minor
---

feat(objectql,metadata-protocol): refuse a dotted filter key whose head is a relation, a formula, or a plain scalar — at both doors (#8371)

<!-- adr-0087: registered engine-dotted-filter-refused -->

**BREAKING** accept-set narrowing on the FILTER axis, landing after the v17.0.0
cut (the lockstep launch-window convention ships it as `minor`; the migration
prescription is registered under protocol major 18, where `objectstack migrate
meta` users will look).

FILTER was the last of the four query axes with no verdict for a dotted name:
SORT refuses it (#4256), PROJECTION refuses it at both doors (#7589), while
`where: { 'project_id.name': 'Apollo' }` cleared the unknown-field check on its
head segment and answered `200` with zero rows. Measured across all three
drivers before ruling (#8371): relation-head, formula-head, system-column-head
and plain-scalar-head dotted filters return zero rows on `driver-memory`,
`driver-sql` and `driver-mongodb` alike — a lookup stores the related record's
scalar id, so there is no working capability for this refusal to remove; every
answer was a silent empty list indistinguishable from an empty table, and the
virtual case answered one unserviceable intent two ways by spelling
(`{is_open: true}` refused since #8296, `{'is_open.x': true}` not).

**What is refused:** a dotted filter key whose head field is a relation
(`lookup`/`master_detail`/`user`/`tree`), a virtual `formula`, or a plain
scalar — `400 INVALID_FIELD`, naming the whole offending key, at both the REST
ingress (`assertFilterFieldsExist`) and the engine's own filter seam
(`assertFilterIsMaterializable`, reached by saved reports, flows and dashboard
widgets whose filters never pass the ingress). Both doors judge the head by the
shared `@objectstack/spec/data` classification (`classifyDottedFilterHead`,
new export), so they cannot drift apart. Precedence mirrors the sort axis:
`unknown` > `dotted` > unmaterializable.

**What stays accepted:** a dotted path into a structured/JSON head
(`{'address.city': 'Beijing'}`) — deliberately unjudged per the ruling, since
it genuinely works on two of three backends; array-valued and file heads, for
the same reason; the nested-relation OBJECT form `{ owner: { region: 'NA' } }`;
and every undotted spelling, byte-identically.

## FROM → TO

```ts
// before — 200, zero rows, indistinguishable from an empty table
await engine.find('task', { where: { 'project_id.name': 'Apollo' } });

// after — 400 INVALID_FIELD naming 'project_id.name', with the remedy:
// denormalise the value onto a stored field of the queried object and
// filter that (or, to test the relation itself, filter the head field):
await engine.find('task', { where: { project_id: apolloId } });
```

There is deliberately no automatic rewrite: the platform cannot invent the
stored column the remedy prescribes, and it must not join or post-filter
instead — the drivers have already applied `limit`/`offset`, so a post-hoc
predicate would filter an arbitrary page.
