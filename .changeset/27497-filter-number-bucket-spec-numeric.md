---
'@object-ui/types': minor
---

feat(ui-types): the filter-builder number bucket follows the spec's numeric value family, so `progress`, `slider` and `summary` fields get the number operators

Clause-②: yes (widening)
Metadata-protocol: added

`FILTER_NUMBER_LIKE_TYPES` is now taken from `NUMERIC_VALUE_TYPES` in `@objectstack/spec/data` instead of a hand-kept list of four. That set is the one the server's filter doors use to read a field as numeric, so a numeric field in the filter builder is offered the operators the server accepts for it. Before this change, a `progress` field fell through to the text operators (Contains, Starts with…), which the server refuses with a 400, and it was offered no Greater than or Less than.

- **Accepted set widens by three members.** `FilterFieldSchema.type` (the `@object-ui/types/zod` entry), `FilterFieldType` and `FILTER_FIELD_TYPES` now also accept `progress`, `slider` and `summary`. Nothing that was accepted before is refused.
- **Renderer.** `filter-builder` in `@object-ui/components` reads the bucket from here, so these three types get the number operators and a number input with no change to the component.
- **Later spec additions follow.** A type the spec adds to `NUMERIC_VALUE_TYPES` joins the bucket and the validator on its own. The type face names the family as a literal union, and a mirror pin keeps that union equal to the spec set.
