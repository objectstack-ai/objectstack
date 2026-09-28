---
"@objectstack/objectql": minor
---

fix(objectql)!: a number, currency, percent, rating, slider or progress field reads a string by the platform's numeric grammar and stores the number it denotes (#20309)

Clause-②: no (narrowing)

**BREAKING**: shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level). The
narrowing: a string that `Number()` reads as a finite number but the platform's
numeric grammar does not is now refused with `400 VALIDATION_FAILED` /
`invalid_number`. It used to be accepted.

**What a caller sees, before → after.** One of these strings written to one of
those fields: `201`, stored as sent (memory kept the string; SQLite kept
`'0x10'` as TEXT and the others as numbers by column affinity) → `400
VALIDATION_FAILED` with the field code `invalid_number`, nothing stored. The
REST create, batch, update and updateMany routes all answer it, and `validate`
(the dry run) predicts it. The forms:

- a radix literal: `'0x10'`, `'0X1A'`, `'0o17'`, `'0b101'`;
- a whitespace-padded number: `' 12 '`, `'12\n'`, `'\t-3'`;
- a spelling that is not a JSON number: `'+5'`, `'.5'`, `'5.'`, `'007'`.

The fix, when a write is refused: send a JS number, or the number's plain JSON
spelling — `'16'`, `'12'`, `'-3'`, `'5'`, `'0.5'`, `'7'`. `String(n)` of any
finite number always qualifies, exponent forms included (`'1e-7'`, `'1e+21'`).

## What was wrong

This is the separate change the earlier #20309 note (arrays, booleans and
objects refused) left open. The record validator judged a string by `Number()`
while the write carried the string itself, so an accepted string reached the
driver as sent:

- **memory** stored `'12'` as the string `'12'` and read it back as a string;
- **SQLite** stored `'0x10'` as the TEXT `'0x10'` (read back as `16`), and the
  other accepted strings as numbers through the column's affinity.

One write, two stored shapes, depending on the backend.

## What changes

- A string is judged by `parseNumericString` from `@objectstack/spec/data`, the
  one numeric grammar the filter door also reads: the whole string is a JSON
  number literal naming a finite double. Its case table,
  `NUMERIC_STRING_GRAMMAR_CASES`, decides every form. No second grammar lives in
  the engine.
- An admitted string is stored as the number it denotes, on every backend:
  `'12'` is written as `12`, `'1e3'` as `1000`. The rewrite runs at the write
  door, before the middleware, the hooks, the `readonlyWhen` locks and
  validation read the payload, so a `before*` hook now sees the number. The
  caller's own object is not mutated.
- `min`, `max`, `scale` and `precision` read that number, exactly as they read
  a number: `'12.50'` passes `scale: 1` (it is `12.5`), and `'150'` over
  `max: 100` is `max_value`.
- This holds on every engine, REST, batch and updateMany door, and in
  `validate` (the dry run). The server `/import` route is unchanged: its own
  cell reader turns a numeric cell into a number before the write, so the
  grammar never sees a string from it.
- A blank is still `null` before the check (#20308). `summary` is still not
  judged. A number, and an array, boolean or object, are answered as before.

## Who sends numeric strings

objectui's CSV import wizard, on its legacy per-row fallback (`legacyImport`,
used only when the connected client cannot reach the server `/import` route),
posts each raw cell to `create` after a client check of
`!isNaN(Number(value))`. Its parser trims cells, so of the refused forms it can
send the radix literals and the non-JSON spellings. Those rows now fail with
`invalid_number` instead of storing a string. The fix there is the wizard's
default path: import through the server `/import` route, whose cell reader
converts the number before the write. Every interactive form widget sends a JS
number or `null`, and is unaffected.

## Rows already stored

This judges new writes only; a stored value is never re-read by the check. On
memory, an accepted string stayed a string until the record is next written.
On SQLite, the earlier #20309 note's query finds a numeric column holding TEXT
(such as `'0x10'`):

```sql
SELECT id, "FIELD" FROM "OBJECT" WHERE typeof("FIELD") = 'text';
```

OBJECT is the object name and FIELD is the field name. Nothing here rewrites
such a cell; decide its number by hand.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: `packages/spec` is untouched and no metadata key is added, removed or reshaped, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What narrows is the set of caller-written string VALUES a number-typed field accepts at the write door, judged by the spec's existing numeric grammar; stored rows are never re-read, and a caller that sends a number, a blank or a grammar-admitted string is unaffected. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a write-door value check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
