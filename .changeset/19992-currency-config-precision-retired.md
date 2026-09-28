---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
---

**BREAKING** — retire `currencyConfig.precision`: a currency's decimal places are its currency's (#19992).

`currencyConfig.precision` was declared, validated against ISO 4217, and baked to `2`
into parse output — and **no renderer or runtime ever read it**. objectui's
`CurrencyField` derives an amount's decimal places from the currency's ISO 4217
minor unit (2 for USD, 0 for JPY, 3 for KWD) and never looked at the key, so an
author who wrote `precision: 4` saw the same two decimals as everyone else. Its
only reader was its own contradiction check. ADR-0049 enforce-or-remove; triage
direction REMOVE under ruling 乙 on #19910 — 「a currency's decimal places are the
currency's, not a setting」.

Clause-②: no

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' }` | `currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' }` |
| `currencyConfig.decimals` / `currencyConfig.scale` (always refused, with a suggestion to write `precision`) | nothing — delete the key; the refusal now says why instead of suggesting `precision` |
| a field whose amounts need a different number of decimals | a different currency: the width is the currency's minor unit and is declared nowhere |

**The one-line fix:** delete `precision` from every `currencyConfig`. ⛔ Do not move
the number to the field-level `precision`: that key is the amount's TOTAL digit count
(a DECIMAL(18,2) amount declares `precision: 18`), not its decimal places, and it is
unchanged by this release.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply
them by hand.

## The retirement kit

- **`CurrencyConfigSchema.precision`** — removed from the shape. The schema is a
  `strictObject`, so the route is strict deletion plus a `guidance` entry: an
  authored key is refused as `unrecognized_keys` at `currencyConfig`, and the message
  carries the prescription (``currencyConfig.precision` was removed in
  @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — no renderer or runtime ever
  read it: …``). `tsc` refuses a literal in a typed position too — the key is off
  `CurrencyConfig`'s input type.
- **The `decimals` / `scale` aliases** — gone with their target. Each is now answered
  with the same reason (`` `currencyConfig.scale` is not a currency configuration key,
  and nothing replaces it: … ``) and no rename suggestion.
- **The ISO 4217 contradiction check** (the `.superRefine`) and **the
  default-materializing `.overwrite()`** — both existed only for this key and are
  removed. `CurrencyConfigSchema.parse({})` now returns exactly
  `{ currencyMode: 'dynamic', defaultCurrency: 'CNY' }`; `CurrencyConfigParsed` no
  longer declares `precision`. The internal helpers `currencyPrecisionContradiction`
  and `currencyFractionDigits` (never exported from a public entry) are removed; the
  CLDR table they read stays, because the `iso_4217_currency` value domain reads its
  key set.
- **The field designer form** — the field-level `precision` row's help text read
  "Decimal places (e.g., 2 for $10.50)", the one reading the contract refuses. It now
  reads "Total digits", matching the key's describe and the object designer's row;
  the zh-CN / ja-JP / es-ES translations follow (`@objectstack/platform-objects`).
- **Registry** — `RETIRED_KEYS_BY_MAJOR[18]` gains `data/CurrencyConfig:precision`;
  the protocol-18 step gains the D2 conversion `currency-config-precision-removed` and
  its D3 entry `currency-config-precision-retired`, which states the two judgments the
  strip cannot make: a width declared where the old check never looked (a `dynamic`
  field, or a code with no known ISO 4217 minor unit) never applied, and code of your
  own that read the served key must derive the width from the field's currency.

## What an operator with STORED metadata sees

Nearly every stored currency field carries this key without anyone having written it:
the old `.overwrite()` baked `precision: 2` into parse output, so `sys_metadata`
object rows and built artifacts hold it. Nothing breaks at read: the conversion
`currency-config-precision-removed` is retired from the load path but replayed by the
stored-row and artifact seams, which strip the key from every field's
`currencyConfig` on objects and object extensions and serve the row canonical. The
strip is lossless — the key never had an effect — and the field-level `precision` is
never touched. `os migrate meta --stored --apply` rewrites the stored rows so the
per-row notice stops.

<!-- adr-0087: registered currency-config-precision-removed -->
