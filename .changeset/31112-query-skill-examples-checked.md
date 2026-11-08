---
'@objectstack/skills': patch
---

docs(skills): objectstack-query's self-contained examples are now type-checked by `check:skill-examples`

Clause-②: no
Metadata-protocol: none

Twenty of the forty-two fenced TypeScript blocks in `skills/objectstack-query` carry the opt-in check marker: 8 of 14 in `SKILL.md`, 8 of 11 in `rules/aggregation.md`, 4 of 10 in `rules/pagination.md`. Engine calls gain a two-line `IDataEngine` declaration from `@objectstack/spec/contracts`, and standalone query literals are typed as `QueryInput` from `@objectstack/spec/data`, so a renamed key, a removed key (`cursor`, `array_agg`) or an unknown option now fails the gate instead of shipping. Every marked example compiled as written; none needed a correction. The rest are left unmarked and each file says so once: the bare `{ where: … }` option fragments in `SKILL.md`, all seven `where` fragments in `rules/filters.md`, and the ❌/✅ pairs whose ❌ half is wrong on purpose. No rule's teaching changes.
