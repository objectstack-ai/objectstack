---
'@objectstack/metadata-protocol': patch
---

Fix `GET /meta/types` serving an empty JSON Schema for `action`

`ActionSchema` is a `ZodPipe`, and the `output` derivation of a pipe carries no
properties, so `/meta/types` advertised `action` as
`{"$schema": "https://json-schema.org/draft/2020-12/schema"}` — a document that
reads as "this type declares no constraints" for a type that accepts 47 keys.
The hand-crafted fallback declared for this case never fired, because the
conversion did not throw: it succeeded and returned a truthy husk, which
short-circuits the `??` that was supposed to reach the fallback.

A derivation that comes back with no properties, no union arms, no `$ref` and no
`additionalProperties` object is now treated as a non-answer. It is retried in
the authoring shape (`io: 'input'`), and if that degenerates too the type is
named in a one-shot warning and the hand-crafted fallback decides.

Only `action` changes. The `output` derivation remains the served default on
purpose: deriving every type with `io: 'input'` was measured across the whole
served surface and would move 24 of the 26 types that carry a Zod schema, in the
direction of a weaker contract (`required` entries 1132 to 867,
`additionalProperties: false` 663 to 637). Gating the retry on degeneracy keeps
the change to the one type that was actually broken.

Consumers reading `schema` for `action` from `/meta/types` or `/api/v1/meta` now
receive its real 47 properties instead of an empty object. No other type's
served payload moves, and a type that resolves no Zod schema at all continues to
be served with no schema — absence is not the same failure as a derivation that
came back empty.
