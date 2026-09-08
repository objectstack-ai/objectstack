---
"@objectstack/rest": patch
---

`GET /forms/:slug/lookup/:field` answers a search again: the public-form lookup picker no longer refuses every non-empty query with `400 INVALID_FILTER`.

The route composed its filter list out of `ViewFilterRule` objects — the `{ field, operator, value }` dialect `FormFieldPublicPickerSchema.filter` declares in so many words ("Same `{ field, operator, value }` dialect as list-view filters") — and put them straight onto the `findData` filter slot. That slot accepts a `FilterCondition` object or a `FilterArray` (`[field, operator, value]`, a logical node, or a list of those) and refuses anything else. The refusal did not depend on an author declaring `publicPicker.filter`: the route's own `q` predicate is built in the same object shape, so **every** non-empty search was refused and only the degenerate empty-filter call could succeed — on an anonymous surface where a public-form applicant has no way around it.

- **The route lowers; the parser is untouched.** The composed rows are translated to the array grammar the ingress parses, at the one door that speaks both dialects. ⛔ The repair deliberately NOT taken is teaching `findData` a second dialect: that maintains two filter grammars in the data layer permanently and spreads the object shape to every `findData` caller. The declaration already promises the object dialect on the authoring surface, so what changes is the side that failed to honour the promise. A test keeps the control that the object shape fed to the parser directly is still refused, so "the route lowers" cannot be confused with "the parser was loosened".
- **Both branches.** The declared `publicPicker.filter` rows and the route's own `contains` search row are lowered together and ANDed explicitly; no declared filter still means no filter (`[]`), never an empty logical node the ingress would refuse.
- **The operator fold is the spec's own.** Lowering reuses `normalizeFilterOperator` from `@objectstack/spec/ui` — the fold `ViewFilterRuleSchema.operator` itself runs — so a stored row carrying a legacy spelling (`notEquals`, `isNotEmpty`, `gt`) folds exactly as the schema folds it. No second alias table.
- **A rule that cannot be read is forwarded, not dropped.** The request is then refused exactly as before. That direction is deliberate: a picker's static filter is often the only thing keeping an anonymous visitor's search inside the rows a form may expose, and silently skipping a row nobody understood would answer 200 over an unfiltered table.

No authoring surface moves: `FormFieldPublicPickerSchema` already declared this dialect as accepted, and this makes the runtime honour it.
