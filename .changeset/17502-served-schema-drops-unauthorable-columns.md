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

Measured over the whole served registry: 77 such nodes across 15 types.

**Nothing is un-retired, and no prescription CHANNEL is destroyed.** The removal is a
property of ONE emitter. `tsc` still types the key `never`, the parse still
refuses it with the prescription byte for byte, `packages/spec`'s
`authorable-surface/` ratchet still lists every retired key as `[RETIRED]`, and
the generated reference pages still print the full prescription in the
description column of a `never`-typed row. What this drops is a fourth copy, on
the one surface whose documented job is to describe what an author MAY write.

**What an author stops being offered, stated as a class.** A tombstone became
visible wherever a renderer derives its field or column list from the served KEY
SET and reads the subschema for nothing but a label — so the retired key arrived
as an editable input, or as a repeater column, that the publish door then
refused. Three mechanisms put one in front of an author, and one retired key can
reach it through more than one of them:

- **the flat, schema-driven fallback**, for a served type that carries no
  `*.form.ts` layout: its field list *is* the served `properties` map, and a
  nested object renders recursively, so a tombstone at any depth becomes a field
  with the `[REMOVED] ` prescription as its help text;
- **repeater rows**, whose column headers are `items.properties[k].title ?? k` —
  the carrier this card was filed on;
- **server-field grafting**, where an inspector merges the server's top-level
  properties into a trailing "More fields" section: a key the UI's own bundled
  spec predates is offered *because* the served document is the only place it is
  known from.

No count of the affected sites is given, on purpose. Which nodes reach an author
depends on the renderer and on the Console build this repo pins, so any number
written here would be false at the next pin bump. The invariant is the class: the
served document stops offering what the publish door refuses, and every retired
key keeps the full prescription on its generated reference page. A repeater
column loses no text either way — the row-cell renderer has no `description`
branch — so there the removal only withdraws the offer.
