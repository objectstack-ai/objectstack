---
"@objectstack/spec": minor
---

fix(spec)!: the boolean-comparand verdict refuses a number other than `1` / `0`, a `Date` and an array compared against a boolean field, the same as a string that is not a boolean

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a filter COMPARAND value at the engine's query door, decided by the published boolean-comparand verdict: no authorable key, spelling or stored shape moves, and no export is removed or renamed (the verdict's function, its case table and its words keep their names; three exports are added). No stored row is read or rewritten. What is refused is a number other than 1 / 0, a Date or an array compared against a declared boolean field or a boolean aggregated column; which boolean the caller meant by 2 is not something a ledger entry can decide (reading 2 as true is exactly the silent coercion this refuses). The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a filter comparand (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a filter may compare a boolean field with. `booleanComparandDoorVerdict`, the published verdict the engine's boolean-comparand arm consumes, judged strings only; it now also answers `door-refusal` (`INVALID_FILTER` / 400) for a number other than `1` / `0`, a `Date` and an array, so the engine refuses them before any read, on every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. The accepted set is unchanged: `true`, `false`, `1`, `0`, `"true"`, `"false"`, `"1"` and `"0"`, and `null` is still the null test.

What moves in `@objectstack/spec/data`:

- `booleanComparandDoorVerdict(field, comparand)` answers `door-refusal` with a new `form` for each non-string: `number`, `date` or `array`. `readBooleanComparand` reads a `bigint` as the number it names, so `1n` / `0n` narrow like `1` / `0` and any other `bigint` is refused as a number. That is the number the comparand-type door rewrites a `bigint` to, so the answer no longer depends on which door met it first.
- Three additive exports: `NON_BOOLEAN_VALUE_FORMS` (`number`, `date`, `array`) and the types `NonBooleanValueForm` and `NonBooleanComparandForm`. The refusal's `form` (on `BooleanComparandDoorVerdict`, `BooleanComparandRefusalSite` and `BooleanComparandDoorRefusalCase`) widens from `NonBooleanStringForm` to `NonBooleanComparandForm`, and the refusal site's `value` now carries a non-string. A consumer that switches over `form` exhaustively gains three cases.
- `booleanComparandRefusalMessage` gains one clause per non-string form, and renders a `Date` as `Date(ISO)` and a non-finite number by name instead of as JSON.
- `BOOLEAN_COMPARAND_DOOR_CASES` gains a `value` group: `-1` at `$ne` on every judged field, and `2`, a `Date` and an array at every judged position of `f_boolean` (no array at the equality slots, where the comparand-shape door refuses one first), plus the passing rows beside them. The `2` / `-1` reading rows, and a new `0.5` row, now derive refusals.

FROM a number other than `1` / `0` (`2`, `-1`, `0.5`), a `Date`, or an array where one value belongs (a scalar operator's comparand, or a member of `$in` / `$nin` / `$between`), compared against a `boolean` or `toggle` field (or a groupBy / `min` / `max` column of one in `having`) → TO `INVALID_FILTER` / 400, naming the field, its declared type, the comparand, its position and what is wrong with it. The fix is one line: send `true` or `false`, or `1` / `0`; to match either value use `$in`, each member a boolean.

**Unchanged.** Every string the verdict accepted or refused is answered as before, in the same words. A boolean, `null` and the flag operators (`$null`, `$exists`, `$empty`) pass. A value outside the accepted comparand types (`undefined`, a plain object, a `Map`) keeps the comparand-type door's own refusal and words, and a `{ $field }` reference is not judged. A comparand against a field that is not boolean is not this verdict's subject.
