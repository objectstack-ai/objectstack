---
"@objectstack/spec": minor
---

feat(spec): reject a declared currency `precision` that contradicts the currency's ISO 4217 fraction digits (#7918)

Maintainer ruling 2026-08-12 (Option A): when a currency field's currency is
statically known — `currencyConfig` in `fixed` mode — an **authored**
`precision` that contradicts that currency's ISO 4217 / CLDR fraction digits
is now a publish-time validation error, naming both numbers ("currency JPY has
0 fraction digits; `precision: 2` contradicts it"). `precision: 2` next to a
fixed JPY asked for two digits of a minor unit the yen does not have;
`precision: 2` on fixed KWD silently dropped the real third fils digit. The
check runs at both anchors the width can be authored on: the field-level
`precision` key and `currencyConfig.precision`.

Deliberately partial, per the ruling: `dynamic` currencyMode has no single
currency to check against and is untouched by design; currency codes outside
CLDR `currencyData` (crypto/custom business codes) fail open — the code set
stays deliberately open. Only *authored* precision is judged: an untouched
`currencyConfig` (whose `precision` defaults to `2`) still parses byte-identically,
whatever its currency — the default was relocated from the property into a
post-check `.overwrite()` so the rule can see authored-vs-defaulted, with
parse output unchanged.

This is an acceptance narrowing in the #3746 shape (minor, not major): every
newly-rejected input was a contradiction no consumer could honor — renderers
already derive the width from the currency when precision is absent
(objectui#4361), and the rejected combinations rendered money with digits the
currency does not have. Fix a rejected field by dropping `precision` (derive
from the currency) or setting it to the currency's own digit count, which the
error message states.

One visible type-level change: `CurrencyConfigParsed.precision` is now
inferred `number | undefined` (the #6926 `.overwrite()` cost) although a
parsed config always carries a number at runtime — the materialized default
is unchanged.
