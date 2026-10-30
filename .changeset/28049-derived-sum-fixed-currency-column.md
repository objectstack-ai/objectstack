---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a derived `sum` / `difference` over one `fixed` currency code carries that code on its result column

Clause-②: no (the response comes to say what `content/docs/data-modeling/currency.mdx` already declares: "A derived `sum` or `difference` over one `fixed` code carries that code")
Metadata-protocol: none

A dataset derived measure that adds or subtracts measures whose amounts are all fixed to one currency code, such as `{ derived: { op: 'sum', of: ['eur_a', 'eur_b'] } }` over two EUR-fixed amounts, reached `POST /analytics/dataset/query` as a bare number with no `currency`, so a renderer printed euros unlabelled. Its column now carries that code (`EUR`), on the live query and the Studio draft preview alike. The code is the one the dataset compiler's currency guard already resolves for the measure, read from that same resolution, so the column says what compile judged.

Unchanged: a derived measure whose operands resolve to no one `fixed` code (a `fixed` amount with a tenant-currency one, two tenant-currency amounts, explicit codes over `dynamic` fields, record-mode amounts) and every `ratio` or `product` carry no currency unless they declare their own. The refusal of a derived measure `currency` that contradicts its operands' `fixed` code now names the fix as "delete the measure's `currency` (the column takes the operands' code), or restate that code".
