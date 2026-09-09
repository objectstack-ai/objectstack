---
"@objectstack/spec": patch
---

`Dashboard.globalFilters[].field` now describes WHERE the name resolves, instead of only that it is a field name.

The key's `.describe()` read `Field name to filter on` — true, but silent on the one thing authors get wrong. A dashboard global filter's `field` resolves against the object behind each bound widget's dataset (`dataset.object`), never against that dataset's declared `dimensions`; `widgets[].dimensions[]` selects from that second, separate namespace by name. Readers who assumed the two were the same namespace concluded a filter needs a matching dataset dimension, which is not so.

The rewritten description states the resolution target, scopes the claim to the authoring layer, and names the rule that already enforces it — `dashboard-filter-field-unknown`, `severity: 'error'` in `@objectstack/lint`'s widget-binding validator. It is a statement about a rule that already fires, not a suggestion.

The mirrored TSDoc carries the half a one-line description cannot: the separation holds for the **authorable surface** only. It is NOT a claim that an object field can never serve as a dimension — the analytics query API does accept an object's own field as an ad-hoc dimension without the dataset declaring it, and `widget-dimension-unknown` (also `severity: 'error'`) is what holds that line for authored dashboards.

**What moves for consumers.** The string is a published datum, not a comment: it is the `description` of the `field` property in the shipped JSON Schema (`json-schema/ui/GlobalFilter.json`, `json-schema/ui/Dashboard.json`, `json-schema/objectstack.json`) and the runtime `.description` on the Zod schema in `dist`, so anything that renders schema descriptions — editor hovers, generated reference pages, prompt builders — shows the new sentence. No accept set moves: the key stays `z.string()`, nothing that parses today stops parsing, and no validation behaviour changes.

The same wording already stands on the hand-written page (`content/docs/ui/dashboards.mdx` → **Where a Filter's `field` Resolves**); the generated reference page now agrees with it rather than trailing it.
