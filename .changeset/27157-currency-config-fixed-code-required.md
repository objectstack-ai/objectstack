---
'@objectstack/spec': minor
'@objectstack/formula': minor
'@objectstack/platform-objects': minor
---

fix(spec)!: a `fixed` currency config needs its code — `currencyConfig.defaultCurrency` loses its `'CNY'` default, and a `dynamic` config parses with no code

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered currency-config-fixed-default-currency-required, currency-config-dynamic-default-currency-removed -->

**BREAKING** for one shape: a `currencyConfig` with `currencyMode: 'fixed'` and no `defaultCurrency`, on a currency field or on a formula field whose `returnType` is `currency`. Ruling X on #27119: an amount whose currency is not known takes the tenant default, and nothing guesses.

- **Before.** `defaultCurrency` was `.default('CNY')`. `{ currencyMode: 'fixed' }` parsed to `{ currencyMode: 'fixed', defaultCurrency: 'CNY' }`, so the field silently became a yuan field and showed `¥` in a dollar or euro app. Every `dynamic` config's parse output carried that `'CNY'` too, though nothing reads a `dynamic` config's code.
- **Now.** A `fixed` config without a code is refused at every door that parses a field (`defineStack`, `os validate`, the object save door), with one `custom` issue at `currencyConfig.defaultCurrency`: "`currencyConfig.currencyMode: 'fixed'` needs `defaultCurrency`, the field's one currency: give its ISO 4217 code (e.g. `defaultCurrency: 'USD'`), or use `currencyMode: 'dynamic'` to display amounts in the tenant default currency (the `localization.currency` setting)." A `dynamic` config (and an empty one) parses to `{ currencyMode: 'dynamic' }`: no code is materialized. An authored code under `dynamic` is still accepted and still unread.
- **FROM → TO.** `currencyConfig: { currencyMode: 'fixed' }` → `currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' }` (the code the field is in; until now it displayed CNY), or `currencyMode: 'dynamic'` / no `currencyConfig` for the tenant default currency.
- **The one-line fix.** Write the code next to `currencyMode: 'fixed'`.
- **Stored rows and built artifacts (ADR-0087).** A built artifact holds the parsed stack, so its `fixed` configs carry the code the old parse filled in and keep it. A `sys_metadata` object row is stored as authored, so a row saved as `{ currencyMode: 'fixed' }` (Studio's Fixed mode with the code left blank, or a `/meta` write) has no code, and nothing converts one in: guessing `'CNY'` is what the ruling forbids. Such a row still loads and is registered unchanged; boot counts it `invalid` and prints `[metadata_spec_invalid] stored object/NAME fails the current spec schema even after conversion (fields.FIELD.currencyConfig.defaultCurrency: …)`, and the next save of that object is refused (422 `INVALID_METADATA` at `fields.FIELD.currencyConfig.defaultCurrency`) until the code is written. Its display does not change: the registry already held the row as stored, and the console reads a `fixed` code only when there is one, so it showed the tenant default before and still does. `@objectstack/formula` now reads a formula over that field as an unproven currency instead of fixed CNY. The D2 conversion `currency-config-dynamic-default-currency-removed` strips the unread code from `dynamic` configs (and configs with no mode) on stored-row rehydration and inside a built artifact's declared-floor window, on objects and object extensions; no display changes. It is retired from the load path, so an authored source is never rewritten. The upgrade guide entry is `currency-config-fixed-default-currency-required`.
- **Readers.** None changes what it displays. The console's `resolveFieldCurrency` and the analytics field-currency relay already read the code only under `fixed`. `@objectstack/formula`'s return-type inference reads a field's currency through `CurrencyConfigSchema`; a `fixed` config without a code no longer parses there, so it reads as an unproven currency instead of CNY.
- **`@objectstack/platform-objects`.** The field form's `defaultCurrency` help text says the code is required in fixed mode instead of "Defaults to CNY", in en, zh-CN, ja-JP and es-ES.

Survey at the change: 11 `fixed` currency configs across `examples/**`, `packages/platform-objects/**`, `packages/qa/**`, seeds and fixtures, none without a code.
