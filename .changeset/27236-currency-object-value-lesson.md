---
'@objectstack/spec': patch
'@objectstack/objectql': patch
---

fix(objectql): a currency field written as an object, `{ value, currency }`, is refused with a sentence that says a currency value is a bare number

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a written VALUE at the record validator's numeric arm gains a second sentence: no authorable key, spelling or stored shape of metadata moves, and no schema, type or export changes. `packages/spec` gains one sentence in the built-in validation-message catalog (`invalid_number_currency_object`, a rendering variant of the existing `invalid_number` wire code, which is unchanged), and the accept set of the write door is the same before and after. A stored row keeps whatever it holds. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a write-door value check (not `registered` / `already-registered`); and the change is a message, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

The `{ value, currency }` shape was retired by ADR-0104 D1. A record write that still sends it to a `currency` field was refused with only "Amount must be a number", which does not say what to write instead.

- **`@objectstack/objectql`**: when a `currency` field's value is a plain object, the `invalid_number` refusal now reads: "Amount is a currency amount: write it as a bare number (e.g. 10), not an object such as { value, currency }. A currency field declares its currency in currencyConfig: the fixed mode's defaultCurrency, or under the dynamic mode (the default) the tenant default currency (ADR-0104)". The wire code stays `invalid_number`, with no new key on the error, so no client contract moves. A non-number string, an array, and an object on a `number` field keep the plain sentence.
- **`@objectstack/spec`**: the validation-message catalog carries that sentence as `invalid_number_currency_object`, in en, zh-CN, ja-JP and es-ES. A deployment can override it under `validation.field.invalid_number_currency_object`, like any other built-in message.

What to do: nothing. Writes that were accepted are still accepted, and writes that were refused are still refused with the same code.
