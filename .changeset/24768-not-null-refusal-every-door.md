---
'@objectstack/objectql': patch
'@objectstack/types': patch
'@objectstack/rest': patch
---

fix(objectql,types,rest)!: a database NOT NULL refusal on a declared field is the record validator's `ValidationError` at every door, named by the field's label

A field declared `storage: { notNull: true }` without `required` is ADR-0113's engine-populated column: the record validator judges `required` only, so a write with no value for it reaches the driver and the database refuses it. The engine let the driver's error out, and each HTTP door classified it from the driver's text its own way. For the same refused write, the runtime dispatcher's `/data` POST and PATCH answered `500 INTERNAL_ERROR`, the actions door answered `400 VALIDATION_ERROR` with the driver's text and `declaredCode: 'SQLITE_CONSTRAINT_NOTNULL'`, and `RestServer` answered `400 VALIDATION_FAILED` relabelled by a second object read on its own `POST` / `PATCH` only.

Clause-②: yes (narrowing: `@objectstack/types` adds the export `notNullViolationSite` and retires `notNullRefusalSite` and `relabelNotNullRefusal`; the HTTP doors' answer for this refusal moves to the record validator's envelope)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/types#notNullRefusalSite, @objectstack/types#relabelNotNullRefusal) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What retires is two function exports of `@objectstack/types`' published entry, whose only consumer was `@objectstack/rest`'s door-side relabel, retired in this same change; no other consumer was found in this repository (its `ui/` and `examples/` included) or in hotcrm. The affected party is a TypeScript caller, and the compiler at that call site delivers the break. -->

**BREAKING** (an export retirement and a wire-answer change), shipped as `patch`: no metadata protocol kind moves.

- **`@objectstack/objectql`.** The write doors' driver exits (single-row and batch insert, the autonumber retry, by-id and predicate update) translate a driver NOT NULL refusal on a field the object's field map holds into the record validator's own `ValidationError` (`code: 'VALIDATION_FAILED'`), built by the validator's own builder with the validator's message context: one field error, `code: 'required'`, the field named by its label (translation bundle, then declared `label`, then API name) in the caller's locale, with the sentence the validator gives the same verb (`required` on insert, `required_cleared` on update). The driver's error rides `cause`, and the doors' log line still carries the database's own diagnosis. Left as the driver threw it: a column no field declares, a refusal the driver attributes to another table, and a NOT NULL code whose column the driver did not name. `required` and `storage.notNull` stay apart (ADR-0113 D1 / D2): no pre-write check reads `storage.notNull`.
- **Every door answers it alike**, because every door already answers that class alike: the dispatcher `/data` POST and PATCH now answer `400 VALIDATION_FAILED` (was `500 INTERNAL_ERROR`), the actions door `400 VALIDATION_FAILED` with the field envelope (was `400 VALIDATION_ERROR` with the driver's text), and `RestServer`'s `POST` / `PATCH` and its `/data/:object/batch` rows answer the validator's envelope and sentence. Import rows, the public form submit and MCP write through the same engine doors and answer the same class through the same arms; they were not driven separately. On `RestServer` the body is now exactly the validator's `required` shape: `fields[0]` carries `label`, there is no `hint`, and a `PATCH` writing null reads the clear-out sentence.
- **`@objectstack/types`.** New export `notNullViolationSite(error)`: the column (and table, where the dialect names it) of a driver's NOT NULL refusal, read from the error's codes (better-sqlite3 `SQLITE_CONSTRAINT_NOTNULL`; libsql `extendedCode` / `rawCode: 1299`; node-postgres `23502` with its `column` / `table` fields; mysql2 `ER_BAD_NULL_ERROR` / `errno: 1048`), then its text (all sql.js gives), then one step down its `cause` chain. An error whose code names another refusal is not read for NOT NULL text. `mapDataError`'s NOT NULL branch is unchanged, and answers the column no field declares.
- **`@objectstack/rest`.** The `/data` create and update doors' NOT NULL relabel (`not-null-refusal-label.ts`) retires: every path it served is an engine write.

Migration, for a TypeScript caller of the retired exports:

- FROM `notNullRefusalSite(answer)` TO `notNullViolationSite(error)`: ask the driver's error, not `mapDataError`'s answer.
- FROM `relabelNotNullRefusal(answer, { message, declaresNotNull })` TO nothing (no replacement): write through the engine, which answers a declared field's NOT NULL refusal as a labelled `ValidationError` itself.
