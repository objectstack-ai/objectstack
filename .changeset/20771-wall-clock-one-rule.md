---
'@objectstack/core': patch
---

`isUninterpretableTemporalComparand` reads a bare wall clock on a `time` column by the spec's `ClockTimeValueSchema` (`@objectstack/spec/data`), not by a private copy of it (#20771)

Clause-②: no

The wall-clock half of core's `time` rule (`HH:MM[:SS[.fraction]]`, hours 00 to 23, minutes and seconds 00 to 59, no time zone) was spelled twice: once as the spec's `ClockTimeValueSchema`, the stored form of a `time` value, and once as a private regex in `@objectstack/core`. The two admitted the same strings, but nothing tied them together, so an edit to either one changed one side only. Core now asks the spec schema. Every caller of `isUninterpretableTemporalComparand('time', …)` therefore answers from the rule the spec's `time` default gate uses: the engine's temporal-comparand door, the analytics comparand check, the record validator's `time` arm and the import's `time` coercion.

Unchanged:

- Every string gets the verdict it got before. Measured over 8,655,360 generated strings: 8,640 read by both the old regex and the schema, the rest refused by both, 0 answered differently.
- An instant, a number or a `Date` on a `time` column is judged as before.
