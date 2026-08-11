---
"@objectstack/spec": minor
---

feat(spec): declare `publicPicker` on `FormFieldSchema` — the REST public-lookup opt-in becomes authorable (#7467)

`GET /forms/:slug/lookup/:field` has always gated the anonymous public-form
picker on an opt-in `publicPicker` block on the field's form declaration —
without one it answers `403 LOOKUP_NOT_PUBLIC`, loud by design (#3022). But
the key was declared in **no** schema: `FormFieldSchema` is strict (ADR-0089
D3a), so `ViewMetadataSchema` refused any form carrying a picker with
`unrecognized_keys`, `saveMetaItem` turned that into a 422, and code-authored
forms hit the same wall at `FormViewSchema.parse`. The route, its projection,
its result cap, its pre-filter and its object override were live code that no
spec-valid form could turn on — ADR-0049's "declared ≠ enforced" in the mirror
direction: **enforced, never declarable**.

Per the maintainer's ruling on #7467 (declare, option 1 of the card's fork —
the retirement direction is closed), `FormFieldSchema` now carries an optional
`publicPicker` block, `FormFieldPublicPickerSchema`, mirroring **exactly** the
four reads the route performs and nothing wider — this block opens an
unauthenticated search surface, so the schema deliberately admits no option
the route does not enforce, and the route's hard bounds are encoded rather
than left to silent request-time adjustment:

- `displayFields` — the projection (and `contains`-search target, first
  entry); at most 5, because the route never projects more; omitted → `['name']`.
- `maxResults` — integer 1–50, encoding the route's hard ceiling of 50
  (default 20); `51`, `0`, negatives and fractions are authoring-time parse
  errors instead of silently clamped values.
- `filter` — `ViewFilterRuleSchema[]`, the same rule dialect the route
  composes with its own search predicate (shape coupling per #6227 included).
- `object` — the referenced-object override the route prefers before falling
  back to the field definition.

An unknown subkey is still a loud `unrecognized_keys` error (ADR-0089 D3a),
and `publicPicker.sort` — a fifth read the route performs that the ruling's
enumeration does not include — stays deliberately undeclared and pinned as
such (follow-up filed from #7467).

**minor**, not patch: this adds a new authorable property to the public
acceptance surface — metadata that yesterday was a 422 parses today
(precedent: #7387 per #3405/#5583). Nothing previously accepted changes shape
or is refused; the REST route is untouched.
