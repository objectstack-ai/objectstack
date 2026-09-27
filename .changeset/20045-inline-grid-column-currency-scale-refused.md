---
"@objectstack/spec": minor
---

fix(spec)!: `scale` is refused on a `currency` inline grid column, and the column's `prefix` no longer promises a default symbol (#20045)

Clause-②: no (narrowing)

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. An `inlineColumns` entry that declares `type: 'currency'` and `scale` — any value, `scale: 0` included, computed or not — no longer parses. The hand-migration prescription is registered under protocol major 18 as `inline-grid-column-currency-scale-refused`.

A currency's decimal places are the currency's, not a setting. `scale` was already retired from the `currency` field type; the inline grid column, the strict mirror of the console grid's column, still offered per-column decimals on a currency column. It now follows the field.

**`@objectstack/spec`** — `InlineGridColumnSchema` refuses `scale` on a column declaring `type: 'currency'`, with a located issue at the column's `scale`. The refusal opens with the currency field refusal's first sentence and carries its remedy: delete the key; the currency's ISO 4217 minor unit decides how the cell displays the amount and the width a computed amount is rounded to. The remedy names no other key to carry the value. No alias and no grace window. `scale` on a `number` column, and on a column that declares no `type`, is untouched, and the key's describe now names the currency refusal. The column's `prefix` describe no longer promises a `¥` default: it replaces the resolved currency's symbol, and when it is omitted the cell shows the symbol of the currency it resolves. `prefix` is still accepted on a currency column.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `inlineColumns: [{ name: 'amount', type: 'currency', computed: true, expr: 'quantity * unit_price', scale: 2 }]` | `inlineColumns: [{ name: 'amount', type: 'currency', computed: true, expr: 'quantity * unit_price' }]` |
| `inlineColumns: [{ name: 'unit_price', type: 'currency', prefix: '$', scale: 2 }]` | `inlineColumns: [{ name: 'unit_price', type: 'currency', prefix: '$' }]` |

The one-line fix: delete `scale` from every inline grid column that declares `type: 'currency'`. Nothing replaces it, so ⛔ do not re-declare the value under any other key. A `number` column keeps its `scale`.

## Who is affected, measured

On `origin/main` `1c8b320a89`: one authored `inlineColumns` block in the tree (the showcase invoice, seven identity-only columns, none declaring `type` or `scale`). No platform object, skill, documentation example or JSON fixture declares an inline grid column. One test fixture carried `scale: 2` on a currency column and was re-judged. Deployed metadata was not measured.

<!-- adr-0087: registered inline-grid-column-currency-scale-refused -->
