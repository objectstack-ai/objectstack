---
'@objectstack/objectql': patch
---

fix(objectql): a CEL `defaultValue` stores the declared type's contract shape instead of a raw `Date` (#7373)

`applyFieldDefaults` produces a default three ways, and only two of them
honoured the stored-value contract. The `NOW()` token routes through
`resolveNowDefault`, which emits the form the declared type stores; a literal is
checked against `valueSchemaFor(def, 'stored')` at author time (#7127); the
expression envelope's result was assigned **verbatim**. The temporal stdlib
returns a JS `Date` — ADR-0053 D1 fixes `today()` / `daysFromNow(n)` /
`daysAgo(n)` as UTC-midnight of the reference-tz calendar day, and `now()` as
the raw instant — so `{ dialect: 'cel', source: 'daysFromNow(7)' }` on a
`datetime` put a `Date` **object** in the column while `valueSchemaFor` names an
ISO-8601 **string**. Nothing refused the write (`validateRecord` accepts a
`Date` on `date`/`datetime` by explicit decision), so the divergence was silent
— and `os migrate value-shapes`, which walks stored values against that same
schema, reports such a row as a violation by the platform's own scan.

The expression branch now routes a `Date` result through the same per-type table
the `NOW()` token uses: `datetime` stores `YYYY-MM-DDTHH:MM:SS.sssZ`, `date`
stores `YYYY-MM-DD`, `time` stores `HH:MM:SS[.fff]`. One table, both branches —
not a second copy of the contract.

**Storage on SQL and MongoDB is byte-identical to before.** Handed a `Date`,
`SqlDriver.formatInput` already coerced it through `canonicalUtcDatetime`
(`toISOString()`) and `toDateOnly`, and mongodb's `storageDatetimeValue` /
`storageDateValue` do the same, so those backends already stored exactly what
the engine now produces. What changes is the memory driver, which applies its
temporal canon to filter comparands only (`coerceTemporalValue`) and stored
writes as handed: it kept the `Date` object. Same declaration, different stored
shape per datasource — the split #4597 / #4560 closed for the `NOW()` token,
reappearing on the CEL branch and now closed the same way, engine-side, so one
answer serves every driver.

Normalization rather than refusal, because refusing a `Date` here would make the
rule depend on who wrote the value: `validateRecord` accepts one from any
caller, temporal types are not in ADR-0104's strict value-shape block, and the
documented envelope (#7244) stores correctly on SQL today. Non-`Date` results
pass through untouched — a CEL default's result type is otherwise a runtime
concern — as does an `Invalid Date`, keeping the totality the driver canons
have. No calendar day can shift: ADR-0053 D1's `Date` is UTC-midnight *of* the
reference-tz day and is read back with UTC getters, the same `getUTC*` the ADR
names for the driver filter path.
