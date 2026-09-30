---
"@objectstack/spec": minor
---

fix(spec)!: a `time` value carries no zone — `ClockTimeValueSchema` refuses a `Z` or a UTC offset, so a `time` field default, an action param default or a submitted `time` action param with one is refused when it is authored or submitted, not on every insert that falls back to it

Clause-②: no (narrowing)

<!-- adr-0087: registered time-default-utc-suffix-dropped, time-default-zone-refused -->

**BREAKING**: this narrows the `time` stored form (`valueSchemaFor({ type: 'time' })`) to the zone-less wall clock `HH:MM[:SS[.fraction]]` that the record validator already enforces on write (ADR-0053 D-C1). It ships as `minor` under the launch-window convention for accept-set narrowings; the breaking-ness is carried by this banner and the ADR-0087 disposition above.

Refused now, where they parsed before:

- `FieldSchema`: a `time` field's literal `defaultValue` with a zone (`'10:00Z'`, `'10:00+08:00'`). Before, it parsed and each insert that fell back to it was refused `400 VALIDATION_FAILED` / `invalid_time` on a field the caller never sent.
- `ActionParamSchema`: a `time` param's literal `defaultValue` with a zone.
- `validateActionParams` (the action dispatcher, ADR-0104 D2): a submitted `time` param value with a zone, now `invalid_shape`.

## FROM → TO

| you wrote | write instead |
| --- | --- |
| `defaultValue: '10:00Z'` or `'10:00+00:00'` | `defaultValue: '10:00'` |
| `defaultValue: '10:00+08:00'` | the wall clock you meant, `'10:00'` or `'02:00'`, or a `datetime` field for an instant |

**The one-line fix:** drop the `Z` or offset from every `time` value, or use a `datetime` field.

**Stored metadata.** The D2 conversion `time-default-utc-suffix-dropped` (retired from the load path) drops a `Z` or a zero offset from a stored `time` default on a field or on an action param typed `time`, so such a row loads canonical. It leaves a non-zero offset as stored and reports it as a TODO naming the field or param, which `os migrate meta --stored` lists; the row keeps loading, fails the schema wherever it is parsed, and needs the rewrite by hand. The D3 entry `time-default-zone-refused` carries that judgement.

**Unchanged:** a zone-less wall clock, the `NOW()` token and expression defaults on a `time` field, and every `date` and `datetime` value. The repo census found no shipped `time` default with a zone.
