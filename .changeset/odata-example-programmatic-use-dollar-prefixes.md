---
"@objectstack/spec": patch
---

docs(spec): the OData `@example Programmatic Use` bag is spelled with the `$` prefixes the schema actually declares (#19028)

The file-level docblock of `src/api/odata.zod.ts` carried an `@example Programmatic Use` block that wrote every `ODataQuery` key unprefixed — `select`, `filter`, `orderby`, `top`, `skip`, `expand`, `count` — while every key the schema declares carries a `$`. Measured with `safeParse` on that bag verbatim:

| bag | result |
|:---|:---|
| the documented bag, verbatim | `success: true`, `data: {}` — all seven keys stripped |
| the same bag with `$` prefixes | `success: true`, all seven keys retained |
| a bag holding one fabricated key | `success: true`, `data: {}` |

So the documented bag and a bag of pure nonsense parsed identically: accepted, silently emptied, no error and no warning. An author who copied it got a query that asked for nothing — no projection, no filter, no ordering, no paging — with nothing anywhere to say so.

The correct spelling was already ten lines above it in the same docblock: the `@example OData Query` block spells the URL conventions `$select=`, `$filter=`, `$orderby=`, `$top=`, `$skip=`, `$expand=`, `$count=`. Only the second example contradicted the schema, and only the second example moves here.

**What reaches a consumer.** `@objectstack/spec` ships `src/**/*.zod.ts` in its `files[]`, so this docblock is in the installed tarball as well as on the generated reference page `content/docs/references/api/odata.mdx`, which the same docblock feeds. Both now show the seven prefixed keys.

**What does not move.** Example prose only. `ODataQuerySchema` is untouched — same accept set, same optionality, same unknown-key behaviour: a key it did not declare is still accepted and stripped rather than refused, exactly as before. No export, no type, no runtime path changes, and no test assertion needed editing. Whether that stripping should instead be a refusal is a separate question, deliberately not answered here.
