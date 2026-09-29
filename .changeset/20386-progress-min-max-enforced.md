---
"@objectstack/objectql": minor
---

fix(objectql)!: a `progress` field's declared `min` / `max` are enforced on writes — a value outside them is refused with `min_value` / `max_value`, exactly as on `number` (#20386)

Clause-②: no (narrowing)

**BREAKING** — a narrowing of the write accept set on `@objectstack/objectql`, shipped as `minor` under the repo's launch-window convention (`check-changeset-no-major` refuses `major` until GA); the breaking-ness is carried by this banner and the ADR-0087 disposition, never by the level. Nothing an author writes changes spelling: `min` and `max` keep their keys, their type and their legality on every field type.

`FieldSchema.min` / `max` declare a check ("Checked on the WRITTEN value only") with no type exclusion, but the record validator returned for a `progress` field right after its finite-number check, above the bounds. So a `progress` field declaring `max: 100` stored `150`, and one declaring `min: 0` stored `-5`, with `201` on memory and SQLite, while a `number` field with the same bounds refused both. The bounds now bind on `progress` at the one place a write is judged.

**What a caller sees, before → after.** A `progress` write outside a declared bound: `201`, stored as sent → `400 VALIDATION_FAILED` with field code `max_value` (`constraint: { max }`) or `min_value` (`constraint: { min }`), nothing stored. That is the `number` field's answer, envelope for envelope, in all four locales. The REST create, batch, update and updateMany routes all answer it, and `validate` (the dry run) predicts it. A value inside the bounds, or on either bound (both are inclusive), writes exactly as before. Only a write that CARRIES the field is judged: a stored value outside a bound is never re-read and survives an update that does not send it.

The fix, when a write is refused: send a value inside the bounds, or widen or delete the field's `min` / `max` to match what it really holds.

⛔ Only the bounds. `scale` and `precision` stay unread on `progress`: each key's own contract names the types it binds on, and `progress` is in neither set, so `33.5` still writes into a `progress` field that declares `scale: 0`.

**Who is affected, measured** on `origin/main` `dc0ab6a2e`: the two example-app `progress` fields (`examples/app-showcase` `showcase_task.progress` and the field zoo's `f_progress`) both declare `min: 0, max: 100`, and every value their seeds and actions write (12 seed rows, one `progress: 100` action) is inside. The console's `progress` editor, objectui's `SliderField`, drives a Radix slider bounded by the field's declared `min` / `max`, so it cannot emit a value outside them.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: `min` and `max` keep their keys, their type (`z.number().optional()`) and their legality on every field type, `packages/spec` is untouched, and no stored metadata representation changes, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What narrows is the record validator's write accept set for values under bounds the field already declares, which is runtime behaviour, not an authored shape. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id is minted here and none covers this (not `registered` / `already-registered`); and runtime behaviour changes, not only a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
