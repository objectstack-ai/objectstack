---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): `GET /meta/types` stops publishing properties no instance can satisfy (#17502)

The served JSON Schema advertised the `retiredKey()` tombstones alongside the
live keys. `retiredKey()` keeps a removed authorable key declared on purpose —
the removal has to be audible — and `z.toJSONSchema` renders that tombstone as
a property node, `{ "description": "[REMOVED] <prescription>", "not": {} }`.

`not: {}` is the JSON Schema spelling of "no instance validates", so a consumer
that reads the subschema is told the truth. A consumer that reads the KEY SET is
not: Studio builds a repeater's column headers from
`items.properties[k].title ?? k`, so a tombstone inside a row shape became a
column an author was invited to fill and `saveMetaItem` then refused.

`toJsonSchemaSafe` now drops every property whose subschema admits no instance
before it serves or caches the document — structurally, by asking the JSON
Schema question, never by matching the `[REMOVED] ` description prefix, which
would put a second hand-written spelling of "this is a tombstone" in a consumer.
A property that admits nothing and is `required` is kept: dropping it would turn
"this object admits nothing" into "this object admits anything".

Measured over the whole served registry: 77 such nodes across 14 types, of which
5 were reachable as repeater columns — `dashboard.widgets[]`'s `actionUrl`,
`actionType`, `actionIcon`, `responsive` and `aria`.

**Nothing is un-retired, and no prescription is lost.** The removal is a
property of ONE emitter. `tsc` still types the key `never`, the parse still
refuses it with the prescription byte for byte, `packages/spec`'s
`authorable-surface/` ratchet still lists every retired key as `[RETIRED]`, and
the generated reference pages still print the full prescription in the
description column of a `never`-typed row. What this drops is a fourth copy, on
the one surface whose documented job is to describe what an author MAY write.
