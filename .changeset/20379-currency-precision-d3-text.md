---
"@objectstack/spec": patch
---

Reword the `CurrencyConfigSchema.precision` clause in two major-18 D3 migration entries (`os migrate meta`) — the key it describes as "unchanged" is retired in this same protocol major (#20379).

`18.field-scale-precision-integer-refused.ts` and `18.ui-form-field-precision-scale-integer-refused.ts` each carried a sentence distinguishing `CurrencyConfigSchema.precision` from the field/row-level `scale`/`precision` keys those entries retire, saying the currency key is a different surface and is unchanged. `currency-config-precision-removed` (D3 `currency-config-precision-retired`) retires that same key in this same major, so the sentence became false the moment that conversion landed. Reworded only that clause in each entry to say the key was retired in this same protocol major by `currency-config-precision-removed`.

The form-field entry's other clause was also wrong on its own terms: it named a "gantt `scale` enum" that `GanttConfigSchema` does not declare (its granularity key is `viewMode`; `strictObject` refuses `scale` there). Corrected it to name the surface that actually carries an enum-valued `scale` — `TimelineConfigSchema.scale`, still unchanged — and to say plainly that the gantt view has no `scale` key.

Clause-②: no

No schema, key, conversion or verdict changes — text only. `packages/spec/src/migrations/registry.ts` regenerated with `gen:migration-registry` so the printed `os migrate meta` text matches.
