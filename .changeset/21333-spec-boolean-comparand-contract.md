---
"@objectstack/spec": minor
---

feat(spec): the boolean-comparand declared-type contract in `@objectstack/spec/data` — the comparands a declared boolean field accepts in a filter, the boolean each narrows to, and the refusal words

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an additive contract module: new exports only, in a new file beside the number-comparand contract. No authorable key, spelling, existing export or stored shape moves, no Zod schema changes, and no stored row is read or rewritten. The narrowing it declares (a string other than "true" / "false" / "1" / "0" against a declared boolean field is refused in a filter) is enforced at the engine's query door by @objectstack/objectql, whose changeset states it; which boolean a caller meant by "yes" is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter comparand, and this diff adds none (not registered / already-registered); and the module declares a runtime rule, not a TypeScript-only surface (not runtime-interface-only / type-surface-only). -->

**BREAKING**: the module declares a narrowing of what a filter may compare a declared `boolean` or `toggle` field with; the engine door that enforces it is `@objectstack/objectql`'s. It ships as `minor` under the launch-window convention for accept-set narrowings. Every existing export is unchanged.

**What it declares.** `filter-boolean-comparand-declared-type.ts`, the boolean twin of `filter-number-comparand-declared-type.ts`:

- `BOOLEAN_COMPARAND_SPELLINGS`: the accepted non-boolean spellings, `1` / `0`, `"1"` / `"0"` and `"true"` / `"false"`, each with the boolean it narrows to. This is the set the record validator admits when a boolean field is written. `readBooleanComparand` reads a comparand by it, and names why a string is not one (`NON_BOOLEAN_STRING_FORMS`: `empty`, `padded`, `letter-case`, `placeholder`, `not-a-boolean`).
- `BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES` (`BOOLEAN_VALUE_TYPES` itself), and the judged positions, which are the number door's lists by identity.
- `booleanComparandFieldVerdict` and `booleanComparandDoorVerdict`, the pure verdict: `narrows`, `door-refusal` (`INVALID_FILTER` / 400), `passes` or `deferred`.
- `booleanComparandRefusalMessage`: the refusal words, inside the 500-character client bound.
- `BOOLEAN_COMPARAND_READING_CASES`, `BOOLEAN_COMPARAND_DOOR_FIXTURE` and the derived `BOOLEAN_COMPARAND_DOOR_CASES`, for a door's suite to drive.

**What is refused.** A string other than the four accepted ones, compared with a declared boolean field, at the value positions of a filter (the implicit comparand, `$eq` / `$ne` / `$gt` / `$gte` / `$lt` / `$lte`, and each member of `$in` / `$nin` / `$between`). Before, such a string was compared as written and matched no row (every row under `$ne`).

**The remedy.** Write `true` or `false`, or in a querystring `true` / `false` or `1` / `0`.
