---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

Clause-②: no

fix(metadata-protocol): the global search palette titles a hit by its `nameField` before the deprecated `titleFormat`

- **What changed.** `searchAll` (`GET /api/v1/search`) now resolves a hit's `title` in this order: the primary-title pointer (`nameField`, or the deprecated alias `displayNameField`), then the `titleFormat` template, then the conventional name fields, then first/last name, then the record id. Before, `titleFormat` came first. ADR-0079 D3 and the `titleFormat` schema description both say an explicit `nameField` takes precedence.
- **What it means for a deployment.** An object that declares both keys is now titled by its `nameField` value. For example, an approval request shows `Discount Sign-off · opp_45` instead of `flow:deal_desk · opp_45`. The registry also designates a `nameField` for any object that has a title-eligible field (a text-like field, or a formula returning text). So an object that declares only `titleFormat` is now titled by that designated field too. The template still titles a row when the object has no pointer, or when the pointer's value is empty on that row.
- **Fix for an author who wants the composite title back:** add a `formula` field with `returnType: 'text'` that builds the composite, set `nameField` to it, and drop `titleFormat`. This is the migration ADR-0079 prescribes (`os explain title-format-retired`).
- **`@objectstack/spec`:** the description of `SearchAllHitSchema.title` now states the same order. No schema shape changed.
