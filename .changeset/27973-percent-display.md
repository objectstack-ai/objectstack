---
'@objectstack/spec': minor
'@objectstack/metadata-core': minor
'@objectstack/driver-sql': minor
---

feat(spec): a `percent` field declares its read-only face with `percentDisplay` (`bar` or `plain`)

Clause-②: yes (widening)
Metadata-protocol: added

A `percent` field had no key to choose how it is drawn read-only, so every host showed a progress bar, even for a rate or a probability (an opportunity's win probability is not progress). `FieldSchema` gains an optional `percentDisplay`:

- **absent** (unchanged): the renderer's default face, the progress bar today;
- **`bar`**: the author pins the progress bar;
- **`plain`**: the percentage as text alone (a stored `0.25` reads `25%`, at the field's `scale`), with no bar.

```ts
probability: Field.percent({ label: 'Probability', percentDisplay: 'plain' }),
```

Display only: the stored value, its validation and its decimal places are unchanged. The key is declared ahead of its renderer: the Studio UI does not read it yet, so every percent field still draws the bar until the console's percent face reads it. No existing metadata changes meaning.

`@objectstack/metadata-core` classifies the new key for field-level security (ADR-0106 D1) as `keep`: it names no field, so a served object schema keeps an authored `percentDisplay` whatever the caller may read. Unclassified, a value that happened to spell a denied field's name (`bar`, `plain`) would have been scrubbed. `@objectstack/driver-sql` classifies it `presentation` in its FieldSchema storage/presentation table: the DDL never reads it.
