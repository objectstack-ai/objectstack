---
'@objectstack/spec': patch
---

docs(spec): the `currencyConfig.currencyMode` description says what the runtime does with each mode, and no longer calls `dynamic` "user selectable" (#20126)

Clause-②: no

The old text read "dynamic (user selectable) or fixed (single currency)". No key, stored value or runtime path lets anyone pick a currency per record. The value is a bare number in both modes (ADR-0104 D1), and the currency code lives in field config. What the runtime does, and what the description now says:

- **`fixed`**: the field has one currency, `defaultCurrency`.
- **`dynamic`** (the default): the field has no currency of its own. Amounts display in the tenant default currency, which is the `localization.currency` setting. When that setting is not set, amounts display as a plain number. `defaultCurrency` is not read.

The field faces follow this rule, and so do analytics dataset measure columns and the publish-time precision check.

Only the description text changes. The accepted keys and values, the defaults (`dynamic`, `CNY`) and parse output are the same as before. The generated reference page `content/docs/references/data/field.mdx` is regenerated from the new text.
