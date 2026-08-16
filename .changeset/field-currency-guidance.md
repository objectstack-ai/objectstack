---
"@objectstack/spec": patch
---

docs(spec): `FieldSchema` points a bare `currency` key at the declarable `currencyConfig` form (#8163)

`currency` has never been a declared `FieldSchema` key — only `currencyConfig`
is. Writing the natural spelling was always a loud parse error, but a **bare**
one: the rejection carried only the surface history line ("Until #4001 closed
this shape these were dropped silently…"), with no pointer to the declarable
form. The spelling is not hypothetical — objectui's `resolveFieldCurrency`
reads `field.currency` first from looser grid/column configs, so it circulates
in configs an AI author will have seen.

The target is a NESTED key (`currencyConfig.defaultCurrency` under
`currencyMode: 'fixed'`), which a flat `aliases` rename cannot express — so
this is prose (`guidance`), the same `storageNotNull`-style case already on
this surface: `currency` is not a field key; a fixed currency is declared as
`currencyConfig: { currencyMode: 'fixed', defaultCurrency: '…' }`. A field
without one uses the tenant default at runtime.

Accept/reject is byte-for-byte unchanged — `currency` was rejected before this
change and stays rejected after it; only the rejection's message gains a
prescription.
