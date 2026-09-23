---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

fix(spec,objectql)!: `scale` is retired from the `currency` field type — refused at parse, and no longer enforced on currency writes (#19629)

Clause-②: no (narrowing)

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. A `currency` field that declares `scale` — any value, `scale: 0` included — no longer parses. The hand-migration prescription is registered under protocol major 18 as `field-currency-scale-refused`.

On a currency field the key was three-faced. The metadata-admin field designer offered it as stored metadata; the amount's cell never read it, because a currency amount's fraction digits come from its currency's own ISO 4217 minor unit; and the record validator's `max_scale` branch still refused writes carrying more decimals. An author who set `scale: 3` bought a narrower write contract and no visible change. The maintainer's ruling retires the key from the type rather than aligning the money faces to it.

**`@objectstack/spec`** — `FieldSchema` refuses `scale` on `type: 'currency'` with a located issue at `scale` whose remedy names `currencyConfig.precision`. No alias and no grace window. `scale` on `number`, `percent`, `rating`, `slider` and `formula` is untouched, and the key's describe now names that set.

**`@objectstack/objectql`** — the record validator's `max_scale` branch no longer reads `scale` for `currency`, so the type leaves the enforced set. A field definition that reaches the validator without passing `FieldSchema` (stored before this release, or built by hand at runtime) therefore narrows nothing either. `min`, `max` and the finite-number check still apply to `currency`, and `number` / `percent` / `rating` / `slider` still refuse over-scale writes exactly as before. A currency write with more decimals than a former `scale` is now ACCEPTED. Enforcing `currencyConfig.precision` on writes instead was offered to the maintainer and not taken.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `Field.currency({ label: 'Amount', scale: 2 })` | `Field.currency({ label: 'Amount' })` — delete the key |
| `{ type: 'currency', scale: 2, currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } }` | `{ type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD', precision: 2 } }` — or just delete `scale` |
| `{ type: 'currency', scale: 2, currencyConfig: { precision: 2, … } }` | `{ type: 'currency', currencyConfig: { precision: 2, … } }` — delete `scale` |

Delete the key by default. Move the value to `currencyConfig.precision` only on a field that already declares a `currencyConfig`. ⛔ Never add a `currencyConfig` just to carry the value: that block materializes `currencyMode: 'dynamic'` and `defaultCurrency: 'CNY'`, and the second changes the currency the field resolves. Under `currencyMode: 'fixed'` a moved value that contradicts the fixed currency's ISO 4217 digits is refused there in turn.

What an upgrade changes beyond the refusal:

- **Writes.** A currency value with more decimals than the deleted `scale` is accepted where it used to answer `VALIDATION_FAILED` with field code `max_scale`.
- **Two console faces, until the console catches up.** In the console version pinned when this landed, the grid summary footer and the dashboard metric widget read a currency column's `scale ?? 0`. A deleted `scale: 2` therefore renders those two faces with zero decimals until the console derives them from the currency the way the cell does. The cell and the edit widget are unaffected.

## Who is affected, measured

AST sweep on `origin/main` `1f89ba0d70`: 15 `Field.currency` declarations in `examples/` (app-crm 4, app-showcase 11) and 13 documentation code examples carried `scale`, every one `scale: 2`. All were deleted in this change. No platform object, seed or JSON fixture in the tree declares it. Seven test fixtures pinned the old shape and were re-judged. One of them, a flow oracle that needed a live `scale` gate, moved its field from `currency` to `number`.

<!-- adr-0087: registered field-currency-scale-refused -->
