---
'@objectstack/formula': minor
'@objectstack/skills': patch
---

feat(formula): `rmbUpper(amount)` writes an amount in Chinese capital numerals (人民币大写) for printed quotes, contracts and invoices

Clause-②: yes (widening) — a new CEL stdlib function, `rmbUpper(dyn): string`, registered by `registerStdLib` and advertised in `CEL_STDLIB_FUNCTIONS`; an expression that calls it was refused as an unknown function before, and nothing that worked before is refused or changes value.
Metadata-protocol: added — a formula, predicate or flow value may now call `rmbUpper(...)`.
Skills-docs: updated here — `skills/objectstack-formula/SKILL.md` lists it in the stdlib Numbers table, and `content/docs/data-modeling/formulas.mdx` adds the catalog row and an "Amount in Chinese capitals" cookbook entry.

`rmbUpper(245000)` is `贰拾肆万伍仟元整` and `rmbUpper(10500.5)` is `壹万零伍佰元伍角`. A formula field reads it as text:

```ts
Field.formula({ label: '大写金额', returnType: 'text', expression: 'rmbUpper(record.total_amount)' })
```

- The amount is rounded once to 分, half away from zero, on the exact decimal it spells, so `1.005` is `壹元零壹分` and binary floating point never decides a cent.
- One `零` stands for each run of zeros (`壹仟零伍元整`, `壹万零伍佰元整`, `壹亿零壹元整`), a ten is `壹拾`, the 万 and 亿 groups follow the usual rules, and the count of 亿 above 亿 is written with 万 (`壹拾万零壹亿元整`).
- A whole amount ends in `整`; a 分 with no 角 writes `零` for the 角 (`壹元零伍分`); an amount under one yuan is its 角 and 分 alone (`伍角`).
- `0` is `零元整`, a negative amount is prefixed `负`, and `null` reads `''`, so an empty total prints an empty line.
- A number, a currency field and decimal text (`'245000.00'`) are read. Text that spells no number, a boolean or a list, and an amount of 10^16 yuan or more, is a runtime error rather than some text.
