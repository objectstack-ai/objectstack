---
"@objectstack/spec": patch
---

Reword the `CurrencyConfigSchema.precision` clause in two major-18 D3 migration entries (`os migrate meta`) — the key it describes as "unchanged" is retired in this same protocol major (#20379).

`18.field-scale-precision-integer-refused.ts` and `18.ui-form-field-precision-scale-integer-refused.ts` each carried a sentence distinguishing `CurrencyConfigSchema.precision` from the field/row-level `scale`/`precision` keys those entries retire, saying the currency key is a different surface and is unchanged. `currency-config-precision-removed` (D3 `currency-config-precision-retired`) retires that same key in this same major, so the sentence became false the moment that conversion landed. Reworded only that clause in each entry to say the key was retired in this same protocol major by `currency-config-precision-removed`; the gantt `scale` clause in the form-field entry, which is still true, is untouched.

Clause-②: no

No schema, key, conversion or verdict changes — text only. `packages/spec/src/migrations/registry.ts` regenerated with `gen:migration-registry` so the printed `os migrate meta` text matches.
