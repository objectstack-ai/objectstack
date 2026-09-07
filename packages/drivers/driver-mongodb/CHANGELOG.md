# @objectstack/driver-mongodb

## 17.4.0

### Patch Changes

- a06faeb: fix(driver-mongodb): put the test layer in front of tsc, so the package's own typecheck reports a PASS and not a NUMBER (#14917)
  
  `packages/drivers/driver-mongodb`'s `tsconfig.json` excluded `**/*.test.ts`, and
  its `typecheck` script is `tsc --noEmit` against that very config. Measured at
  `6ed4b811af` with the dependency closure built: that program admits **0** of the
  package's 30 `src/**/*.test.ts` files while all **10** of its non-test `src/**`
  files ARE there, so `pnpm --filter @objectstack/driver-mongodb typecheck`
  exiting 0 was a true sentence carrying no information about any test file.
  
  The filing's headline — that a compile-time `Equals` / `IsAny` pin here is
  "checked by nothing" — is **false**, and the correction on the card is right: a
  second program does compile these files. `check-type-check-coverage.mjs`'s
  `remeasureProject` drops only the test glob and compares the result against its
  `TEST_DEBT` ledger. Confirmed here by ablation rather than argued: a
  deliberately false `Equals` pin added to `mongodb-driver.test.ts` takes that
  program from 10 errors to 11, above the ledger's recorded 10, which reddens it.
  The pins were never phantoms. What was true is narrower, and is what this change
  closes: the only program reading this layer was a **debt ratchet** — an
  instrument that reports a number and fails when the number moves, not a gate
  that reports a pass.
  
  Gives the package the #5286 sibling shape (`packages/rest`, `runtime`,
  `objectql`, `core`): a `tsconfig.test.json` with module semantics only —
  `esnext` / `bundler` / `lib: ES2022`, matching how vitest actually executes
  these files — strictness inherited and untouched, named by the `typecheck`
  script via `check:test-typecheck`.
  
  Measured: **10** errors under the ratchet's shape (matching its recorded number,
  and its recorded composition `TS1309 x7, TS2550 x3`, class for class), and **0**
  under the split. All 10 were config-tier in full — 7 `TS1309` (`await` at module
  scope in a program NodeNext compiles as CJS, because this package has no `"type":
  "module"`) and 3 `TS2550` (`Array.prototype.at` against a `lib` older than
  es2022). Neither class says anything about a test, and nothing was exposed
  behind them: there was no unresolved-import cascade here to collapse, so there
  is no `+n` term. `noUnusedLocals` / `noUnusedParameters` are live for this
  package (unlike `driver-turso`, which switches both off) and neither fires.
  
  The `TEST_DEBT` entry (10 errors) is **deleted**, not lowered — the graduation
  this ratchet's invariant requires. No `test-typecheck-debt.json` is added:
  residue is 0, so none is owed (#5286, maintainer-only to open). That leaves all
  30 files unledgered, so any error any one of them gains is red on arrival.
  
  `check:type-source-resolution` went red from onboarding the new program (the
  documented onboarding-limb case, #11490): a registry entry is added rather than
  `paths`, with its numbers stated in place — 123 tsc programs / 309 pairs before,
  124 / 310 after. The single new pair is `@objectstack/objectql`, a devDependency
  that no non-test file in `src/` imports.
  
  No runtime code changes: not one test file and not one source file is edited, so
  no shipped behaviour moves — the suite reports the same 552 passed / 147 skipped
  across 30 files as before. The `patch` level reflects the published
  `package.json` gaining `typecheck` / `check:test-typecheck` scripts and a `tsx`
  devDependency.
- Updated dependencies [2ed6be6]
- Updated dependencies [07f40e5]
- Updated dependencies [ceb4877]
- Updated dependencies [e9fcd6b]
- Updated dependencies [ca326b5]
- Updated dependencies [8f404a5]
- Updated dependencies [3e3ecb0]
- Updated dependencies [d5d8d50]
- Updated dependencies [b548e43]
- Updated dependencies [c463d03]
- Updated dependencies [64bd6a3]
- Updated dependencies [13c48c2]
- Updated dependencies [66dc6ab]
- Updated dependencies [6f94458]
- Updated dependencies [6e67b86]
- Updated dependencies [132742f]
- Updated dependencies [85a2459]
- Updated dependencies [e89fa92]
- Updated dependencies [e9fcd6b]
- Updated dependencies [56fe8c2]
- Updated dependencies [ab50c8f]
- Updated dependencies [6491463]
- Updated dependencies [89cf4d6]
- Updated dependencies [bca21f7]
- Updated dependencies [e9fcd6b]
- Updated dependencies [2025b1f]
- Updated dependencies [1a7a7c9]
- Updated dependencies [e9fcd6b]
- Updated dependencies [ef3a138]
- Updated dependencies [fa125f3]
- Updated dependencies [a646120]
- Updated dependencies [6f1ce7d]
- Updated dependencies [7778115]
- Updated dependencies [2c753fe]
- Updated dependencies [52804cd]
- Updated dependencies [3f89967]
- Updated dependencies [53cf263]
- Updated dependencies [9c270bb]
- Updated dependencies [088f761]
- Updated dependencies [a84e1ce]
- Updated dependencies [bf1054a]
- Updated dependencies [d8d2776]
- Updated dependencies [222dc0f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [f9a3c32]
- Updated dependencies [f502898]
- Updated dependencies [cf9bda4]
- Updated dependencies [784cb92]
- Updated dependencies [a7da4de]
- Updated dependencies [5eb24f8]
- Updated dependencies [cc00df2]
- Updated dependencies [cc00df2]
- Updated dependencies [4db3c61]
- Updated dependencies [5ca314a]
- Updated dependencies [414c1fc]
- Updated dependencies [0db2947]
- Updated dependencies [92b5d7f]
- Updated dependencies [8e0b297]
- Updated dependencies [d4f9b2a]
- Updated dependencies [5f7fa1d]
- Updated dependencies [87f0ccc]
- Updated dependencies [aedbaef]
- Updated dependencies [a727043]
- Updated dependencies [69602e5]
- Updated dependencies [46803fa]
- Updated dependencies [c2a336c]
- Updated dependencies [f7db8f4]
- Updated dependencies [9408b7f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [b398ad2]
- Updated dependencies [99261a7]
- Updated dependencies [81b426f]
- Updated dependencies [fb77aa5]
- Updated dependencies [3d3f60e]
- Updated dependencies [581d8f8]
- Updated dependencies [f81afe3]
- Updated dependencies [40a44b9]
  - @objectstack/core@17.4.0
  - @objectstack/spec@17.4.0
  - @objectstack/types@17.4.0

## 17.3.0

### Minor Changes

- aa3f9ba: fix(drivers): a declared field written as an explicit `undefined` is indistinguishable from one never written (#9276)
  
  A row has exactly two states to say about a field, each with a defined meaning:
  **the key is absent** ("no value was ever written") or **the key holds a
  value**. An own key holding `undefined` is neither. Only a JS-backed driver can
  emit it — a SQL NULL arrives as `null`, which is a value — and every consumer
  downstream had to invent a reading of it. Measured on `origin/main`, they did
  not agree: `has(record.f)` on the real `@objectstack/formula` CEL engine reads
  it as ABSENT, `materializeDeclaredFields` reads it as ABSENT by documented
  design, and a bare `f in row` reads it as PRESENT.
  
  Both JS-backed drivers were measured separately, and they did **not** match:
  
  - **`driver-memory`** preserved the own key holding `undefined` through
    `create` and handed it back from `find`. Its own projection path and its own
    matcher already read the shape as absent (`projectFields` skips `undefined`
    values, `{f: {$exists: true}}` excluded it, `{f: {$null: true}}` included it)
    — so the returned row was the only surface in the driver still claiming the
    key was present, and the same stored row answered `'f' in row` differently
    depending on whether a projection was requested.
  - **`driver-mongodb`** SPLIT. `create()` returns the object it built in
    process, so the field came back as an own key holding `undefined`; but the
    MongoClient default is `ignoreUndefined: false` and this driver sets no
    override, so BSON stored `null` for that same field and a subsequent `find()`
    answered `null` — a value. One write, two answers, from one driver.
  
  Both drivers now drop own keys holding `undefined` on the way into storage, so
  a declared field written as `undefined` and one never written are the same row:
  deep-equal, same own keys, same answer to every presence test. `null` is
  untouched and stays a value.
  
  Fixed at the producer rather than at each consumer: converging one consumer
  resolves one seam, but the next consumer that reasons about key presence
  re-acquires the problem.
  
  **Behaviour that changes, precisely.** What these two packages RETURN for one
  input class, and what `driver-mongodb` STORES for it. A caller passing an
  explicitly-`undefined` property to `create`/`bulkCreate`/`update`/`updateMany`
  (or seeding `initialData`) no longer sees that key in the returned row, and no
  `null` is written for it in MongoDB. `undefined` does not survive JSON, so this
  shape cannot arrive over the wire — reaching it requires in-process code.
  
  **What does NOT change.** No accept set moves: no schema, refine, validator or
  public type is touched, nothing that parsed before is refused now, and no
  exported name is added, removed or moved. Filter results are unchanged in both
  drivers — measured identical before and after for `$null` / `$exists` /
  equality on `driver-memory`, and on `driver-mongodb` `$null: true` lowers to
  `$eq: null` and `$null: false` to `$ne: null`, which MongoDB matches
  identically against a missing field and a stored `null`.
  
  Scope on `driver-mongodb` is the INSERT doors and the values returned.
  `$set`-shaped patches are deliberately untouched: changing them would answer
  "what does a patch carrying `undefined` mean — clear the field, or leave the
  prior value standing" which is a storage-contract question, not this repair's
  to settle. On `driver-memory` the normalisation is applied POST-merge for the
  same reason — it keeps today's answer (every measured consumer read the merged
  own-key-`undefined` as "absent", and the row now says absent outright) rather
  than silently turning such a patch into a no-op.
- ca3fd4b: fix(drivers): `update()` on a missing id answers `null` on MongoDB and on Turso's remote face
  
  **BREAKING** for TypeScript consumers — a published TYPE-surface narrowing alongside a
  runtime behaviour change, shipped as `minor` under the launch-window convention. Two
  published declared returns move: `MongoDBDriver.update()` and `RemoteTransport.update()`
  (both exported from their package index) now declare
  `Promise<Record<string, unknown> | null>` where they declared
  `Promise<Record<string, unknown>>`. A caller that reads fields off either result —
  `result.id`, `result.title` — no longer compiles until it narrows the `null` arm first.
  The narrowing is delivered by the compiler at every call site, and it is the honest
  declaration: the value that arm carries has always been reachable, it was simply being
  answered with a fabricated record instead.
  
  `IDataDriver.update()` declares `Promise<Record<string, unknown> | null>` — the
  not-found arm landed with the ruling on the contract (`packages/spec` is untouched here),
  and it is the answer `InMemoryDriver`, `SqlDriver`, `SqliteWasmDriver` and `TursoDriver`'s
  local face have always given. Two implementations did not honour it. They **invented a
  record** instead:
  
  - `MongoDBDriver.update()` ran `updateOne({ id })`, then `findOne({ id })`, and
    when nothing came back returned
    `withoutUndefinedOwnKeys({ id: String(id), ...updateData })` — a row assembled
    from the caller's own payload plus the `updated_at` it had just stamped, under
    an id that names no document.
  - `RemoteTransport.update()` ran `UPDATE … WHERE "id" = ?`, then
    `SELECT * … WHERE "id" = ?`, and when no row came back returned
    `{ id, ...data }` — the caller's payload with the id stapled on.
  
  Both now return `null`. That is the runtime half of this change, and it is why this
  release is not a pure type-surface move: the value a caller receives for a missing id is
  different at run time, not only in the `.d.ts`.
  
  This is the expensive direction of wrong, not merely the wrong answer: the
  fabricated row said **succeeded** where the truth was **not found**, and said it
  in a shape carrying the caller's own fields back, so nothing about it looked
  wrong. Through the engine's by-id door a REST / SDK / MCP `update` against a
  deleted or mistyped id answered **200 with a record that does not exist** — on
  these two implementations only. A caller, human or agent, read that as a landed
  write and did not retry, alert or roll back.
  
  Two things downstream become correct rather than merely different:
  
  - **One `TursoDriver`, one answer.** Its remote branch passes the transport
    result through `formatRemoteRow`, which already guards
    `row && typeof row === 'object'`, so `null` reaches the engine untouched and
    the two faces converge with no edit at that seam. Previously the same driver
    answered the same missing id two ways, chosen by `isRemote`.
  - **`RemoteTransport.bulkUpdate()`'s skip stops being dead code.**
    `if (updated) results.push(updated)` is the cross-driver convention
    `SqlDriver.bulkUpdate` follows; on this transport `updated` could never be
    falsy, so a batch over N missing ids answered N invented rows. It now answers
    the rows that exist.
  
  `upsert()` is untouched on both drivers: an upsert never answers "not found".
  
  No landed test pinned the fabricating posture on either driver, so the
  regression pins added here are net-new coverage rather than a changed baseline.
  
  <!-- adr-0087: not-required (no-migration-prescription) No metadata key is removed, renamed or re-shaped: the moving surfaces are two driver methods' declared return types and the value they answer for an id that names no row, so there is nothing for `objectstack migrate meta`, `spec-changes.json` or the upgrade guide to project, and this changeset prescribes no rewrite. The consumer obligation is a TypeScript narrowing at the call site, delivered by the compiler. `type-surface-only` is NOT claimable here: its predicate 4 (narrowed-from-erased) is false — neither declared return was `any` at the merge base, they were the non-null `Promise<Record<string, unknown>>` — and, independently, runtime behaviour moves in the same diff, which is more than a type surface. Same disposition and reasoning as `.changeset/driver-memory-update-upsert-honest-types.md` (PR #14434), one day earlier in this same series. -->
- 9dac1ae: fix(drivers): `$exists` means HAS A VALUE on the live mingo path, the analytics face and `translateFilter` (#13195)
  
  The platform's settled semantic is that `$exists` means "the field has a value"
  (`!= null`), never key-presence — #5298 leg ③ / #5369, landed in PR #5962. Three
  exits still read key-presence; the maintainer ruled on 2026-08-30 that all three
  align. They now do:
  
  - `driver-memory`'s **live mingo query path** (`InMemoryDriver.find()`) — the
    operator went to mingo under its own name, and mingo tests key presence;
  - `driver-memory`'s **analytics execution face** — it built its own
    `{$exists: <bool>}`, so it inherited key-presence independently;
  - `driver-mongodb`'s **`translateFilter`** — it passed the operator through, and
    MongoDB's `$exists` is key-presence at the wire level.
  
  Nothing was invented. All three lower to `{$ne: null}` / `{$eq: null}` — the
  spelling the same files already emit for `$null` — which answers has-value on
  **both** readings of "no value": a stored `null` and an absent key.
  
  **Grading, argued from what was measured rather than from custom.** This is
  `minor`, not `patch`, and the sibling card #13166 is why the distinction is
  worth stating: that one graded `patch` on the explicit ground that
  `InMemoryDriver.find()` was unaffected and only the non-exported reference
  matcher moved. Here the opposite is true — the live query path callers actually
  reach changes on **two published drivers**, on a filter operator in the public
  Filter Protocol. Measured on a 3-row fixture where one row stores `name: null`:
  
  | filter | before | after |
  |:--|:--|:--|
  | `{name: {$exists: true}}` | `['1','2','3']` | `['1','2']` |
  | `{name: {$exists: false}}` | `[]` | `['3']` |
  | `{$not: {name: {$exists: true}}}` | `[]` | `['3']` |
  
  The middle row is the harm the ruling's record calls the hardest live one: a
  caller asking for the rows with **no value** got an empty result — silent
  absence, with nothing to narrow — on three of the four exits. A caller who was
  getting nothing starts getting rows, which is a behaviour change however welcome
  it is.
  
  The **key-absent** reading is unchanged on every exit, by construction and by
  test: `{$ne: null}` already answers has-value there, so the column that agreed
  with the ruling before still agrees. It is kept in the suites as the control
  that the alignment moved only what it was meant to.
  
  **One thing the ruled lowering needed that the ruling did not name.** `{$ne:
  null}` / `{$eq: null}` reuse keys an author can write on the same field, so
  `{name: {$exists: true, $ne: 'b'}}` would assign `$ne` twice into one object and
  one of the two constraints would vanish — with *which* one decided by the
  author's key order. Measured unguarded: that filter answered `['1','3']` and its
  key-swapped twin answered `['1','2']`, where the reference matcher says `['1']`
  for both. Four composed cells that agreed with the reference matcher on `main`
  would have started disagreeing. So a lowered `$exists` whose key is already
  taken is promoted to its own `$and` branch instead of merged; a free key still
  merges inline. Both key orders now emit one document, and every composed cell
  measured agrees with the reference matcher — including two that did **not**
  agree before this change.
  
  ⛔ Not included, deliberately: no `FILTER_LOGIC_CASES` enrolment and no
  `packages/spec` edit (the backends had to move first — that is the card's own
  step 4, and it is the next card), and nothing retires or discourages `$exists`
  in favour of `$null`. Whether one predicate should keep two authorable spellings
  is the consumer census, #13492.
- eaba72e: feat(driver-mongodb): index `lookup` joins off the canonical `reference` key (#13222)
  
  `syncCollectionSchema`'s field-level join-index arm gated on `field.reference_to`.
  That is a REJECTED ALIAS — `FieldSchema` answers `unrecognized_keys` for it on any
  field type — and this driver's own schema door refuses it outright. So the arm's
  `lookup` conjunct could not be satisfied by any input at all, and no authored
  lookup had ever been indexed on MongoDB. The arm now reads `reference`, the only
  relationship spelling the spec declares.
  
  Measured as a complete case split over the key's value domain rather than a
  sample: every `reference_to` value except `undefined` is refused at the door, and
  `undefined` is falsy, so the old conjunct was unreachable for every possible
  input. The `user` disjunct was unaffected and is why the feature looked healthy —
  it needs no relationship key, so `idx_owner_lookup`-shaped indexes were always
  created.
  
  The refusal door itself is unchanged: predicate, `VALIDATION_ERROR`/400 envelope,
  placement and instruction are all as they were. Only the tail of its message
  moved, because it told the reader that renaming the key would not by itself get
  the field an index — true when written, false now.
  
  A `lookup` that declares no `reference` is still not indexed. Measured on
  `FieldSchema`: `{ type: 'lookup' }` and `{ type: 'lookup', reference: '' }` both
  parse successfully — the spec's prose calls `reference` required for these types
  but the schema does not enforce it — so this is a real authorable shape, and an
  index for a join with no declared target would cost every write and buy no read.
  `master_detail` and `tree` are unchanged: they reach this arm on neither spelling.
  
  ## ⚠️ OPERATORS — this changes boot behaviour on existing deployments
  
  **What it costs.** The first `syncSchema` after this upgrade CREATES these
  indexes on collections that already hold data. Each one is an awaited
  `createIndex`: a full collection scan plus an external sort of the extracted
  keys, followed by permanent index storage and a small write amplification on
  every subsequent insert/update of the indexed field. ("Awaited" describes the
  driver, not the server — see the build-feature note below for what the server
  does during it.) Later boots are free —
  `createIndex` is idempotent for an index that already exists, and this driver
  already relies on that.
  
  ⚠️ **The builds are SERIALIZED, so the times ADD.** `syncCollectionSchema` awaits
  `createIndex` once per index in a sequential loop, and `syncSchemasBatch` awaits
  `syncSchema` once per object the same way. Startup is extended by the SUM of
  every build, not by the slowest one. This is the figure to plan the maintenance
  window around.
  
  **How much.** Measured on this tree: **65 lookup fields carrying `reference`
  across the 52 exported platform objects** — every one gains an index, and this is
  the floor, not the total. Add the objects of any enabled plugin (`plugin-security`
  14 lookup fields, `plugin-approvals` 13, `plugin-audit` 6, `plugin-sharing` 4) and
  one index per lookup field on your own authored objects.
  
  Per index, as an order-of-magnitude planning figure and **not** a benchmark — get
  your own numbers before sizing a window, because they depend entirely on document
  count, storage and cache:
  
  | collection size | build time, one index | index storage added |
  |---|---|---|
  | empty / a few thousand docs | effectively instant (metadata-only) | negligible |
  | ~1M docs | seconds | tens of MB |
  | ~10M docs | ~a minute | hundreds of MB |
  | ~100M docs | tens of minutes | a few GB |
  
  Most `sys_*` collections are small and will finish instantly. Budget for the ones
  that accumulate: `sys_metadata_history`, `sys_metadata_audit`, `sys_notification`,
  `sys_email`, `sys_session`, and any audit-log object. Count them first
  (`db.<collection>.estimatedDocumentCount()`) and multiply by the lookup fields
  each carries; watch a live boot with `db.currentOp()`.
  
  **Build feature — hybrid builds, unconditionally.** `@objectstack/driver-mongodb`
  depends on `mongodb@^7.5.0`, whose own compatibility statement is "the driver
  currently supports 4.2+ servers". MongoDB 4.2 is exactly the release that made
  index builds hybrid, so **every server version this driver can connect to builds
  these indexes with the hybrid builder**: an exclusive lock is taken only briefly
  at the start and end of each build, and the collection accepts reads AND writes
  throughout the rest of it. This is not a full write stall. Two caveats that
  remain: the brief exclusive lock at each end is real, and on a replica set the
  build runs on every member.
  
  **To take the cost outside the boot window,** create the indexes ahead of the
  upgrade, with the names and specs the driver uses — `{ name: 'idx_FIELD_lookup' }`
  over `{ FIELD: 1 }`, no `unique` and no `sparse`. The driver's `createIndex` is
  then a no-op and startup is unaffected. Matching the options matters: a
  pre-existing index of the same name with different options raises
  `IndexOptionsConflict`, which this driver deliberately swallows and skips, leaving
  your index in place unchanged.
- 602d4a0: fix(driver-mongodb): refuse the rejected alias `reference_to` at the schema door instead of honouring it (#13222)
  
  `syncCollectionSchema` gated its field-level join index on `field.reference_to`.
  `reference` is the only relationship spelling `@objectstack/spec` declares —
  `reference_to` is a **rejected alias**, answered by `FieldSchema` with
  `unrecognized_keys` and *"Did you mean `reference_to` → `reference`?"* — so one
  key had two doors with opposite answers, and the silent one was the one that
  touched the database.
  
  A field still carrying `reference_to` when it reaches schema sync now throws
  `VALIDATION_ERROR`/400 naming it as a rejected alias of `reference`, in the same
  words `FieldSchema` uses. The refusal is stated ahead of `createCollection` and
  ahead of every per-field branch, because the spec's verdict is gated on neither
  the field's type nor the key's value: `{ type: 'text', reference_to: 'x' }` is
  refused exactly as the `lookup` fixture is, and `'company'`, `null` and `''`
  alike. One key, one answer, on both doors — this is the same door
  `@objectstack/driver-sql` grew in #11567.
  
  **⚠️ Upgrade note — this IS a behaviour change for a real, non-zero population,
  which is why it is graded `minor` and not `patch`.** #11567 could grade the SQL
  half `patch` on "no authored deployment could reach the branch". That reasoning
  does **not** transfer here: this package's own published `README.md` taught
  `reference_to`, in a sample calling `driver.syncSchema(...)` **directly** —
  
  ```typescript
  company_id: { type: 'lookup', reference_to: 'company' }   // what the README taught
  ```
  
  — and `syncSchema(object, schema: unknown)` casts and forwards that metadata
  **verbatim**, with no Zod, no normalisation and no key filtering. `README.md` is
  in the package's `files` array, so it shipped to npm at
  `@objectstack/driver-mongodb` **17.2.0 and every earlier version**. A deployment
  that copied that sample boots today and, after this release, is refused at the
  schema-sync door. The affected population is therefore non-zero **by
  construction**, not by speculation — and it is not measurable from inside this
  repo. There is deliberately **no deprecation window**: a warn-and-continue
  release would be a third answer to a key the schema has always refused.
  
  Fix, if you have such metadata — the same rename the schema has always asked for:
  
  | Wrote | Write instead |
  |---|---|
  | `{ type: 'lookup', reference_to: 'company' }` | `{ type: 'lookup', reference: 'company' }` |
  
  The README no longer teaches the key; its remaining mention is prose recording
  that the spelling is refused.
  
  **What this does NOT change.** No index is added, removed or renamed. A `user`
  field still gets `idx_FIELD_lookup`; a canonically-spelled `reference` lookup
  still gets none. Renaming the key therefore does not, by itself, produce a join
  index — whether it should is a separate open question, because starting to build
  that index changes boot behaviour for deployments already holding large
  collections. It is tracked apart from this release on purpose.

### Patch Changes

- f6fa22c: `min`/`max` over a **boolean** aggregand now answer the numbers `0`/`1` on every face — maintainer ruling 2026-08-28 (#11152, option A), superseding #11249's `false`/`true`: booleans aggregate as numbers, with no per-aggregate exception, so one flag column's `sum`/`avg`/`min`/`max` all answer in one numeric domain.
  
  FROM → TO, per face: `driver-sql` (every dialect, `driver-sqlite-wasm` included via the shared compiler) no longer re-presents `min`/`max` results over a declared boolean as JSON booleans — `false`/`true` → `0`/`1`; row reads (`find()`) still present booleans, and `min`/`max` over an empty window still answer `null`. `driver-memory` (data and analytics faces) and objectql's in-memory fallback compare booleans as the numbers they are worth — `false`/`true` → `0`/`1`; strings, dates and numbers reach the same comparison they always did. `driver-mongodb` wraps `$min`/`$max` in the same boolean-only `$cond` coercion `$sum`/`$avg` use — `false`/`true` → `0`/`1`; null/missing still pass through, so the empty window still answers `null`. A caller reading `min`/`max` over a boolean column as a JSON boolean should read the number (`0` is false-y, `1` truthy, so boolean coercion at the call site keeps working).
  
  The cross-driver aggregation conformance fixture (`AGGREGATION_ROWS`, `@objectstack/spec/data`) now carries the boolean column those rulings are pinned by: `flag` (3 true / 3 false), with cases for `sum`=3, `avg`=0.5, `min`=0, `max`=1, `count`=6, `count_distinct`=2 and a grouped `min` over the deliberately asymmetric groups — the reach gap #11065 and #11151 were both found through (a boolean aggregand no conformance cell could see) is closed.
- e062370: `driver-mongodb` refuses an aggregate function it does not lower, instead of
  answering it as a silent SUM (#12818).
  
  `buildAccumulator`'s `switch` on `agg.function` ended with
  `default: return { $sum: fieldRef ?? 0 }`, so ANY name this driver does not
  lower — a typo (`median`), a miscased spelling (`COUNT_DISTINCT`), a function
  added to the contract but not to this file, or an unnarrowed `method` arriving
  from `StrategyContext.executeAggregate` (#12776) — was answered as a **sum of
  that column**, under the alias the caller asked for, with no error, no envelope
  and no log. It is the worst available answer precisely because it is
  arithmetically plausible: a dashboard tile renders the number without complaint,
  so nothing downstream can tell "your function ran" from "your function was
  silently replaced". The field-less spelling was quieter still — `{ $sum: 0 }`,
  i.e. `0`, which reads as "no matching rows".
  
  The refusal is the two-class ADR-0112 envelope both SQL faces already answer
  with (#5907), first sentence for first sentence, so one condition cannot have
  two wire identities depending on which backend served it:
  
  - a name the Query Protocol does not declare answers `INVALID_QUERY` / **400**
    and names the declared vocabulary (`@objectstack/spec AggregationFunction`);
  - a DECLARED name this backend does not lower answers `NOT_IMPLEMENTED` / **501**
    and names what it does lower. That class is empty today — every member of
    `AggregationFunction` lowers here — and is pinned as a positive assertion, so
    the day the spec grows a function this driver misses, the suite goes red
    rather than quietly stopping to cover anything.
  
  Judged case-sensitively, which is what the enum is: `COUNT_DISTINCT` is not
  `count_distinct`, and telling its author the backend has a capability gap would
  be false.
  
  **Graded `patch`, deliberately.** No correct query's answer moves: all six
  declared functions and the two retired ones this face still lowers
  (`array_agg` / `string_agg`, an existing divergence from the SQL faces, recorded
  and filed as #13075 rather than closed here) are byte-identically unchanged,
  pinned by controls that compute their values in the same suite. The only inputs
  whose behaviour changes are ones this driver was already answering *wrongly*, so
  there is no working capability being removed — the same shape, in this same
  package, that #10576's per-aggregation-`filter` refusal shipped as a patch.
  
  Nothing to migrate. A caller that was reaching the old `default` arm was reading
  a SUM in place of the function it asked for; the refusal now names the function
  and the remedy.
- df18120: Stop a field operator whose lowering reuses another operator's key from silently clobbering it.
  
  Both document-shaped drivers translated a field constraint by writing every lowered key into one object literal. Several authorable operators do not lower to a key of their own name — `$null` writes `$eq`/`$ne`, `$between` writes `$gte` plus `$lte`/`$lt`, `$lte` on a bare calendar day writes `$lt`, and MongoDB's `$contains`/`$startsWith`/`$endsWith`/`$icontains` all write `$regex` — so two constraints on one field landed on one key and the second assignment won. One constraint disappeared with no error and no trace in the emitted query, and which one disappeared was decided by the author's key order. On a row-level-security read scope, a dropped constraint is a widened one.
  
  A lowered write whose key is free now merges inline as before; a write whose key is already taken becomes its own `$and` branch, where both constraints survive. Which write keeps the inline slot is decided by the spec's declared operator order rather than by the author's key order, so one predicate emits the same query however it is spelled. `driver-memory`'s analytics (cube) face carried a wider form of the same defect — its `$match` was keyed by field path, so a second predicate on a member replaced the first entirely, for every operator pair — and is promoted the same way.
  
  Filters with no contested key are unchanged.
- c4ecf0c: fix(driver-mongodb): a boolean aggregand answers the ruled values (#11151)
  
  `sum` and `avg` over a **boolean** column answered `0` and `null` on this
  driver, where every SQL dialect (#11635), `driver-memory` (#11065) and
  objectql's in-memory fallback already answered `3` and `0.5` over the same
  3-true/3-false rows. The lowering passed the boolean straight to MongoDB's
  `$sum` / `$avg`, which are arithmetic accumulators and ignore every non-numeric
  value: with nothing numeric to fold, `$sum` returns its identity `0` and `$avg`
  returns `null`. Both arms now wrap the aggregand in the boolean-only `$cond`
  coercion #11065 landed, so a rate measure over a flag column reads the same on
  this driver as on the others.
  
  **⛔ `min` / `max` are deliberately NOT coerced.** They are order statistics
  over BSON canonical comparison order, which ranks booleans and returns a member
  of the input domain — #11249 ruled they answer `false` / `true`, and coercing
  them would have answered `0` / `1`, breaking that contract in the opposite
  direction from the defect being fixed. Their lowering is unchanged; a pin reads
  the emitted stages to keep it that way.
  
  **The coercion stays boolean-only.** `null`, a missing key and a non-numeric
  string reach the accumulators exactly as before and stay excluded. Widening to
  the other half of objectql's `toNumber` — which maps a non-numeric string to
  `0` — would average garbage as zero rather than excluding it, a separate
  question this change does not open; a control pins the exclusion.
  
  **Why `patch` and not `minor`.** This changes what an existing operation
  returns, which ordinarily argues for `minor`. It is graded `patch` because the
  returned values were **already ruled** before this change (#11065 for the
  arithmetic pair, #11249 for the order statistics) and are stated as shared
  values in `@objectstack/spec/data`; every other face already produced them, and
  the sibling repair on `driver-memory` shipped as a patch. There is no new API,
  no option, and no opt-out to describe — nothing here is a feature, and the only
  behaviour a consumer could have depended on is a value this project has ruled
  wrong and that no other driver produces. Calling it `minor` would advertise a
  capability that does not exist and imply the old answer had standing.
  
  Not user-visible, and shipped in the same change because the two are one cell:
  `mongodb-pipeline-evaluator.testkit.ts` — the server-free instrument that holds
  this lowering to the shared table — applied its "arithmetic accumulators ignore
  non-numeric values" filter to `$min` / `$max` as well, one arm too far, and so
  answered `null` for them over a boolean column while the lowering under test was
  correct. Those arms now ignore only null and missing, compare by BSON canonical
  order, and refuse a type the evaluator does not rank instead of silently
  answering `null`.
- 2cf35d4: docs(driver-mongodb): stop teaching the spec-refused `reference_to` in the published README, and stop promising a lookup index the driver does not build (#12252 / #13223)
  
  The schema-sync example in this package's README — which ships to npm — declared
  its lookup as `company_id: { type: 'lookup', reference_to: 'company' }` and
  closed with `// Creates: … idx_company_id_lookup`. Both halves were wrong, in
  opposite directions:
  
  - `reference` is the only relationship spelling `@objectstack/spec` declares.
    `reference_to` is a **rejected alias**, answered by `FieldSchema` with
    `unrecognized_keys` and *"Did you mean `reference_to` → `reference`?"* — so
    the sample instructed authors to write a key the platform refuses, in the one
    place a reader is most likely to copy verbatim.
  - The `// Creates:` line promised an index that a *correctly* spelled lookup
    does not get. `syncCollectionSchema`'s lookup arm gates on
    `field.reference_to`, so it cannot fire for a spec-conformant lookup. Fixing
    only the spelling would have left the sample promising an outcome the driver
    had just stopped producing.
  
  The sample now uses `reference`, lists only the three indexes an authored object
  actually gets, and the surrounding prose no longer claims lookup fields index
  themselves — it names the defect and points at #13222, which owns the fix.
  
  **No runtime behaviour changes here.** Whether the lookup arm learns to read
  `reference` — which would index 57 relationship fields across the 44 exported
  platform objects that get no join index today — is #13222's decision, not this
  change's.
- 795d14e: fix(driver-mongodb): refuse the retired `array_agg` / `string_agg` instead of lowering them (#13075)
  
  `buildAccumulator` still carried `case 'array_agg'` and `case 'string_agg'`
  arms — both lowering to `$push` — plus a matching `string_agg` join in
  `postProcessAggregation`. Both names left `AggregationFunction` at **#6188**
  under ADR-0049 enforce-or-remove, and both SQL faces have refused them as
  class-1 undeclared names ever since (`driver-sql`'s `refuseAggregateFunction`,
  `driver-turso`'s `RemoteTransport`, each `INVALID_QUERY` / **400**).
  `driver-mongodb` was the only face still answering them, so **one query got a
  400 on two backends and a `$push` array on the third** — the local/remote fork
  #5907 exists to prevent, one vocabulary later.
  
  Why this face kept them when `objectql`'s in-memory fallback deleted its arms
  for the same two names at #6188: that fallback switches on the **enum type**, so
  `case 'array_agg'` there stopped type-checking the moment the value left the
  enum. `AggregationInput.function` here is a bare `string` — the driver's own
  `aggregate` reads aggregations through an `any` cast — so these arms compiled
  fine and survived the retirement unnoticed.
  
  Both names now answer `INVALID_QUERY` / **400**, answer-for-answer parity with
  both SQL faces. They are named explicitly rather than left to fall through.
  When this change was written, falling through was not safe at all:
  `buildAccumulator`'s `default` arm answered `{ $sum: … }`, so deleting the arms
  alone would have turned a visibly-wrong ARRAY into an arithmetically PLAUSIBLE
  NUMBER — strictly the worse failure, and exactly the defect #13076 has since
  fixed in that arm (#12818). Naming them was correct whichever order the two
  landed in, and now that #13076 is on `main` the named arm still draws the
  distinction `AggregationFunction`'s own error map draws: a caller who bypassed
  the parse door is told the name was **removed** at #6188, which is a different
  fact from `default`'s "is not a declared aggregate function". Both producers are
  kept for that reason.
  
  The retirement prescription itself is not restated here — it lives once, on the
  enum's error map in `@objectstack/spec`, and a copy in the driver would be a
  second wording of one vocabulary with nothing keeping the two in step.
  
  **Graded `patch`, deliberately.** No correct query's answer moves: all six
  declared functions are byte-identically unchanged, pinned by a positive control
  in the same suite that walks `AggregationFunction.options`. `AggregationNodeSchema`
  already rejects both spellings at the parse door, so the only callers whose
  behaviour changes are ones reaching the exported builder or the driver's
  `aggregate` directly — and they were reading a value the protocol has no name
  for. Nothing to migrate: read the rows with an ordinary `fields` query and shape
  them in the caller, or model the roll-up as a stored field.
- Updated dependencies [809d417]
- Updated dependencies [387e231]
- Updated dependencies [f794e4e]
- Updated dependencies [cae2169]
- Updated dependencies [b812a54]
- Updated dependencies [2d4fa75]
- Updated dependencies [0e4e51b]
- Updated dependencies [e84bbf6]
- Updated dependencies [effae80]
- Updated dependencies [efb3513]
- Updated dependencies [d62f990]
- Updated dependencies [c45d8e6]
- Updated dependencies [2e3e8c7]
- Updated dependencies [e621291]
- Updated dependencies [655b106]
- Updated dependencies [40a93b5]
- Updated dependencies [101ad2c]
- Updated dependencies [d5b330d]
- Updated dependencies [dda969c]
- Updated dependencies [1f45690]
- Updated dependencies [277948f]
- Updated dependencies [8bdd955]
- Updated dependencies [f3bbbef]
- Updated dependencies [4f24e9d]
- Updated dependencies [e27583e]
- Updated dependencies [4bd6faa]
- Updated dependencies [86cbe37]
- Updated dependencies [6a180e4]
- Updated dependencies [474242f]
- Updated dependencies [63cd487]
- Updated dependencies [bd4aa4e]
- Updated dependencies [803eaab]
- Updated dependencies [f8e8f03]
- Updated dependencies [983edf1]
- Updated dependencies [eae824e]
- Updated dependencies [f6fa22c]
- Updated dependencies [8a483b3]
- Updated dependencies [97bcd99]
- Updated dependencies [df59de0]
- Updated dependencies [96e25a8]
- Updated dependencies [f75a38a]
- Updated dependencies [7a25e7d]
- Updated dependencies [1fa05a6]
- Updated dependencies [c85a265]
- Updated dependencies [dcb10a5]
- Updated dependencies [773a999]
- Updated dependencies [35dffea]
- Updated dependencies [d8024f0]
- Updated dependencies [8120808]
- Updated dependencies [776a098]
- Updated dependencies [5060877]
- Updated dependencies [4f6325d]
- Updated dependencies [52954c0]
- Updated dependencies [2aa8456]
- Updated dependencies [93809a3]
- Updated dependencies [7c0d0c3]
- Updated dependencies [daae7aa]
- Updated dependencies [8dc22d6]
- Updated dependencies [279431e]
- Updated dependencies [948dd6b]
- Updated dependencies [3b4c56c]
- Updated dependencies [ae8edd2]
- Updated dependencies [e25403c]
- Updated dependencies [a81aa9d]
- Updated dependencies [64baa68]
- Updated dependencies [9fa70d7]
- Updated dependencies [09db64a]
- Updated dependencies [92916e7]
- Updated dependencies [a84f3ea]
- Updated dependencies [f2eaae8]
- Updated dependencies [56c093c]
- Updated dependencies [c09451b]
- Updated dependencies [ba64877]
- Updated dependencies [7345308]
- Updated dependencies [79b6a22]
- Updated dependencies [30d96ab]
- Updated dependencies [f658793]
- Updated dependencies [c95ad19]
- Updated dependencies [e58ea8b]
- Updated dependencies [4a17645]
- Updated dependencies [3795c5f]
- Updated dependencies [8ab926b]
- Updated dependencies [7317cf2]
- Updated dependencies [e25e839]
- Updated dependencies [5997207]
- Updated dependencies [8b13cc8]
- Updated dependencies [4a4a35d]
- Updated dependencies [86e765a]
- Updated dependencies [1d7e76a]
- Updated dependencies [53dc739]
- Updated dependencies [fd289be]
- Updated dependencies [03bf7b1]
- Updated dependencies [f90e820]
- Updated dependencies [18d816a]
- Updated dependencies [e8bd715]
- Updated dependencies [b91c351]
- Updated dependencies [a28a3c0]
- Updated dependencies [daeaaf9]
- Updated dependencies [c459da6]
- Updated dependencies [e914733]
- Updated dependencies [f887e52]
- Updated dependencies [881f8d8]
- Updated dependencies [3bfa1e6]
- Updated dependencies [0a8ebf3]
- Updated dependencies [901355c]
- Updated dependencies [34ce8e7]
- Updated dependencies [33681ea]
- Updated dependencies [bfe13c8]
- Updated dependencies [0fb3044]
- Updated dependencies [4635f3e]
- Updated dependencies [fd289be]
- Updated dependencies [ee3595c]
- Updated dependencies [b2eab95]
- Updated dependencies [93940d4]
- Updated dependencies [3a04b01]
- Updated dependencies [45b9051]
- Updated dependencies [b9e9227]
- Updated dependencies [d395692]
- Updated dependencies [5894d30]
- Updated dependencies [a3765f6]
- Updated dependencies [2d5cee3]
- Updated dependencies [e22158f]
- Updated dependencies [7404925]
- Updated dependencies [0c2334f]
- Updated dependencies [778c59f]
- Updated dependencies [d2619fd]
- Updated dependencies [af56546]
- Updated dependencies [6acb11a]
- Updated dependencies [33c5fd3]
- Updated dependencies [20b0fdb]
- Updated dependencies [905019b]
- Updated dependencies [a286411]
- Updated dependencies [98c0d33]
- Updated dependencies [368a82e]
- Updated dependencies [a3d5724]
- Updated dependencies [93ea19b]
- Updated dependencies [9ee2dcf]
- Updated dependencies [8cb96ec]
- Updated dependencies [8f10a79]
- Updated dependencies [6269a55]
- Updated dependencies [a17da05]
- Updated dependencies [a8c00e2]
- Updated dependencies [22e5236]
- Updated dependencies [0fb8760]
- Updated dependencies [e5ce2ed]
- Updated dependencies [be21955]
- Updated dependencies [bc56e18]
- Updated dependencies [be21955]
- Updated dependencies [a9ee989]
- Updated dependencies [4d0d944]
- Updated dependencies [15d58db]
- Updated dependencies [d63b014]
- Updated dependencies [9abe4e4]
- Updated dependencies [2cc7122]
- Updated dependencies [50d6c92]
- Updated dependencies [9e0ba21]
- Updated dependencies [311433f]
- Updated dependencies [3e5ad08]
- Updated dependencies [9abe4e4]
- Updated dependencies [b7131f3]
- Updated dependencies [e5812fa]
- Updated dependencies [7085f90]
- Updated dependencies [dee4dd4]
- Updated dependencies [ce7e497]
- Updated dependencies [51ecb2f]
- Updated dependencies [9086761]
- Updated dependencies [42a117b]
- Updated dependencies [1401ae7]
- Updated dependencies [4297fe7]
- Updated dependencies [e398863]
- Updated dependencies [d16df74]
- Updated dependencies [f11fc61]
- Updated dependencies [e808890]
- Updated dependencies [8f79379]
- Updated dependencies [e6ca40e]
- Updated dependencies [0c77ea4]
- Updated dependencies [52954c0]
- Updated dependencies [89eb997]
- Updated dependencies [7131f12]
- Updated dependencies [aa5994e]
- Updated dependencies [be93457]
- Updated dependencies [a65db76]
- Updated dependencies [2cf5a96]
- Updated dependencies [15eb2c9]
- Updated dependencies [5691b07]
- Updated dependencies [2a6122b]
- Updated dependencies [225e769]
- Updated dependencies [8af88dd]
- Updated dependencies [fb5fbb8]
- Updated dependencies [d7b3963]
- Updated dependencies [33184fd]
- Updated dependencies [7c41693]
- Updated dependencies [b72db01]
- Updated dependencies [dce5cd4]
- Updated dependencies [9688f58]
- Updated dependencies [556ebc1]
- Updated dependencies [177ebdc]
- Updated dependencies [8d237b4]
- Updated dependencies [2d2e6f0]
- Updated dependencies [2d8dd8d]
- Updated dependencies [22d573e]
- Updated dependencies [b5a2398]
- Updated dependencies [348860c]
- Updated dependencies [5383fa6]
- Updated dependencies [5b3ff63]
- Updated dependencies [1a6a19c]
- Updated dependencies [527e050]
- Updated dependencies [dd33bf9]
- Updated dependencies [4cb2a90]
- Updated dependencies [74a7804]
- Updated dependencies [53d3689]
- Updated dependencies [b3a63d3]
- Updated dependencies [49f0dcf]
- Updated dependencies [033a34c]
- Updated dependencies [4d25d22]
- Updated dependencies [1ffee51]
- Updated dependencies [5ae4303]
- Updated dependencies [ece4dad]
- Updated dependencies [e9b377e]
- Updated dependencies [146f448]
- Updated dependencies [735f5c7]
- Updated dependencies [a7e18de]
- Updated dependencies [366f895]
- Updated dependencies [dc75ba8]
- Updated dependencies [cce0aa9]
- Updated dependencies [e764507]
- Updated dependencies [cff17af]
- Updated dependencies [39404f3]
- Updated dependencies [ca1965f]
- Updated dependencies [8619f95]
- Updated dependencies [b706af9]
- Updated dependencies [db8c288]
- Updated dependencies [0e5fe7f]
- Updated dependencies [add4360]
- Updated dependencies [fc9ba76]
- Updated dependencies [0f94cc7]
- Updated dependencies [a11c1a5]
- Updated dependencies [71f9cd1]
- Updated dependencies [ee17d86]
- Updated dependencies [cdbd920]
- Updated dependencies [18c432e]
- Updated dependencies [3c418c4]
- Updated dependencies [fa8715a]
- Updated dependencies [a933ed7]
- Updated dependencies [b3ca463]
- Updated dependencies [a933ed7]
- Updated dependencies [0d4a6a8]
- Updated dependencies [518d5e5]
- Updated dependencies [6643ba1]
- Updated dependencies [eeba2ef]
- Updated dependencies [ec4c4d2]
- Updated dependencies [424f73c]
- Updated dependencies [cccbe51]
- Updated dependencies [a8d6b1d]
- Updated dependencies [e4a7695]
- Updated dependencies [87075b1]
- Updated dependencies [fc58a99]
- Updated dependencies [14cfc00]
- Updated dependencies [1c6f7b4]
- Updated dependencies [e854a53]
- Updated dependencies [dfebfc8]
- Updated dependencies [d028b37]
- Updated dependencies [f7b25c5]
- Updated dependencies [122ef38]
- Updated dependencies [4a37870]
- Updated dependencies [428f9b2]
- Updated dependencies [aa7ff56]
- Updated dependencies [c41b42e]
- Updated dependencies [c4db311]
- Updated dependencies [750fff5]
- Updated dependencies [c19035e]
- Updated dependencies [ececf7a]
- Updated dependencies [d173125]
- Updated dependencies [8eeca27]
- Updated dependencies [8425c17]
- Updated dependencies [a5ef1d8]
- Updated dependencies [87ad30c]
- Updated dependencies [772d5de]
- Updated dependencies [ce80ec2]
- Updated dependencies [b372318]
- Updated dependencies [97a2263]
- Updated dependencies [29d0676]
- Updated dependencies [0169d49]
- Updated dependencies [6bd3231]
- Updated dependencies [d2b5ba8]
- Updated dependencies [b799ac5]
- Updated dependencies [8f74307]
- Updated dependencies [d23dc08]
- Updated dependencies [644ad50]
- Updated dependencies [9735662]
- Updated dependencies [4d5b4f8]
- Updated dependencies [0da7cd2]
- Updated dependencies [28a5c3e]
- Updated dependencies [4bc18e5]
  - @objectstack/spec@17.3.0
  - @objectstack/core@17.3.0
  - @objectstack/types@17.3.0

## 17.2.0

### Patch Changes

- 6936d07: `engine.aggregate` honours a per-aggregation `filter` (#10576, the contract
  half of #10413). `AggregationNodeSchema.filter` — declared since #4286 but
  marked experimental and enforced by nothing — is now live with SQL
  `FILTER (WHERE …)` semantics: the predicate narrows the SOURCE rows that one
  aggregation reads while sibling aggregations in the same call keep seeing
  every row of the group, so a measure-scoped filter (`stage: 'closed_won'`)
  can finally reach the engine instead of being silently dropped (the #10413
  wrong-numbers defect on the ObjectQL analytics path). The
  `StrategyContext.executeAggregate` bridge (`@objectstack/spec/contracts`)
  gains the same optional `filter` on its aggregation entries so analytics
  strategies can lower measure filters into it (#10413 phase 2 consumes this
  seam next).
  
  Execution is the correct-first two-tier shape date bucketing and HAVING use:
  the engine lowers filtered aggregations in memory for every driver (unknown
  operators refuse loudly with `INVALID_FILTER`/400 naming the aggregation
  position; a group emptied by its filter answers the ruled empty-group values
  — count/sum 0, avg/min/max null). No driver compiles conditional aggregation
  natively today, so each native aggregate face (driver-sql — inherited by
  driver-sqlite-wasm and Turso local —, the Turso remote transport,
  driver-mongodb's pipeline builder, driver-memory's `performAggregation`)
  refuses a directly-delivered per-aggregation filter with
  `NOT_IMPLEMENTED`/501 instead of silently aggregating the unfiltered rows.
  Aggregations without a `filter` are byte-identically unchanged, including
  their native pushdown path.
- Updated dependencies [6936d07]
- Updated dependencies [59eb04d]
- Updated dependencies [9f05b7d]
- Updated dependencies [3b2af5e]
- Updated dependencies [7d2d112]
- Updated dependencies [5fa0d72]
- Updated dependencies [02b3b07]
- Updated dependencies [46d34ab]
- Updated dependencies [914c413]
- Updated dependencies [55809a0]
- Updated dependencies [ee2ff45]
- Updated dependencies [47cd3ec]
- Updated dependencies [52db1d1]
- Updated dependencies [5649efb]
- Updated dependencies [9d7d2de]
- Updated dependencies [c815c50]
- Updated dependencies [795ea05]
- Updated dependencies [2306a76]
- Updated dependencies [e5ea701]
- Updated dependencies [a40dcc1]
- Updated dependencies [def0d3e]
- Updated dependencies [8d0bb79]
- Updated dependencies [5acb58d]
- Updated dependencies [2e3cf95]
- Updated dependencies [4c93387]
- Updated dependencies [504c8d5]
- Updated dependencies [a037f7c]
- Updated dependencies [3ee8ddf]
- Updated dependencies [16cef97]
- Updated dependencies [a79bd35]
- Updated dependencies [6ceaa4b]
- Updated dependencies [15ea214]
- Updated dependencies [de19489]
- Updated dependencies [c684d00]
- Updated dependencies [923c424]
- Updated dependencies [1ec36b7]
- Updated dependencies [5f2e54c]
- Updated dependencies [189373b]
- Updated dependencies [35ad101]
- Updated dependencies [ceb33a9]
- Updated dependencies [73d9795]
- Updated dependencies [8012960]
- Updated dependencies [f34f56b]
- Updated dependencies [f399618]
- Updated dependencies [75e9301]
- Updated dependencies [2810695]
  - @objectstack/spec@17.2.0
  - @objectstack/core@17.2.0
  - @objectstack/types@17.2.0

## 17.1.0

### Patch Changes

- 7337f30: chore(deps): production-dependency patch bumps from the weekly Dependabot group (#9212)
  
  Routine dependency-range refresh, no behavior change: `@oclif/core` 4.13.2→4.13.3,
  `esbuild` 0.28.1→0.28.2 and `better-sqlite3` ^13.0.2→^13.0.3 (optional) on
  `@objectstack/cli`; `mingo` 7.2.2→7.2.4 on `@objectstack/driver-memory`; `nanoid`
  6.0.0→6.0.1 on `@objectstack/driver-mongodb`, `@objectstack/driver-sql`,
  `@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso`, plus
  `better-sqlite3` ^13.0.2→^13.0.3 (optional on `@objectstack/driver-sql`, peer on
  `@objectstack/driver-turso`); `js-yaml` 5.2.2→5.2.3 on `@objectstack/metadata`;
  `@noble/hashes` 2.2.0→2.3.0 and `jose` 6.2.5→6.2.8 on `@objectstack/plugin-auth`;
  `nodemailer` 9.0.3→9.0.5 on `@objectstack/plugin-email`; `@hono/node-server`
  2.0.12→2.1.1 and `hono` 4.12.34→4.13.2 on `@objectstack/plugin-hono-server`;
  `pinyin-pro` 3.28.2→3.29.1 on `@objectstack/plugin-pinyin-search`; and
  `@noble/ciphers` 2.2.0→2.3.0 on `@objectstack/service-settings`.
  
  Every entry above changed a `dependencies`, `optionalDependencies` or
  `peerDependencies` range in the published manifest — the only kind of change
  that reaches a consumer's install. The same Dependabot group also bumped
  `devDependencies` on `@objectstack/hono`, `@objectstack/client`,
  `@objectstack/core`, `@objectstack/plugin-sharing` and `@objectstack/spec`
  (none consumer-facing), and touched the private `apps/docs`,
  `examples/app-todo` and workspace-root manifests (none published) — none of
  those get an entry here.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0

## 17.0.0

### Major Changes

- c6d1cb4: refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

  `findStream` was a **required** method on the driver contract — every driver and
  every test double had to implement it — documented as the read

  > Optimized for large datasets to avoid memory overflow.

  Three things were true about it at once, and each is worse in the light of the
  others.

  **Nothing called it.** Not the query engine (there is no `stream` entry on it),
  not REST export, not import, not any bulk-read path. Repo-wide, outside the
  contract declaration and the three driver implementations, every single hit was
  a test double — and roughly twenty of those satisfied the required method like
  this:

  ```ts
  findStream() { throw new Error('not implemented'); }
  ```

  Twenty stubs that throw, across four packages, for years, and no test ever went
  red. That is not an anecdote about test hygiene; it is the proof of absence. A
  method whose every double throws is a method nothing reaches.

  **Two of the three implementations inverted its one guarantee.** `SqlDriver` and
  `InMemoryDriver` both did this:

  ```ts
  const results = await this.find(object, query, options); // ← the entire result set
  for (const row of results) yield row;
  ```

  The whole table is resident in memory before the first `yield`. A caller who
  believed the doc comment and reached for `findStream` precisely because a result
  set was too large would have hit the overflow it existed to prevent, at exactly
  the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
  admitting it.

  **The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
  did walk a cursor — but it was the only read in that driver never routed through
  `buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
  discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
  and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
  that divergence rather than fixing it — there is nothing left to fix it for.)

  Rather than manufacture a caller to justify three implementations, the method is
  retired. If a cursor-based read is wanted, it should arrive **with** the caller
  that needs it, so the contract can be shaped by a real requirement instead of
  being reverse-engineered from a doc comment nobody could test.

  **Migration.**

  | Wrote                                                      | Write instead                                              |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
  | `findStream(…) { … }` on your own driver                   | delete the method (see below)                              |
  | `findStream() { throw new Error('ni'); }` in a test double | delete the line                                            |

  Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
  and memory it is strictly better (bounded pages instead of one full
  materialisation), and the paged read is the one with an **enforced** guarantee —
  `IDataDriver.find` requires a total order across the whole walk, checked by the
  shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
  `data/pagination-conformance.ts`. `findStream` never had a conformance case at
  all.

  **Driver authors: nothing breaks on you.** An implementation left in place still
  compiles — an extra method is not an error on a class or a widened object — it is
  simply never reached, so deleting it is cleanup you can do whenever. The break is
  on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
  were no callers.

  **No tombstone, deliberately.** The other v17 retirements tombstone their key so
  authoring it fails loudly with a prescription. That would be noise here.
  `DriverInterfaceSchema` describes a contract that code _implements_; nothing in
  either repository ever ran a driver object through `.parse()`, so a
  `retiredKey()` there would carry its prescription to no one. The channel that can
  carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
  The key is removed from the schema and from `IDataDriver`, and the retirement is
  registered as the `data-driver-find-stream-retired` semantic entry in the
  protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool all carry it. There is no
  `os migrate meta` step: a driver is code, never stack metadata, so the chain has
  no source to rewrite.

  **Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
  whose only referent was this method. It has no readers either (and the values
  written into it were already wrong — `SqlDriver` declared `streaming: false`
  while implementing `findStream`, `InMemoryDriver` declared `true` for the
  copy-everything version), but removing a key from the capabilities literal breaks
  every driver that writes it, third-party included, and the same audit should
  cover the other ~30 flags in one pass rather than one at a time. Tracked as
  #4634.

- d9fa683: refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

  The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
  described a contract method that no longer exists — and a full liveness audit of
  the record (#4634, across objectstack + cloud, objectui confirmed clean) found
  `streaming` was not the exception but the rule. Of 34 declared bits, **three**
  have a decision-making reader and **thirty-one** were written by every driver
  and consulted by no engine, planner, REST layer or renderer:

  - Their `.describe()` strings promised engine adaptation that was never built
    ("If false, ObjectQL will fetch all records and filter in memory" — no such
    fallback ever keyed off the bit).
  - Zero readers let values go WRONG unnoticed: `SqlDriver` declared
    `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
    `streaming: true` over a full-table read — the exact inverse of the guarantee.
  - The real mechanism everywhere else is **method presence**: transactions gate
    on `driver.beginTransaction`, aggregate pushdown on
    `typeof driver.aggregate === 'function'`, schema sync on
    `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
    are called unconditionally.

  Survivors (each with a named reader — the bits method presence cannot carry):

  | bit                    | reader                                                                                   |
  | ---------------------- | ---------------------------------------------------------------------------------------- |
  | `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
  | `autonumber`           | engine defers autonumber generation to the driver (`engine.ts`)                          |
  | `batchSchemaSync`      | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`)              |

  Migration (FROM → TO):

  - Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
    `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
    `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
    `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
    `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
    `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
    `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
    literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
    tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
    error against `IDataDriver.supports` and a parse error carrying the per-key
    prescription, which names the mechanism that actually decides the behaviour.
  - `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
    already meant `false` at both readers, so `supports: {}` is now a valid,
    minimal advertisement. If you read `capabilities.batchSchemaSync` from a
    _parsed_ config and relied on the materialised `false`, treat absence as
    `false` (both engine readers always did).
  - Driver packages: `InMemoryDriver.supports` is now `{}`,
    `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
    is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
    Reading a removed bit off these literals no longer type-checks — and no code
    in any repository did.
  - A future capability (streaming reads, vector search, …) returns **with its
    caller and its reader in the same change** — the enforce route of ADR-0049 —
    never as a dangling boolean.

  The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
  (parse + `tsc` both audible; the schema IS parsed via
  `DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
  semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
  never stack metadata — `supports` lives in driver classes and `DriverConfig`
  is plugin TS configuration, so there is no stored row or stack source for a D2
  conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
  retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
  lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
  asserting every retired bit is unwritable (`undefined`) and every live bit is
  not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
  resurrection).

  No runtime behaviour changes — that impossibility is the point: every removed
  bit had zero readers, and the three live bits keep theirs.

- 262e40d: refactor(drivers)!: memory / mongodb 的 `aggregate` / `distinct` 也收进 `DriverQuery`，契约没覆盖的方法不再要求把对象名写两遍 (#6212 批 C)

  #6210 的 changeset 结尾专门留了一句：`aggregate` / `distinct` **不在**那次范围内，因为它们不是 `IDataDriver` 收窄的那六个方法。#6212 记下了这笔账，本次结清 memory 与 mongodb 这两个包的部分。

  这批方法的第一个实参**已经是对象名**，query 里却仍旧要求再写一遍：

  | 位置                                        | 收窄前                              | 收窄后                                 |
  | :------------------------------------------ | :---------------------------------- | :------------------------------------- |
  | `MongoDBDriver.aggregate`                   | `query: QueryAST`                   | `query: DriverQuery`                   |
  | `InMemoryDriver.distinct`                   | `query?: QueryInput`                | `query?: DriverQuery`                  |
  | `InMemoryDriver.aggregate`                  | `Record<string, any>[] \| QueryAST` | `Record<string, any>[] \| DriverQuery` |
  | `InMemoryDriver.performAggregation`（私有） | `Omit<QueryInput, 'object'>`        | `DriverQuery`                          |

  因为 `QueryAST` / `QueryInput` 都把 `object` 声明成**必填**，一个手上只有 `where` 的调用方根本叫不出这个类型的名字，于是伸手去拿 `as any` —— 连 `where` / `orderBy` / `limit` 的检查一起关掉。这正是 #5181 记过账的那笔代价（cloud#1053 实测 20 处，cloud#1030 的 `$like` 就是从这个口子活到运行时的）。收窄之后调用方可以直接写字面量：

  ```ts
  // 收窄前：object 是必填，这句编译不过，于是 ... as any
  // 收窄后：直接过，且 where / orderBy / aggregations 逐个受检
  await driver.aggregate("order", {
    groupBy: ["region"],
    aggregations: [{ function: "sum", field: "amount", alias: "total" }],
  });
  ```

  同一次改动收回了 4 处已经多余的 `as any`（memory 2、mongodb 2），`check:query-options-erasure` 的测试面因此从 267 降到 263，baseline 已按门禁要求同 PR `--update`。

  **`InMemoryDriver.aggregate` 的联合刻意保留。** 两条分支都有活体生产者：mongo 管线数组那支由 `memory-analytics.ts` 喂，AST 那支由 objectql 引擎与 `@objectstack/verify` 的日期分桶探针喂。退役任何一支都会打断其中一条。

  **顺带把 `#6212` 正文的一处归因证伪了**：正文说 `performAggregation` 当初选 `Omit<QueryInput, 'object'>` 是被 `groupBy` 的元素类型差异逼的。实测 `QueryInput` 与 `QueryAST` 在 `groupBy` 上**逐字相同**，差异只在 `search` / `orderBy` / `expand`；直接换 `DriverQuery` 零报错。所以那不是被迫的选择，契约优先取 `DriverQuery`，不再引入第二个查询类型家族。

  **零运行时改动。** 非测试改动 100% 是类型注解，无逻辑、无行为、无 emit 差异（`as` 断言在编译期即被抹除）。测试全绿：memory 532、mongodb 206（另 137 条需真实 mongod，按既有 opt-in 规则跳过）。这也是 #5499 冻结面上被允许的处置口径 —— 与 #6210 在同一批驱动上走的是同一条。

  **迁移面：删掉调用字面量里的 `object:` 键**，与 #5181 / #6210 同一句话，现在覆盖到 `aggregate` / `distinct`。编译器会逐处指出来：

  ```
  error TS2353: Object literal may only specify known properties,
                and 'object' does not exist in type 'DriverQuery'.
  ```

  本仓实测只有一处需要改（`memory-driver.test.ts` 的 `distinct` 用例），且它写的值与第一实参逐字相等，纯冗余。

  标 major 的依据与 #5181 / #6210 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

- d367f03: refactor(drivers)!: 五个驱动的 query 参数跟进 `DriverQuery`，休眠的类型谎言就此没有藏身处 (#6075)

  #5181（PR #6076）把 `IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的 query 参数收窄为 `DriverQuery`（`Omit<QueryAST, 'object'>`），并在同一条 changeset 里写明：「把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾」。这就是那次收尾。

  在此之前，五个驱动的实现仍旧声明 `query: QueryAST`（turso 侧是 `query: any`）。**它不红，也不会红** —— 方法参数按双变比较，实现声明得比契约宽照样满足契约。但调用方现在**有权**省略 `object`，于是这些实现的类型说 `query.object` 是 `string`，运行期却可能是 `undefined`：一句休眠的谎言，没有任何门拦得住下一个照着它写代码的人。

  收尾之后，「驱动读 `query.object`」直接变成编译错误：

  ```ts
  // 收窄前：编译通过，运行期可能是 undefined —— 谎言
  // 收窄后：error TS2339: Property 'object' does not exist on type 'DriverQuery'.
  const name = query.object;
  ```

  **零运行时改动。** 本次改的全部是类型注解：五个驱动的六个契约方法签名，以及为让类型自洽而必须跟进的少量私有辅助方法参数（mongodb 的 `buildFindOptions` / `buildSortSpec`，sql 的 `findRows` / `orderKeysFor`，turso 的 `toRemoteQuery` / `toRemoteReadQuery`，memory 的 `performAggregation`）—— 它们都只转发或读取 `where` / `orderBy` / `groupBy` 这些字段，本来就不读 `object`。turso 的几处 `query: any` 一并收紧，多拿回一批本已放弃的检查。emit 无差异，测试全绿（memory 524、mongodb 206、sql 906、sqlite-wasm 254、turso 788）。

  **迁移面：删掉驱动调用字面量里的 `object:` 键**，与 #5181 是同一句话，只是现在也覆盖了直接按具体驱动类（`SqlDriver` / `MemoryDriver` / …）而非按 `IDataDriver` 取类型的调用方。编译器会逐处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。本仓下游 25 个包实测零处需要改动，改动只落在五个驱动自己的测试里。

  标 major 的依据与 #5181 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

  `aggregate` / `distinct` / `syncSchemasBatch` 不在本次范围内 —— 它们不是 `IDataDriver` 收窄的那六个方法，其中 `syncSchemasBatch` 的条目里 `object` 是被真实读取的必填键，`expand` 条目里的 `object` 同理命名的是关联对象，都不是冗余。

### Minor Changes

- c7406b0: fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

  `FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
  授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
  钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

  ## 改了什么

  进入运行时的门有两扇,过去只有一扇按契约读:

  | 门                                                                                                | 改前                                                                                                                               | 改后                                                                                            |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | **Door 1** —— 协议/HTTP 面(`metadata-protocol`)                                                   | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER`                                                             | 不变                                                                                            |
  | **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动                                                                                                             | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
  | 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`)            | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400                                              |

  一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
  `RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
  删掉方言后两侧自然合流。

  ## 授权面:零变化

  `FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
  `filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
  这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

  ## ⚠️ 可观察的行为变更

  1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
     声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
  2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
     照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
     `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
     返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
  3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
     变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
  4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
     导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
     注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
     挡住这个输入,所以拒收必须在运行时。
  5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
     (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
     AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

  ## 删除的代码面

  - `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
  - `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
  - `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
  - `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

  `[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。

- 3f8817a: feat(spec,drivers,objectql,analytics,formula): `$icontains` reaches every JS evaluation face (#6520)

  The other half of #5702. That change implemented `$icontains` on the SQL family
  and correctly left the spec's `FILTER_OPERATORS` alone; this one adds the
  operator to that array and gives every remaining evaluation face an arm, in ONE
  change, because those two steps cannot be separated.

  **Why one PR.** `FILTER_OPERATORS` is not a word list, it is a runtime allowlist:
  `driver-memory`'s shape gate derives from it, and its matcher's `default:` arm
  assumes the gate already refused anything unimplemented. Measured on a branch
  that added the name early (#5701): the gate stopped refusing, the matcher fell
  through, and `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned
  `true` — the predicate silently dropped, every row matched. A dropped predicate
  does not narrow a query, it WIDENS it, and on an RLS read scope that is a
  permission bypass rather than a degraded feature (#3948). So the word list
  travels with the evaluators or not at all.

  **What now answers it**, all folding the same domain: `driver-memory` (query
  path, reference matcher, and the analytics/cube face), `driver-mongodb`,
  `objectql`'s `having`, `@objectstack/formula`'s `matchesFilterCondition` (the RLS
  write-side `check`), and `service-analytics`' three SQL compilers (the RLS
  lowering, the native-SQL strategy, and the `/analytics/sql` echo).

  **The fold is ASCII-only, and that is the contract, not an implementation
  detail** (#4706 Q1 = A). `$icontains: 'café'` does not match `CAFÉ`. Every face
  reads one shared definition — `foldAsciiCase` /
  `asciiCaseInsensitiveContains` / `asciiCaseInsensitiveRegexSource`, new exports
  on `@objectstack/spec/data` — because the two obvious per-package spellings are
  both wrong in the same direction: `toLowerCase()` folds the whole Unicode range,
  and so does a `RegExp` built with the `i` flag. SQLite folds ASCII only and three
  of the five drivers are SQLite underneath, so a Unicode fold on a JS face would
  re-open exactly the divergence the ruling closed. The pattern-binding faces
  (mingo, mongo) therefore emit one `[Aa]` character class per ASCII letter and
  pass NO flags; mongo's `$icontains` is the one arm in its family that does not
  set `$options: 'i'`.

  The comparand keeps the rules its SQL twin has: matched LITERALLY (`%`, `_` and
  regex metacharacters are ordinary characters), and refused when empty or
  non-string — an empty comparand matches every row, which is a predicate that
  constrains nothing.

  **User-visible effect.** A filter using `$icontains` now behaves the same on the
  in-memory double and on SQL, so an app whose tests run on one and whose
  production runs the other stops getting two answers from one filter. Downstream,
  #5814 (better-auth `Where.mode: 'insensitive'`) no longer hits a 400 on the
  memory double.

  Not changed, and still tracked: the `$contains` family still folds Unicode on
  `driver-memory`'s query path and `driver-mongodb` (#6682) — both remain DEBT rows
  in `scripts/check-driver-conformance.mjs`, now naming one open requirement each
  instead of two. `formula`'s unknown-operator posture stays a silent, fail-closed
  `false` (it governs a write-side check, where an unevaluable condition denies
  rather than widens); the decision and its limits are documented on
  `matches-filter.ts`, and no operator the spec DECLARES is answered that way any
  more.

- d1557d9: feat(driver-mongodb)!: declare the driver single-tenant and refuse to boot multi-tenant (#3724)

  `MongoDBDriver` implements **no row-level tenant isolation** — it never reads
  `DriverOptions.tenantId`, so reads carry no tenant predicate and writes are not
  stamped with a tenant column. The layer the SQL driver has (`resolveTenantField`

  - `applyTenantScope`) simply does not exist here, while everything above the
    driver — object metadata's `tenancy` block, `applySystemFields` injecting
    `organization_id`, the engine threading `tenantId` into every driver call —
    operates on the assumption that tenant isolation is a platform guarantee. Point
    a multi-tenant deployment's datasource at Mongo and every query read, updated
    and deleted other tenants' documents, silently.

  Rather than serve unisolated, the driver now fails fast at startup:

  - The **constructor** and `connect()` call `assertSingleTenantPosture()`, which
    refuses any tenancy posture other than `single` (`OS_TENANCY_POSTURE=group` /
    `isolated`, including the posture derived from `OS_MULTI_ORG_ENABLED=true`),
    resolved through the shared `resolveTenancyPosture()` so the driver can never
    disagree with auth / the registry / the CLI about the mode. The check sits in
    the constructor because that is the earliest seam — it fails before a host can
    hand the driver anywhere — and `connect()` re-checks in case a host flips the
    posture in between. (It originally had to live in the constructor because
    `ObjectQLEngine.init()` _caught_ a driver's connect rejection and booted
    anyway; that is fixed in the same release, #3741, so both seams abort boot.)
  - `syncSchema()` / `syncSchemasBatch()` call `assertObjectsNotTenantScoped()` and
    refuse objects declaring `tenancy.enabled: true`, naming every offender in one
    message.
  - `objectstack serve` / `dev` (CLI) now re-throw this error out of the
    auto-driver-registration block instead of swallowing it, so boot exits 1 with
    the actionable message — the same treatment `UnsupportedDriverError` already
    gets. Matched duck-typed by `code`, so the CLI takes no dependency on the
    driver package.

  Both throw `MongoDBMultiTenantUnsupportedError` with
  `code === 'MONGODB_MULTI_TENANT_UNSUPPORTED'`, a message that names the detected
  signal, the remedy, and `@objectstack/driver-sql` as the multi-tenant option.

  There is deliberately **no override env var**: an escape hatch would restore
  exactly the silent non-isolation this guard removes. Single-tenant deployments —
  every currently-working Mongo deployment — are unaffected.

  This is option B of #3724. Implementing real row-level isolation (option A)
  remains open; the `unique` index shape stays single-field until then, which is
  now correct by construction rather than by omission.

- 82397b6: feat(drivers,objectql): `$regex` / `$options` are refused everywhere, and `$icontains` is implemented on the SQL family (#5702)

  The driver half of the #4706 ruling. #5701 landed the contract (the vocabulary,
  the `RETIRED_FILTER_OPERATORS` prescriptions, the shared text case-set) and
  #5710 flipped the last live producer — `plugin-auth`'s ObjectQL adapter, which
  emitted `$regex` on the authentication path — so the refusal can now land
  without breaking sign-in.

  **BREAKING for anyone writing `$regex` or `$options` in a filter.** Both are
  refused on every backend with `INVALID_FILTER` / 400 and a message that names
  the replacement. `$regex` was never a declared operator: `driver-sql` compiled
  it to a LIKE-escaped substring (so `a.b` matched only the literal `a.b`),
  `driver-memory` ran it as a real `RegExp` (so the same filter also matched
  `axb`, and an _invalid_ pattern was caught and answered `false` — zero rows, in
  silence), and `objectql`'s `having` did the same. Write `$icontains` for the
  case-insensitive substring search this was almost always used for, `$contains`
  for a case-sensitive one; a pattern that genuinely needs a regex has no
  filter-level replacement.

  **`$icontains` now runs on the SQL family** — `driver-sql`, `driver-sqlite-wasm`,
  and both of `driver-turso`'s transports (the remote one does not go through
  knex, so it needed its own). It compiles to `LOWER(col) LIKE LOWER(?) ESCAPE ?`
  through the same `applyLike` / `pushLike` that carries the `%` / `_` / `\`
  escaping, as a `fold` parameter rather than a second emitter — a copied emitter
  is where the escape class would have been dropped, and an unescaped `%` matches
  every row. An empty or non-string comparand is refused on the validating walk
  (an empty one matches every row, which widens rather than narrows). On SQLite
  `lower()` folds ASCII only, which IS the contract (#4706 Q1 = A): `$icontains:
'café'` does not match `CAFÉ`.

  <!-- adr-0087: registered filter-regex-options-retired -->

  `driver-mongodb`'s unknown-operator arm was throwing a bare `Error` with no
  `code` and no `status`, three lines from the helper in its own file that sets
  `INVALID_FILTER` / 400 — a 500-shaped body for a 400-class client mistake. It
  now speaks the same envelope as its three siblings.

  Two parts of the ruling are deliberately NOT in this change and stay tracked in
  `scripts/check-driver-conformance.mjs`'s ledger: the `$contains` family's
  case-sensitivity (#4706 Q2 = A) needs SQLite's `LIKE` replaced by a case-exact
  construct in the driver, the RLS lowering and the analytics lowering together,
  or one permission rule compiles to two row sets (#6518); and `$icontains` on the
  JS evaluation faces needs the spec vocabulary to take the operator, which cannot
  happen before `driver-memory` has an arm for it (#6520).

- b90086a: fix(driver-sql)!: `unique` materializes per tenant, ending its contradiction with the per-tenant autonumber sequence (#3696)

  `unique: true` became a **single-column global index that ignored `tenancy`
  entirely**, while the autonumber sequence table is keyed by
  `(object, tenant_id, field, scope)` and hands every tenant its own counter
  starting at 1. Two subsystems of the same platform contradicted each other:
  tenant B's `PROD-00001` was rejected by an index it could not see — **no user
  did anything wrong**, the platform's left hand refused what its right hand
  issued.

  The rejection also doubled as a **cross-tenant existence oracle**: a UNIQUE
  violation told tenant B that some _other_ tenant held the value, enumerable by
  probing emails / codes / names.

  **The contract now:**

  | Declaration                      | Materializes as                                                 |
  | -------------------------------- | --------------------------------------------------------------- |
  | `unique: true` + tenant column   | composite `(tenantField, field)` — unique **within** the tenant |
  | `unique: true`, no tenant column | single-column — single-tenant DDL is byte-identical to before   |
  | `unique: 'global'`               | single-column, always platform-wide                             |

  The tenant column comes first in the composite, so the index also serves the
  `WHERE tenant = ?` prefix scans every tenant-scoped read issues.

  **Declared `indexes[]` are deliberately unchanged.** They are materialized over
  exactly the columns listed — no tenant column is injected. The author already
  spells them out, per-tenant ones have always been written explicitly
  (`fields: ['organization_id', 'code']`), and many are legitimately platform-wide
  (a DNS hostname, a reserved slug, an external provider id). `'global'` is
  accepted there as a synonym of `true` so one vocabulary covers both spellings.

  **Migration is automatic and cannot fail.** Legacy indexes
  (`<table>_<col>_unique` from knex, `uniq_<table>_<col>` from the drift-rebuild
  path) are retired inline at schema-sync time. The old global constraint is
  strictly stronger than the new per-tenant one, so existing rows satisfy the
  replacement by construction — no dedup, no cleanup, no data touched. It
  converges at sync rather than waiting for a deliberate `os migrate` run because
  a deployment that never ran migrate would otherwise stay broken.

  **Upgrading — audit your `unique: true` fields.** On a tenant-scoped object the
  constraint is now per tenant. Anything that must stay platform-wide has to say
  so:

  ```ts
  hostname: Field.text({ unique: "global" }); // no two tenants may claim it
  ```

  Note the reach: `applySystemFields` injects `organization_id` into every
  registered object unless it opts out, and the driver falls back to that column
  when no `tenancy.tenantField` is declared — so most objects are tenant-scoped.
  Typical candidates for `'global'`: DNS hostnames, reserved slugs, external
  provider ids (Stripe customer/subscription), device identities.

  Postgres materializes `col.unique()` as a table CONSTRAINT rather than a bare
  index, so the retirement tries `DROP CONSTRAINT` before `DROP INDEX` —
  `DROP INDEX` alone would have made the migration a no-op on exactly the
  deployments that matter most.

  `@objectstack/driver-mongodb` accepts the new declaration but keeps single-field
  indexes: it implements no row-level tenancy at all (no tenant predicate on read,
  no tenant stamp on write), so a `(tenant, field)` index would advertise an
  isolation it does not deliver. Tracked separately.

### Patch Changes

- b3a2318: fix(driver-memory,driver-mongodb): a bare-day upper bound covers the whole day (#4042)

  The non-SQL half of #3777's calendar-day rule. Both drivers compiled a bare
  `YYYY-MM-DD` `$lte` (and a `between` max) as-is, so on timestamp values the
  window cut off at the final day's midnight — the dashboard date-range filter's
  default configuration (`created_at`, 7 of 13 presets ending "today") lost the
  current day, exactly as it did on SQL before #3777 was fixed.

  Both drivers now compile a bare-day upper bound half-open, sharing
  `nextUtcCalendarDay` from `@objectstack/core`:

  - `driver-memory`: the Mongo-style and array `where` spellings in the mingo
    lowering (`$lte`/`<=` → `$lt` next day; `$between`/`between` max the same),
    the analytics cube-filter `lte`, and the analytics `dateRange` window — which
    now also matches BOTH stored forms of a timestamp (ISO strings and `Date`
    objects) instead of only `Date`s, since mingo compares cross-type as
    never-equal.
  - `driver-mongodb`: the `translateFilter` lowering, all three spellings
    (`$lte`, `$between`, array `<=`/`lte`).

  Unchanged on purpose, matching the #3777 semantics table: full-ISO/`Date`
  comparands keep instant semantics, and `$gte`/`$gt`/`$lt` keep their midnight
  anchoring. Known remaining gap (tracked separately): values stored as BSON
  `Date` (mongodb) or JS `Date` (memory `find()`) never match _string_ comparands
  of any operator — a storage-form problem, not a bound-semantics one.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 9e8f04d: fix(driver-memory,driver-mongodb): `Field.datetime` has one storage form per driver (#4047)

  The non-SQL counterpart of ADR-0053 D-B (#3912). Both drivers let the writer
  decide a datetime value's runtime type, and both compare across types by type
  bracket rather than by value — so a string comparand never matched a `Date`
  value, in either direction, for **every** operator including `$gte`.

  A datetime column genuinely held both forms: the drivers' own
  `created_at`/`updated_at` defaults bind a `Date` (mongo) or an ISO string
  (memory), while REST/JSON writes, relative-date tokens and `initialData`
  fixtures supply the other. A dashboard date window therefore answered with
  whichever half happened to match the comparand's type — on MongoDB, where
  `created_at` is a BSON `Date` and dashboard bounds are strings, that meant
  **no rows at all**, which is worse than the final-day loss #3777 fixed.

  Each driver now has one canonical form, applied on write and to every filter
  comparand:

  | Driver           | `datetime`                                                                                                           | `date`            |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
  | `driver-mongodb` | BSON `Date` — the dialect's native instant, its `timestamptz`                                                        | `YYYY-MM-DD` text |
  | `driver-memory`  | canonical UTC ISO text (sorts chronologically under the string comparison mingo performs; survives JSON persistence) | `YYYY-MM-DD` text |

  Both learn their temporal fields from `syncSchema`, so an object that was never
  declared is left exactly as written — the drivers do not guess types from
  values. `driver-memory` additionally converges rows already in the table when
  the schema arrives, which catches `initialData` fixtures and anything a
  persistence adapter restored (the in-memory analogue of
  `backfillCanonicalDatetimes`, and idempotent like it).

  `Field.date` deliberately stays timezone-naive text on both — converting it to
  an instant would invent a midnight and re-couple it to a zone. The
  calendar-day bound semantics from #3777/#4042 are unchanged and now compose
  with the converged storage: the whole-day rewrite runs on the calendar string
  first, and only the resulting bound is converted to the storage form.

- 06ba036: feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

  `TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
  `objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
  公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
  的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
  `fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
  在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

  **新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
  带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
  `RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
  驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
  不要凭据（remote 面走包内的 sqlite stub）。

  **留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
  `vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
  `MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
  一部分，只是曾经同包而已。

  **目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
  `driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
  `knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
  `repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

  这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
  迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
  filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
  `LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
  补齐工作跟踪在 #5590。

- e59786e: fix(spec): five exported symbols resolved to `any` — type the recursive schemas and gate it in CI (#4171)

  A recursive Zod schema needs an explicit annotation to break its circular
  inference, and five of them took the cheapest one available:

  ```ts
  export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => …);
  export type NavigationItem = z.infer<typeof NavigationItemSchema>;   // → any
  ```

  It compiles, it validates correctly at runtime, and it silently throws the type
  away. `NavigationItem`, `FormField`, `JoinNode` and `NormalizedFilter` were all
  `any` on the published surface, plus `FieldNodeSchema` — which had no exported
  type alias yet, so `z.infer<typeof FieldNodeSchema>` was `any` and
  `QueryAST['fields']` with it.

  That is worse than a missing export. #4115 tells every consumer that a local
  declaration under a spec export's name must be replaced by a binding to the
  spec — and for these, obeying it **replaced a precise type with `any`**.
  objectui's `NavigationItem` is a 118-line documented interface (`recordId`
  template variables, `requiresObject` / `requiresService` capability gates,
  `filters` precedence); every key of it exists in the spec's version, so by every
  available signal it read as a redundant fork safe to delete. Deleting it swapped
  a fully-typed interface for `any`, with no compile error anywhere to say so.

  It is hard to catch by inspection because `any` is mutually assignable with
  everything, so the natural "are these the same type?" check answers _yes_ in both
  directions and recommends precisely the wrong action. Same failure family as
  #4075's `[key: string]: any` on `ActionDef`: a type that agrees with everything
  reads as agreement.

  **Now annotated with the real type**, using the pattern `QueryAST` already
  follows in `data/query.zod.ts` — infer the non-recursive part, tie the recursive
  knot in the type, so the keys stay derived from the schema instead of being
  hand-maintained beside it:

  ```ts
  const BaseXSchema = z.object({ …every non-recursive key });
  export type X = z.infer<typeof BaseXSchema> & { children?: X[] };
  export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({
    children: z.array(XSchema).optional(),
  }));
  ```

  `z.infer` now resolves to the type it should always have been: `NavigationItem`
  is the nine-branch discriminated union, `FormField` the 30-key form-field
  contract (with `visibleOn` absent by construction — ADR-0089 D2 folds it into
  `visibleWhen` at the boundary), `JoinNode` and the newly exported `FieldNode`
  the query AST nodes, `NormalizedFilter` the normalized filter AST. Runtime
  validation is unchanged: every schema parses exactly what it parsed before.

  **What the types immediately caught**, none of it visible while they were `any`:

  - `account.app.ts` set `defaultOpen` on three nav groups — a key the spec has
    never declared. It worked only because objectui's `NavigationRenderer` still
    falls back to that legacy alias. Fixed at the producer per Prime Directive
    #12: the canonical key is `expanded`.
  - The MongoDB driver built its projection with `projection[field] = 1` over
    `query.fields`, so a relationship `FieldNode` would have keyed the projection
    on `"[object Object]"`. It now reads the node's field name.
  - `setup.app.ts`, `studio.app.ts` and `setup-nav.contributions.ts` are annotated
    with the PARSED `App` / `NavigationContribution` types but omitted
    `.default()`ed keys (`expanded`, `target`), as did the form fields
    `metadata-protocol` synthesizes for `getUiView` (`span`). Each now states the
    default it was relying on, matching what the surrounding literals already do
    for `active` / `isDefault` / `collapsible` / `collapsed` / `columns`.

  **Gated, not just fixed** (`check:exported-any`, wired into the required
  `TypeScript Type Check` job). `api-surface.json` records that an export _exists_
  and never what it _resolves to_, which is how these survived a whole major with
  every gate green. The new scan reads the built `.d.ts` a consumer's import
  actually resolves to and fails on any exported type that resolves to `any` — or
  any exported schema whose output is `any`, the root cause, and the only reason
  `FieldNodeSchema` was visible at all. Its `KNOWN_ANY` ledger is shrink-only and
  currently empty. It self-tests against the real zod first, so if the internals it
  reads are ever renamed the gate fails loudly instead of quietly passing
  everything forever.

- 9b43ee2: test(drivers): the filter-logic standard now covers the backend it was counted without (#4405)

  `FILTER_LOGIC_CASES` (#3774) opens by calling itself the standard "the four
  independent FilterCondition backends are each checked against". Five backends
  exist. `driver-mongodb`'s `translateFilter` was missed, not excluded — an
  independent implementation whose `$and`/`$or`/`$not` translation shares no line
  of code with the SQL compiler or the in-memory matcher, and the only one whose
  target language cannot spell the standard directly: MongoDB has no
  document-level `$not` at all (the server answers `unknown top level operator:
$not`), so a negation has to leave as `$nor`, and a branch's own keys have to
  stay in one document while `$and`/`$or` clauses are lifted beside them. That
  route was never checked against the shared cases. Both DEBT rows the #4363 gate
  recorded are now cleared, and `scripts/check-driver-conformance.mjs` reports
  `ok` for every cell of the matrix.

  **`driver-mongodb` runs the table twice, and the split is deliberate.**
  `mongodb-filter-logic-translation.test.ts` drives every shared case through
  `translateFilter` and evaluates the emitted MongoDB _document_ over the shared
  fixture — a pure function, no server, so it always runs. That matters here more
  than anywhere: `mongodb-memory-server` downloads a ~123 MB binary from
  fastdl.mongodb.org, and a defect only a downloadable binary can catch is a
  defect nobody catches on a restricted network. Its in-process reader is strict
  by construction — every shape it does not model throws instead of evaluating to
  true, a document-level `$not` included — and its own discrimination is pinned by
  cases that require a widened document to FAIL the case it widens, so "all green"
  cannot mean "the reader says yes to everything".
  `mongodb-filter-logic-conformance.test.ts` runs the same table against a real
  mongod and answers the one question the first half cannot — does MongoDB agree?
  — skipping cleanly (never silently) when the binary is unreachable.

  **`driver-sqlite-wasm` runs the table through its own engine.** It inherits
  `SqlDriver`'s filter compiler, so nothing is re-implemented; what the suite pins
  is that a nested `(… AND …) OR (… AND …)` survives the custom sql.js dialect
  that compiles, binds and marshals it — the same seam its temporal and pagination
  suites cover for their clauses. Tracked as DEBT rather than EXEMPT because
  "inherits, therefore fine" is the assumption those suites exist to disprove; the
  suite is what disproves it.

  **No divergence was found.** `translateFilter` answers all seventeen shared
  cases correctly today, `$not`-inside-a-branch and nested `$and`-inside-`$or`
  included, so no translation change ships here — what changes is that the next
  edit to it cannot quietly widen a filter. Both suites were verified to be
  discriminating rather than decorative by reintroducing the #3774 miscompile
  (propagating `or` into a branch's own contents): 15 of the mongodb translation
  suite's 26 tests fail, and 13 of the wasm suite's 18.

  `packages/spec`'s `filter-logic-conformance.ts` header now says five and names
  the fifth — a code comment; no schema, export or generated artifact moved.

- ec975f1: fix(objectql,driver-mongodb)!: `findOne` must say which record it wants, and executes every option it declares (#4419)

  `findOne` reads a single row, which makes its predicate the only thing between
  the caller and _an arbitrary record_. When the predicate is missing the result is
  not `null` — it is the object's **first row**: a real, plausible-looking record
  with nothing to do with the request, which the `if (!row)` check every call site
  already has cannot catch, and which then propagates into whatever is computed
  next. Reported downstream: line items defaulting their price from the first
  product in the catalog rather than the selected one, and "is this deal already
  closed?" answered against an unrelated record while the write that followed
  correctly targeted the intended id. A throw would have been caught in
  development; a `null` would have been caught by the null-check. A valid-looking
  wrong record defeats both.

  **Breaking — `findOne` now refuses a query that selects nothing in particular.**

  FROM → TO:

  | Was                                                         | Now write                                                           | Meaning                                          |
  | ----------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
  | `findOne(o)`, `findOne(o, {})`, `findOne(o, { where: {} })` | `findOne(o, { where: … })`                                          | the record matching this predicate               |
  |                                                             | `findOne(o, { search: 'Acme' })`                                    | the record this search finds                     |
  |                                                             | `findOne(o, { orderBy: [{ field: 'created_at', order: 'desc' }] })` | the FIRST record in this order — the newest      |
  |                                                             | `find(o, { limit: 1 })`                                             | any row will genuinely do, said at the call site |

  One-line fix: add the `where` you meant, or `orderBy` if you meant "the newest
  one", or switch to `find(o, { limit: 1 })` if any row will do. The error names
  all four. `find` and `count` are unchanged — returning or counting every row is
  an honest answer; only `findOne`'s implicit "just one of them" turns a missing
  predicate into a confidently wrong record. The guard reads the CALLER's
  predicate, before RLS/sharing middleware injects its own: a tenant filter
  narrows which rows are visible, it does not make "whichever comes first"
  something the caller asked for.

  **Two silent drops that produced the same wrong record are fixed with it.**

  - **`findOne({ search })` applies the search.** The ADR-0061 `search` →
    cross-field `$contains` expansion lived inline in `find` and nowhere else,
    while `find` and `findOne` are checked against the SAME legal-key set — so
    `search` passed the gate, rode onto the AST, and reached a driver. No driver
    reads `ast.search`. The read therefore ran with no predicate at all and
    `limit: 1` did the rest. The expansion is now one method both call.
  - **`MongoDBDriver.findOne` applies `orderBy`, `fields` and `offset`.** It
    translated `query.where` and dropped the rest, so `findOne({ orderBy })` did
    not return the newest record — it returned whichever document the scan reached
    first. `find` and `_findStream` in the same driver had always handled all
    three. This one matters beyond Mongo: the guard above tells an unpredicated
    caller to reach for `orderBy`, and an escape hatch one backend ignores is not
    an escape hatch. No ordering is IMPOSED when the caller supplies none — both
    drivers keep that carve-out (#4363), and `SqlDriver`'s comment about Mongo
    "never sorting" is corrected, since it cited the dropped parameter as
    agreement.

  **And a gate so the class does not come back.** A drift pin walks
  `ENGINE_OPTION_KEY_SETS.findOne` and requires each declared key to have an
  observable effect — on the AST the driver receives, on the driver options, or in
  an explicit "not executed, and here is why" entry (only `limit`, which the
  contract's `limit: 1` overrides). `search` sat declared-but-unexecuted through
  two rounds of hardening because nothing asked that question.

  Together with #4346 (`filter` → `where` folds on every entry point) and #4400
  (unknown option keys throw), a read parameter the engine does not execute now
  fails at the call site instead of quietly changing the answer.

- 8825a06: drivers: `limit: 0` returns no records, on every driver and every read door

  `limit: 0` was ruled in #6485 to mean **return no records**. Three of the five shipped
  drivers did not honour it, in three different ways — and the ones that disagreed
  returned **more** data than was requested, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter. Reachable since #6578: the client now puts
  `top=0` on the wire, so the answer depended on which driver a deployment configured.

  **`driver-memory` — the slice was dropped.** `find()` sliced with `if (query.limit)`,
  truthiness, and `0` is falsy. Measured before the fix, three rows seeded:
  `{ limit: 0 }` returned **3 of 3**, and `{ limit: 0, offset: 1 }` returned 2 — the
  OFFSET applied and the LIMIT silently did not, which is why every paging suite stayed
  green over it. Two more sites of the same shape in `memory-analytics.ts` (the `$limit`
  pipeline stage and the SQL string builder) moved with it. Mingo honours `{ $limit: 0 }`
  as zero records (measured), so presence is sufficient there.

  **`driver-mongodb` — the value was forwarded faithfully, to a client that means
  something else by it.** `buildFindOptions` already tested presence, so `0` arrived
  exactly as written — but the MongoDB Node driver DEFINES `limit: 0` as _no limit_, so
  the answer was still the whole collection. Fixed with an explicit short-circuit that
  returns the empty result **before the client is consulted** (`[]` from `find`, `null`
  from `findOne`, which had the same hole). No round trip is made for a query whose
  answer is already known, and no future change in the upstream driver's reading of `0`
  can move this behaviour. Deliberately `=== 0`, not `<= 0`.

  **`driver-sql` — two doors disagreed with a third.** `findRows()`, the door `find()`
  goes through, has always compiled `limit` on presence. Two others compiled it on
  truthiness:

  - `findWithWindowFunctions()` — the live window-function read door (#4286). Returns
    rows, so this was user-visible wrong data: `{ limit: 0 }` returned the whole table.
  - `analyzeQuery()` / `explain()` — returns a plan. It compiled `select * from "orders"`
    where `find()` sent `... order by "id" asc limit ?`, so it explained a statement
    other than the one that would run.

  `offset` moved with `limit` at both doors for internal consistency only. That half is
  **measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
  and MySQL alike. It is pinned as the no-op it is rather than reported as a fix.

  **`driver-turso` remote transport — an `OFFSET` with no `LIMIT` was a syntax error.**
  Surfaced by the new conformance control that reads with a bare offset. SQLite's grammar
  is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses independently,
  so `find(obj, { offset: N })` with no `limit` produced `near "OFFSET": syntax error` —
  for **every** `N`, and only on the remote transport (the local half goes through knex,
  which synthesises the `LIMIT -1` no-limit sentinel). Remote now builds the same
  statement knex does.

  Result sets only ever get **narrower**. A caller who wants every row should omit
  `limit` rather than pass `0`.

  `@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
  case-set pinning this — with controls, so "return nothing, always" cannot pass it. All
  **five** drivers answer it, with **no DEBT rows**: future drift goes red at
  `check:driver-conformance` rather than being discovered in production.

- 71f205d: fix(driver-mongodb): 空 `$and` / `$or` / `$not` 按布尔单位元归约,非 filter 节点先响亮拒收 (#5239)

  `translateFilter` 过去把组合子数组**原样透传**给 MongoDB。而 MongoDB 对空数组既不答
  TRUE 也不答 FALSE,是第三种行为:**直接拒绝整条查询**(`$and/$or/$nor must be a
nonempty array`)。于是 `{ $and: [] }` 与 `{ $or: [] }` 一路走到 `find` /
  `countDocuments` / `updateMany` / `deleteMany`,变成一个不带 ADR-0112 错误码的服务端
  异常 —— 而 `driver-sql`(#5134 / PR #5243)、`driver-memory`、`formula` 三家早已按单位
  元作答。

  改成与它们同一套**结构性三值归约**:先把整棵 filter 树判成 `true` / `false` /
  `clause`,再据此产出。空 `$and` 归约为 TRUE(不产出条件),空 `$or` 归约为 FALSE 并产出
  一个**真实的零行条件** `{ _id: { $in: [] } }` —— 关键在于「什么都不产出」等于 `{}`,而
  `find` / `updateMany` / `deleteMany` 把 `{}` 读作**全部文档**,方向正好相反。`{}` 作为
  `$or` 的分支仍是 TRUE 析取项,`{ $not: {} }` 仍是零行,这两条 MongoDB 本来就与布尔代数
  一致,所以归约按结构做而不是只判 `length === 0`。发出的每个 `$and` / `$or` 数组因此都保
  证非空。

  **同一改动里的形状拒收**,顺序是先拒收后归约:单位元把「这个节点没有谓词」读作「匹配全部
  文档」,所以空节点必须只有一个成因。改前实测,本驱动这一格比 `driver-sql` 当年更糟 ——
  `{ $or: [new Date()] }` 译成 `{ $or: [{}] }`,即**每一份文档**;`{ $or: 'x' }` 与
  `{ $not: null }` 译成 `{}`,同样是每一份文档。`updateMany` / `deleteMany` 走的是同一个
  translate 层,在那里「放宽到全部文档」不是行数不对而是数据丢失。现在这类操作数按
  ADR-0112 以 `INVALID_FILTER` / `status: 400` 拒收,并在消息里点出位置
  (`filter.$or[0]`)。`Date` / `RegExp` / class 实例都满足 `typeof x === 'object'` 却枚举
  为空,故判定按**原型**而非 `typeof`。

  `packages/spec` 侧只动文档:`FilterConditionSchema` 的契约 TSDoc 写明 `$not` 的
  **NULL-safe** 语义(#5146 维护者拍板 —— 被比较列为 NULL 的行不满足被否定的条件,应当被
  返回,即 `NOT (…) OR col IS NULL`),并在 `filter-logic-conformance.ts` 记下三族已裁定但
  **尚未进表**的 case 及其实测矩阵。无运行时行为变化,无 API 变化。

- 7e9e555: fix(driver-mongodb): the `$contains` family is case-SENSITIVE — the hardcoded `$options: 'i'` is gone (#6682)

  **Row-set change for anyone filtering text on MongoDB.** `$contains`,
  `$notContains`, `$startsWith` and `$endsWith` translated to a `$regex` with a
  hardcoded `$options: 'i'` beside it, which is MongoDB's full-Unicode case fold.
  That flag is off all four arms. `{ name: { $contains: 'acme' } }` no longer
  returns `ACME Corp`.

  This is #4706 **Q2 = A** — the family is case-sensitive on every backend —
  arriving at the last driver that was on the wrong side of it. #6518 flipped the
  SQL family (`GLOB` on the SQLite dialects, `LIKE` over a binary cast on MySQL,
  `LIKE` unchanged on Postgres); `formula`, ObjectQL's `having` and
  service-analytics' compilers were already case-exact.

  **Both directions of the defect mattered.** The fold OVER-matched — it returned
  rows the filter excludes, which on an RLS read scope is over-reach rather than a
  loose filter (#3948) — and it folded the whole Unicode range, overshooting the
  ASCII-only boundary Q1 = A holds `$icontains` to.

  **If you were relying on the fold, write `$icontains`.** It is the deliberate
  case-insensitive spelling, implemented on this driver since #6520, and it folds
  ASCII only (`café` does not match `CAFÉ`) — the one domain every backend can
  deliver.

  Unchanged: `escapeRegex`, so the comparand is still matched LITERALLY (`a.b`
  matches `a.b`, not `axb`), and `$icontains`, whose fold has always lived in the
  pattern rather than in `$options`. Every face of this driver —
  `find`/`count`/`update`/`delete` and the aggregation `$match` — routes through
  the one `translateFilter`, so there is no second answer to align.

  The driver's `FILTER_TEXT_CASES` conformance cell is now CLEARED: the new
  server-free suite `mongodb-filter-text-conformance.test.ts` imports the shared
  case-set and drives all seventeen cases, rejection rows included, and the DEBT
  row for this cell is deleted from `scripts/check-driver-conformance.mjs`.
  `driver-memory`'s half of #6682 stays open under the #5499 freeze, so that card
  remains open.

- f7a60d9: fix(driver-mongodb): refuse malformed `$between`, undeclared node-level `$`-keys and `{ field: {} }` (#5346, #5376)

  `driver-mongodb` was the last backend still ANSWERING three filter shapes every
  other backend refuses. All three failed the same way — the query ran, reported
  nothing, and returned a row set nobody asked for. Measured through
  `translateFilter` (a pure function whose output _is_ the document MongoDB
  receives):

  ```
  { score: { $between: 5 } }       =>  {"score":{}}
  { $where: 'return true' }        =>  {"$where":"return true"}
  { stage: {} }                    =>  {"stage":{}}
  ```

  All three now refuse with `INVALID_FILTER` / 400 (ADR-0112), naming the position
  (`filter.$or[1].score.$between`), through the same `unsupportedFilterError`
  constructor this package's other filter refusals already used — no new envelope.

  - **Malformed `$between`** — the emitter arm wrote both bounds inside
    `if (Array.isArray(value) && value.length === 2)` and had no `else`, so a
    malformed comparand dropped the whole range and normalised the field to `{}`.
    The twin, down to the missing `else`, of the arm #5328 fixed on
    `driver-memory`. The leading sentence is `driver-sql`'s verbatim — one
    condition, one wording (#5240).

  - **An undeclared `$`-key in a NODE position** — the severe one. The translator's
    switch knows three combinators (`$and` / `$or` / `$not`); every other key took
    the FIELD path, and a key carrying no `$`-prefixed sub-keys fell to implicit
    equality and was written into the outgoing document verbatim, where **MongoDB
    executed it**. `$where` is server-side JavaScript; `$nor` is a real combinator
    the Filter Protocol never declared. The emitter's field-level `default:` arm
    has named exactly these spellings as its P0 reason for refusing them one level
    down for two releases — that gate was only ever installed at the field
    position. On the other backends the same input compiled to a column name and
    returned zero rows (#5348 / cloud#1077, since refused) or was already refused
    (#5324); only here was it evaluated.

  - **`{ field: {} }`** — a field constrained by zero operators, ruled REFUSE on
    #5240 and gated on `driver-sql` / `driver-sqlite-wasm` / `driver-memory` /
    `formula` by #5327. This driver translated it to `{ field: {} }`, which MongoDB
    reads as "the field is deep-equal to the empty document" — not the FALSE the
    ruling declined to take, but a DIFFERENT filter that merely looks like FALSE
    until a document actually stores `{}` there.

  Each gate sits on the validating walk (`classifyFilterKey`), beside the existing
  `$null` (#5347) and `$icontains` (#6520) gates, rather than in the emitter — the
  emitter is skipped wholesale when a boolean identity settles the enclosing node,
  so a gate there would fire or not depending on a shape's SIBLINGS. Measured
  before the fix: `{ $or: [ {}, { $where: 'x' } ] }`,
  `{ $or: [ {}, { score: { $between: 5 } } ] }` and `{ $or: [ { a: {} }, {} ] }`
  all translated to `{}` — match-all. The `$between` emitter arm additionally
  keeps a local check as defense for its own invariant, the dual-gate pattern the
  `$null` arm documents; both sites call one constructor with one path spelling.

  Every filter that translated before still translates byte-identically: this adds
  refusals in front of the verdict, it does not reclassify any surviving shape.
  Authored filters using these shapes were already not doing what they appeared to
  do, and now say so instead of answering silently.

- d17a222: feat(driver-mongodb): bucket `dateGranularity` groupBy server-side, and publish `supports.queryDateGranularity` (#7580)

  `driver-mongodb` now lowers a `dateGranularity`-bearing `groupBy` into the
  aggregation pipeline and advertises the capability, so `engine.aggregate` pushes
  a bucketed aggregate down to MongoDB instead of fetching every matching row and
  bucketing it in JS.

  **Answers do not change — where the work happens does.** `MongoDBDriver.supports`
  published no `queryDateGranularity`, so the engine already bucketed every
  granularity in memory and the results were correct. What was missing was the
  index/server-side half: a year-over-year rollup shipped the whole result set to
  the client first. #7550 refused a bucketed node at the builder rather than
  implement or silently drop it; this replaces that refusal with the lowering it
  described.

  **All five granularities `DateGranularity` declares are advertised** — `day`,
  `week`, `month`, `quarter`, `year`. The bucket LABELS are the engine's own
  spellings (`'2024'`, `'2024-Q1'`, `'2024-01'`, `'2024-01-15'`, ISO `'2025-W01'`),
  because the engine picks between the pushed-down and in-memory paths per query
  and a drill-down can cross that seam. `week: true` where `driver-sql` on SQLite
  carries `week: false`: MongoDB's `$dateToString` has both halves of the ISO-8601
  week date (`%G`/`%V`), SQLite has neither.

  **All three ADR-0053 storage forms are served.** This driver stores `datetime` as
  a BSON `Date` but `date` and `time` as timezone-naive TEXT, so the lowering reads
  the instant through `$convert … onError/onNull: null` — total, exactly like the
  in-memory `bucketDateValue`, which puts null, missing and unparseable values in
  one empty bucket. A `Field.time` column is a wall clock and not an instant: both
  paths agree it has no bucket, rather than one of them inventing a day.

  **Timezones are unchanged and stay engine-side.** `engine.aggregate` forces the
  in-memory path for any non-UTC reference zone (ADR-0053 Phase 2 D2) and the AST
  it hands a driver carries no `timezone`, so this bucketing is UTC by
  construction.

  The #7550 refusal is kept for a granularity outside the advertised record —
  `NOT_IMPLEMENTED` / 501 in the ADR-0112 envelope, now naming what _is_ bucketed
  here — and it reads the same constant the capability record publishes, so the
  two cannot drift.

  ⚠️ **Bound, stated because a green suite reads as more than it is.** Parity with
  the engine's labels is proven through a strict in-process pipeline evaluator, not
  against a live mongod: this environment cannot fetch a mongod binary (#5517). The
  `$convert` / `$dateToString` / `$concat` / `$switch` semantics the lowering stands
  on are documentation-derived. The bound is written into the suite header, onto
  the published capability, and beside the lowering.

- f067930: fix(driver-mongodb): take a structured `GroupByNode`, and answer `count` /
  `count_distinct` the way every other backend does (#6850, part of #6814)

  `driver-mongodb` is now enrolled in the shared `AGGREGATION_CASES` standard
  (`@objectstack/spec/data`), and clearing that cell fixed three divergences — all
  three of the kind that ANSWER rather than fail, which is why none of them ever
  surfaced as an error.

  **1. A structured `groupBy` node had no lowering at all (#6850).**
  `GroupByNodeSchema` declares a union: a bare field name, or
  `{ field, dateGranularity?, alias? }`. The pipeline builder annotated `groupBy`
  as `string[]` and did `groupId[field] = '$' + field`, so a structured node — an
  object in that loop — stringified: the `$group._id` key became the literal
  `"[object Object]"` and its value the field path `"$[object Object]"`, which
  matches nothing. The aggregation did not refuse and did not throw. It returned
  rows grouped by a nonexistent path, under a column named `[object Object]`.
  `MongoDBDriver.aggregate` passed the value through an `any` cast, which is why
  the declared union never met that annotation at `tsc`.

  Both sides now spell the declared type, so the next drift between them is a
  compile error. The `$group._id` keys on `alias ?? field` and its value is the
  FIELD path — the projected column is renamed, the grouping does not move, which
  is the rule #6401 converged the three SQL faces onto and the one
  `in-memory-aggregation.ts` has always applied. The bare-string spelling emits
  exactly what it emitted before.

  **2. `count_distinct` counted NULL as a distinct value (#6814).** The lowering
  collects a `$addToSet` and sizes it; `$addToSet` keeps an explicit `null`, so a
  nullable column answered one HIGHER than `COUNT(DISTINCT col)` — 3 where the
  standard says 2. The sizing now excludes null, which is what
  `COUNT(DISTINCT col)` computes on SQLite, PostgreSQL and MySQL alike and what
  `objectql`'s in-memory fallback already computed.

  **3. `count(col)` counted ROWS, not values.** Measured while writing the suite
  and named by neither issue: the `count` arm ignored `field` entirely and emitted
  `{ $sum: 1 }` for both spellings, so `count(stage)` came back 6 — the answer
  `count(*)` already has — where the standard says 4. `count(col)` now counts
  non-null values, and a missing field is counted as null, the SQL reading.

  **A `dateGranularity` node is now REFUSED rather than silently ignored**, with
  `NOT_IMPLEMENTED` / 501 in the ADR-0112 envelope — the same refusal, first
  sentence for first sentence, that `driver-sql` and `driver-turso`'s remote
  transport give for a granularity they cannot bucket (#6212). This driver
  publishes no `supports.queryDateGranularity`, so the engine buckets every
  granularity in memory and never pushes a bucketed node down; the refusal fires
  only for a caller that reached the builder directly, which previously got a
  `"[object Object]"` grouping instead. A native `$dateTrunc` lowering is
  buildable and is not ruled out — it needs the engine's bucket LABELS, a
  published capability record and `date-bucket-parity.test.ts`, so it is its own
  change. A `groupBy` entry that is neither half of the union is refused with
  `INVALID_QUERY` / 400.

  The suite that holds all of this is server-free (`mongodb-aggregation-
translation.test.ts`): this package's real-mongod suites are opt-in since #5517,
  so it drives the EMITTED pipeline through a strict in-process evaluator that
  refuses every shape it does not model. It holds the lowering to the shared
  table; it does not answer "does MongoDB agree?", which is a real-mongod half's
  question and is recorded as still open on #6814.

  `driver-memory`'s half of #6814 is untouched — it remains under the #5499
  investment freeze, and its `AGGREGATION_CASES` DEBT row stands.

- 030125b: feat(objectql)!: `init()` refuses to boot when a data driver fails to connect (#3741)

  `ObjectQLEngine.init()` wrapped every driver's `connect()` in a try/catch, logged
  one error line, and carried on. A server whose database was unreachable therefore
  "started successfully" — health endpoints could even stay green — and then failed
  every request with an error that reads nothing like _the database is down_. The
  warning it printed (`Operations may recover via lazy reconnection or fail at query
time`) was half fiction: grep the repo and no reconnection exists in `driver-sql`
  or `driver-mongodb`, so only the "fail at query time" half was ever real. The
  caller made it worse — `ObjectQLPlugin.start()` runs `syncRegisteredSchemas()`
  immediately after `init()`, issuing DDL against a driver that isn't there.

  The structural half of the bug was worse than the operational one: the catch
  removed a driver's ability to **refuse startup at all**. Any fatal startup check —
  licence, server version, incompatible configuration, missing capability, not just
  an unreachable socket — is expressed by throwing from `connect()`, and every one
  of them was silently downgraded to a runtime error. That is why driver-mongodb's
  multi-tenancy guard (#3724 / #3734) had to be hoisted into its constructor.

  - `init()` now **throws** `DriverConnectError` (`code: 'ERR_DRIVER_CONNECT'`)
    when any boot-registered driver's `connect()` rejects, aborting kernel
    bootstrap. It still attempts every driver first, so one failed boot names all
    of them. The message is self-contained — each failed driver and its cause —
    because the CLI prints `error.message` alone; the first cause is also attached
    as `error.cause`. Exported from both `@objectstack/objectql` and
    `@objectstack/objectql/core`.
  - `connect()` is now a supported place for a driver to veto boot. Startup
    validation that needs a live connection (server version, capability probes)
    no longer has to be forced into a constructor.
  - The misleading "lazy reconnection" warning is gone.
  - New escape hatch `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`
    (`resolveAllowDriverConnectFailure()` in `@objectstack/types`) restores the old
    lenient boot, but loudly: a `DEGRADED BOOT` banner names the failed drivers and
    states that they are never retried or reconnected and that every query and
    schema sync routed to them will fail for the process lifetime. The banner goes
    to stderr as well as the logger, because `os serve` swallows all of stdout
    during boot and `Logger` routes `warn` there — logger-only, the one message
    that matters would be invisible in exactly the deployment the flag is for.
    Defaults off.

  **Migration.** No code or config change is needed for a correctly configured
  deployment — a driver that connected before still connects. A deployment that was
  _silently_ booting without its database now fails the boot instead, with the
  driver name and cause in the error; fix the datasource configuration (typically
  `OS_DATABASE_URL`, credentials, or network reachability). To keep booting without
  it — deliberately, and knowing every request that touches it will fail — set
  `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.

- a13827e: fix(data): paging a sorted read is a partition of the result set, not five queries that share a WHERE clause (objectui#3106)

  `ORDER BY status LIMIT 50 OFFSET 50` names a sort key that does not identify a
  row, and no backend promises that rows with equal keys keep the same relative
  arrangement between two queries. MongoDB documents this outright — `sort` +
  `skip`/`limit` on a non-unique key "may return the same document more than
  once". So page 2 could repeat a row page 1 already showed and skip one nobody
  ever saw:

  ```
  page 1: ORDER BY status LIMIT 5 OFFSET 0   -> [r05 r07 r11 r04 …]
  page 2: ORDER BY status LIMIT 5 OFFSET 5   -> [r04 …]        r04 again; one row never served
  ```

  Every page is full, every row is real and belongs, and the duplicate sits
  several screens from the omission — which is why this is found by a user
  counting records, never by reading a response.

  `SqlDriver` and `MongoDBDriver` now append a unique tie-breaker to any non-empty
  `orderBy`, in the last requested key's direction (determinism holds either way,
  but a same-direction suffix is the one an index can still walk in one pass).
  `driver-memory` already conformed — `Array#sort` is stable over a table whose
  order does not move — and now has a suite saying so, because that property is
  implicit and easy to lose in a refactor that looks like a speed-up.

  `SqlDriver` adds it only for objects it created itself (`initObjects` records
  those). A federated table (ADR-0015) may have no `id` column, and guessing there
  would be worse than doing nothing: the unknown-column error is answered by
  #3821's ladder retrying with **no ORDER BY at all**, trading a reshuffle among
  ties for the loss of the caller's whole sort.

  The obligation is now normative on `IDataDriver.find`, with shared cases in
  `@objectstack/spec/data` (`PAGINATION_CASES`) that all three drivers run — so a
  future driver is held to it by a gate rather than by remembering.

  Not covered by this change: a paged read with **no** `orderBy`. Same defect,
  wider blast radius, so it was carved out to #4363 rather than folded in — and
  closed there, in the same release. The contract, the shared cases and both
  drivers now cover a paged read whatever its `orderBy`, including none at all.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                                                                                                                                                   |
  | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`                                                                                                                             |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                                                                                                                                                   |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | the same `expand`, keeping the FK in your own projection (`fields: ['title', 'owner_id']`) — **not** a dotted `fields` path, which no driver resolves and the ingress refuses (#7532) |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias`                                                                                                                      |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- 9c5abf4: fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

  Two shapes the Filter Protocol never declared were reaching the drivers, and
  every driver ANSWERED them — with a different answer. Both are now refused with
  `INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
  already speaks.

  ## `$null` with a non-boolean comparand — a behaviour change you can observe

  `FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
  default branches hung on opposite sides, so one filter meant opposite things per
  backend. Measured against one row with `stage: 'won'` (id 1) and one with
  `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

  | backend                                     | read as                           | rows        |
  | ------------------------------------------- | --------------------------------- | ----------- |
  | driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`)    | `["2"]`     |
  | driver-memory query path, driver-mongodb    | IS NOT NULL (anything but `true`) | `["1"]`     |
  | driver-memory reference matcher             | no constraint at all              | `["1","2"]` |

  **What changes for you:** a caller that today gets rows back for
  `{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
  operator, the field and the position. That includes calls working by truthy /
  falsy coincidence — and the sharpest case is the STRING `"false"`, which is
  truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
  the opposite of what its author wrote it to mean, on at least one of them
  whichever they meant. A JSON round-trip or generated metadata produces it
  readily.

  **The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
  `{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
  backends, and so is every other operator. `$exists` is deliberately NOT tightened
  here — it diverges on its own axis (what "exists" means for a null-valued key)
  and is tracked separately.

  ## An undeclared `$op` in a document position — silent empty set becomes a 400

  `FilterConditionSchema` declares exactly three `$`-keys at a node
  (`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
  compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
  `{ $expr: … }` produced a predicate that matched nothing and reported nothing —
  a caller could not tell "no rows matched" from "the filter never compiled". The
  FIELD position had refused the same class of input since v16, so one driver gave
  two answers depending on depth.

  **What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
  returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
  (and `driver-sqlite-wasm`, which inherits it) into line. The three declared
  combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
  and every legal filter compile byte-identically.

  Both refusals are raised on the driver's validating walk rather than in its SQL
  emitter, so a malformed node is refused regardless of whether a sibling
  disjunct would have short-circuited the compile.

- 3510e4a: refactor(spec,drivers,lint): one implementation of the filter identity reduction (#5659)

  `{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
  disjunct that absorbs its `$or`, `{ $not: {} }` is FALSE. That is a ruling
  (#5322/#5134) pinned for every backend by the four identity cases in
  `FILTER_LOGIC_CASES` — and it was implemented four times over: `reduceFilterNode`
  in `driver-sql`, the same function again in `driver-mongodb`, the
  `every`/`some`/truthiness algebra of `driver-memory`'s matcher, and nearly a
  fifth hand-written copy inside `@objectstack/lint`, which declined to write one
  and filed this issue instead.

  **New in `@objectstack/spec` (`@objectstack/spec/data`): `reduceFilterVerdict`**,
  beside the case table that proves it. It answers `'true' | 'false' | 'clause'`
  for a filter node and never throws on its own; each backend's own refusals — the
  undeclared `$`-combinator and the `undefined` comparand in `driver-sql`, the
  query-level keys and the `$null` comparand in `driver-mongodb` — are passed in as
  `FilterVerdictHooks` and are invoked from exactly the positions they were invoked
  from before. `reduceFilterKeyVerdict` answers the same question for one key, which
  is what both SQL and MongoDB emitters consult while walking a node.

  **No behaviour changes in the three drivers.** The move is mechanical: the shared
  algebra replaces each private copy, the refusals stay where they were, and the
  `FILTER_LOGIC_CASES` conformance suites are green on both sides of the change —
  including the SQL-inheriting `driver-sqlite-wasm` and `driver-turso`.

  **`@objectstack/lint` gains two warnings it was structurally blind to.** The
  `multi: true` unbounded-bulk-write rule (#5482) asked "does this filter have zero
  keys", so a `delete_record` bounded by `filter: { $and: [] }` or
  `filter: { $or: [{}] }` — a whole-object write by the ruling every driver executes
  — passed silently. It now asks the reduction, and it warns about both while
  staying quiet on `{ $or: [] }` and `{ $not: {} }`, which match nothing. The
  message names the shape it saw (`a filter that REDUCES TO TRUE ({"$and":[]})`)
  rather than calling a non-empty filter "empty".

  If you have a flow declaring a bulk write bounded by one of those two shapes, the
  lint will now tell you so — the write was already unbounded at run time; only the
  feedback is new.

- 6038de7: feat(spec,drivers): the temporal conformance matrix gains its `Field.time` axis — and `time` finally gets a storage form off SQL (ADR-0053 D-A3.2)

  `@objectstack/spec/data` gains `TEMPORAL_TIME_ROWS` / `TEMPORAL_TIME_CASES`,
  the wall-clock half of the shared matrix. A time gets its own table rather than
  a third `kind` on the existing one because it shares no comparand vocabulary
  with the other two: no relative token resolves to a wall clock, and the
  bare-day whole-day rule (#3777) must **not** reach it — which the table now
  asserts rather than assumes, since "the rule leaked into the wrong field type"
  is exactly what a conformance matrix is for. The fixture is a business day
  carrying the boundaries #3994 measured: both window edges, the pair straddling
  the millisecond-suffix width change, midnight and `23:59:59.999`.

  **The axis found a real gap on its first run.** ADR-0053 D-C gave `Field.time`
  a canonical form on every SQL dialect, but `driver-memory` and
  `driver-mongodb` were never extended — both declared
  `TemporalFieldKind = 'datetime' | 'date'`, so a `time` column was never
  classified and never coerced. It therefore held whatever each writer produced,
  and both stores compare across types by bracket: a text bound matched no
  `Date`-written row, in either direction, for every operator. Measured on
  `driver-memory`, **8 of the 9 shared cases** returned only the text-written
  half — a business-hours window answering `[d_mid, f_close]` instead of
  `[c_open, d_mid, e_mid_ms, f_close]`. This is #4047's failure one field type
  over, and it survived #4047 because that work extended `datetime` and `date`
  without revisiting `time`. On mongo it was also a documentation failure: that
  module's canon table has listed `time` as `HH:MM:SS[.fff]` text since #3994,
  and nothing implemented it.

  Both drivers now carry `storageTimeValue`, mirroring the SQL
  `canonicalTimeOfDay`: `HH:MM:SS`, `.fff` only when the milliseconds are
  non-zero, a `Date` / epoch / full-timestamp folding to its **UTC** time-of-day
  (never the host's), and totality — an out-of-range wall clock like `'25:00'`
  passes through rather than being silently rewritten. Text on both, mongo
  included: a wall clock is not an instant, so a BSON `Date` would invent a
  calendar day and a zone the author never wrote.

  If you have existing `time` data on either driver, values written as `Date`
  objects converge to canonical text on their next write; reads of un-migrated
  documents are unchanged. Filters were already unable to reach the mixed half,
  so no query that worked before stops working.

- e13fd91: fix(objectql,driver-mongodb): declare the tenant index in `indexes[]`, so a registry-backed object stops reporting itself invalid (#6810)

  `applySystemFields` provisioned the injected `organization_id` column with
  `indexed: opts.multiTenant`. `indexed` is **not a `FieldSchema` key** — #2377 /
  ADR-0049 removed it because a field-level index flag built no index — and
  `FieldSchema` is a `strictObject`, so a field carrying it is rejected **by
  name**, with a purpose-written message.

  `registerObject` runs `applySystemFields` _before_ storing and
  `getItem('object', …)` serves that post-injection document, so the key travelled
  all the way out to `/meta`, where `decorateMetadataItem` re-parsed the served
  body and stamped the verdict on it. Measured on every registry-backed object, in
  **both** tenancy modes, at **both** read exits:

  ```
  _diagnostics: { valid: false,
    errors: [{ path: 'fields.organization_id', code: 'unrecognized_keys' }] }
  ```

  `_diagnostics` is what Studio renders invalid-metadata banners from and what an
  AI author reads to judge a document it produced. So the platform was reporting a
  defect on its own column — one the author never wrote and could not fix — and
  making the verdict useless as a signal on those objects, because a real
  authoring error was indistinguishable from this one.

  **Two directions, both of them user-visible:**

  - **The false `valid: false` verdict is gone.** A tenancy-enabled object
    registered through the real `SchemaRegistry` now reads back
    `_diagnostics: { valid: true }` at both `/meta` exits, in both tenancy modes.
    Nothing else about the served field changed — `type`, `reference`, and the
    governance keys that decide who may write it are byte-identical.
  - **The tenant index moved from a field-level flag to `indexes[]`**, the one
    surface an index is declared on in this system. On a multi-tenant stack the
    object now declares `{ fields: ['organization_id'] }`; on a single-tenant
    stack it declares **nothing** — the absence _is_ what `indexed: false` used to
    say, since nothing filters by organization on an unwalled stack.

  This is also the first time the intent is actually **enforced**. The sole reader
  of the old flag was one line in `driver-mongodb`; `driver-sql` — which every
  walled deployment runs — only ever materialized `indexes[]`, so the wall's
  hottest predicate ran unindexed no matter what the flag said. Expect the tenant
  index to now appear as ordinary index drift on existing SQL tables
  (`idx_<table>_organization_id`), created by `os migrate apply` or by the
  `autoMigrate: 'safe'` path in dev, like any other declared index.

  `driver-mongodb` reads declared `indexes[]` in place of the retired flag. The
  generated index name matches the field-level convention already in that file
  (`idx_<fields>` / `idx_<fields>_unique`), so a re-synced collection finds its
  existing `idx_organization_id` rather than building a second index under a new
  name. Declarations are materialized over their columns **verbatim** at every
  `unique` scope, `'organization'` included — the same call the driver's
  field-level `unique` documents, because it implements no row-level tenancy and
  refuses to boot into a multi-tenant deployment (#3724).

  No `FieldSchema` change: re-declaring `indexed` would restore exactly the
  declared-but-unenforced key #2377 removed.

- 8b50cb3: fix(data): a paged read with no `orderBy` is a partition too — the shape every list view actually sends (#4363)

  objectui#3106's server half closed the **sorted** paged read: a non-empty
  `orderBy` now carries a unique tie-breaker, so `ORDER BY status LIMIT 50 OFFSET
50` can no longer serve one row twice while never serving another. It stopped
  there deliberately. This closes the half it left, which is the more common one.

  A list view whose metadata configures no `sort`, on which nobody has clicked a
  column header, sends no `$orderby` at all. `SqlDriver` and `MongoDBDriver` then
  emitted a bare `LIMIT`/`OFFSET` — and neither backend promises anything about
  the order that slices:

  - **SQL** leaves the row order of an unordered read to the plan. Small tables
    hand back insertion order in practice, which is exactly why this survives
    testing; a parallel scan, an index scan, or a `VACUUM` need not.
  - **MongoDB** returns natural order, which describes where a document currently
    sits in its extent — and moves when the document does.

  Every row ties with every other on an empty sort key, so this is the same defect
  at full strength rather than a different one: page 2 repeats a row page 1 showed
  and drops one nobody sees, with every page full and every row real.

  Both drivers now order a paged read by their unique key column when the caller
  supplied no sort keys — the same `id` the tie-breaker was already appending, now
  standing alone. `driver-memory` again needed no change: it slices its backing
  array, and two reads with no write between them see the identical sequence. The
  contract asks for a partition, not for id order.

  **Unpaged reads are untouched, deliberately.** The rule keys off `limit`/
  `offset`, not off `orderBy` being absent. A read with neither hands back the
  whole matching set, so no caller can be shown a partial view of it, and sorting
  every read in the system would change plan selection to buy nothing. `limit`
  alone does count as paged: page one of a walk is routinely `limit=50` with no
  offset, and ordering only the later pages would leave the defect fully intact.

  `SqlDriver` keeps the existing restriction to objects it created itself
  (`initObjects` records them). It matters more here than for the sorted case: on
  a federated table (ADR-0015) there is no requested sort for #3821's ladder to
  fall back to, so a wrong guess about `id` would turn a reshuffle into a failed
  read. Those tables now get a warning — once per object, behavior unchanged —
  because the contract states determinism as a MUST, and a MUST that quietly does
  not hold is the same invisible failure the rule was written against.

  `findOne` is deliberately outside all of this, and the contract now says so.
  Engines reach a driver with `limit: 1`, which is shaped exactly like page one of
  a walk, but it promises _a_ matching record rather than a position in a
  sequence — nothing for a second call to be inconsistent with. Reading it as a
  page would put `ORDER BY id LIMIT 1` on the hottest read in the system, which is
  the classic shape for a planner to abandon the predicate's own index: measured
  on Postgres 16 over 2M rows, `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms
  and swapped the `owner_id` index for the primary key. `MongoDBDriver.findOne`
  has never sorted, so this also puts the two drivers back in step.

  The obligation is normative on `IDataDriver.find` and the cases are shared —
  `PAGINATION_UNORDERED_CASES` alongside `PAGINATION_CASES` in
  `@objectstack/spec/data` — so a future driver is held to both halves by a gate
  rather than by remembering.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/types@17.0.0

## 17.0.0-rc.6

### Major Changes

- 262e40d: refactor(drivers)!: memory / mongodb 的 `aggregate` / `distinct` 也收进 `DriverQuery`，契约没覆盖的方法不再要求把对象名写两遍 (#6212 批 C)

  #6210 的 changeset 结尾专门留了一句：`aggregate` / `distinct` **不在**那次范围内，因为它们不是 `IDataDriver` 收窄的那六个方法。#6212 记下了这笔账，本次结清 memory 与 mongodb 这两个包的部分。

  这批方法的第一个实参**已经是对象名**，query 里却仍旧要求再写一遍：

  | 位置                                        | 收窄前                              | 收窄后                                 |
  | :------------------------------------------ | :---------------------------------- | :------------------------------------- |
  | `MongoDBDriver.aggregate`                   | `query: QueryAST`                   | `query: DriverQuery`                   |
  | `InMemoryDriver.distinct`                   | `query?: QueryInput`                | `query?: DriverQuery`                  |
  | `InMemoryDriver.aggregate`                  | `Record<string, any>[] \| QueryAST` | `Record<string, any>[] \| DriverQuery` |
  | `InMemoryDriver.performAggregation`（私有） | `Omit<QueryInput, 'object'>`        | `DriverQuery`                          |

  因为 `QueryAST` / `QueryInput` 都把 `object` 声明成**必填**，一个手上只有 `where` 的调用方根本叫不出这个类型的名字，于是伸手去拿 `as any` —— 连 `where` / `orderBy` / `limit` 的检查一起关掉。这正是 #5181 记过账的那笔代价（cloud#1053 实测 20 处，cloud#1030 的 `$like` 就是从这个口子活到运行时的）。收窄之后调用方可以直接写字面量：

  ```ts
  // 收窄前：object 是必填，这句编译不过，于是 ... as any
  // 收窄后：直接过，且 where / orderBy / aggregations 逐个受检
  await driver.aggregate("order", {
    groupBy: ["region"],
    aggregations: [{ function: "sum", field: "amount", alias: "total" }],
  });
  ```

  同一次改动收回了 4 处已经多余的 `as any`（memory 2、mongodb 2），`check:query-options-erasure` 的测试面因此从 267 降到 263，baseline 已按门禁要求同 PR `--update`。

  **`InMemoryDriver.aggregate` 的联合刻意保留。** 两条分支都有活体生产者：mongo 管线数组那支由 `memory-analytics.ts` 喂，AST 那支由 objectql 引擎与 `@objectstack/verify` 的日期分桶探针喂。退役任何一支都会打断其中一条。

  **顺带把 `#6212` 正文的一处归因证伪了**：正文说 `performAggregation` 当初选 `Omit<QueryInput, 'object'>` 是被 `groupBy` 的元素类型差异逼的。实测 `QueryInput` 与 `QueryAST` 在 `groupBy` 上**逐字相同**，差异只在 `search` / `orderBy` / `expand`；直接换 `DriverQuery` 零报错。所以那不是被迫的选择，契约优先取 `DriverQuery`，不再引入第二个查询类型家族。

  **零运行时改动。** 非测试改动 100% 是类型注解，无逻辑、无行为、无 emit 差异（`as` 断言在编译期即被抹除）。测试全绿：memory 532、mongodb 206（另 137 条需真实 mongod，按既有 opt-in 规则跳过）。这也是 #5499 冻结面上被允许的处置口径 —— 与 #6210 在同一批驱动上走的是同一条。

  **迁移面：删掉调用字面量里的 `object:` 键**，与 #5181 / #6210 同一句话，现在覆盖到 `aggregate` / `distinct`。编译器会逐处指出来：

  ```
  error TS2353: Object literal may only specify known properties,
                and 'object' does not exist in type 'DriverQuery'.
  ```

  本仓实测只有一处需要改（`memory-driver.test.ts` 的 `distinct` 用例），且它写的值与第一实参逐字相等，纯冗余。

  标 major 的依据与 #5181 / #6210 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

- d367f03: refactor(drivers)!: 五个驱动的 query 参数跟进 `DriverQuery`，休眠的类型谎言就此没有藏身处 (#6075)

  #5181（PR #6076）把 `IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的 query 参数收窄为 `DriverQuery`（`Omit<QueryAST, 'object'>`），并在同一条 changeset 里写明：「把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾」。这就是那次收尾。

  在此之前，五个驱动的实现仍旧声明 `query: QueryAST`（turso 侧是 `query: any`）。**它不红，也不会红** —— 方法参数按双变比较，实现声明得比契约宽照样满足契约。但调用方现在**有权**省略 `object`，于是这些实现的类型说 `query.object` 是 `string`，运行期却可能是 `undefined`：一句休眠的谎言，没有任何门拦得住下一个照着它写代码的人。

  收尾之后，「驱动读 `query.object`」直接变成编译错误：

  ```ts
  // 收窄前：编译通过，运行期可能是 undefined —— 谎言
  // 收窄后：error TS2339: Property 'object' does not exist on type 'DriverQuery'.
  const name = query.object;
  ```

  **零运行时改动。** 本次改的全部是类型注解：五个驱动的六个契约方法签名，以及为让类型自洽而必须跟进的少量私有辅助方法参数（mongodb 的 `buildFindOptions` / `buildSortSpec`，sql 的 `findRows` / `orderKeysFor`，turso 的 `toRemoteQuery` / `toRemoteReadQuery`，memory 的 `performAggregation`）—— 它们都只转发或读取 `where` / `orderBy` / `groupBy` 这些字段，本来就不读 `object`。turso 的几处 `query: any` 一并收紧，多拿回一批本已放弃的检查。emit 无差异，测试全绿（memory 524、mongodb 206、sql 906、sqlite-wasm 254、turso 788）。

  **迁移面：删掉驱动调用字面量里的 `object:` 键**，与 #5181 是同一句话，只是现在也覆盖了直接按具体驱动类（`SqlDriver` / `MemoryDriver` / …）而非按 `IDataDriver` 取类型的调用方。编译器会逐处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。本仓下游 25 个包实测零处需要改动，改动只落在五个驱动自己的测试里。

  标 major 的依据与 #5181 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

  `aggregate` / `distinct` / `syncSchemasBatch` 不在本次范围内 —— 它们不是 `IDataDriver` 收窄的那六个方法，其中 `syncSchemasBatch` 的条目里 `object` 是被真实读取的必填键，`expand` 条目里的 `object` 同理命名的是关联对象，都不是冗余。

### Minor Changes

- 3f8817a: feat(spec,drivers,objectql,analytics,formula): `$icontains` reaches every JS evaluation face (#6520)

  The other half of #5702. That change implemented `$icontains` on the SQL family
  and correctly left the spec's `FILTER_OPERATORS` alone; this one adds the
  operator to that array and gives every remaining evaluation face an arm, in ONE
  change, because those two steps cannot be separated.

  **Why one PR.** `FILTER_OPERATORS` is not a word list, it is a runtime allowlist:
  `driver-memory`'s shape gate derives from it, and its matcher's `default:` arm
  assumes the gate already refused anything unimplemented. Measured on a branch
  that added the name early (#5701): the gate stopped refusing, the matcher fell
  through, and `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned
  `true` — the predicate silently dropped, every row matched. A dropped predicate
  does not narrow a query, it WIDENS it, and on an RLS read scope that is a
  permission bypass rather than a degraded feature (#3948). So the word list
  travels with the evaluators or not at all.

  **What now answers it**, all folding the same domain: `driver-memory` (query
  path, reference matcher, and the analytics/cube face), `driver-mongodb`,
  `objectql`'s `having`, `@objectstack/formula`'s `matchesFilterCondition` (the RLS
  write-side `check`), and `service-analytics`' three SQL compilers (the RLS
  lowering, the native-SQL strategy, and the `/analytics/sql` echo).

  **The fold is ASCII-only, and that is the contract, not an implementation
  detail** (#4706 Q1 = A). `$icontains: 'café'` does not match `CAFÉ`. Every face
  reads one shared definition — `foldAsciiCase` /
  `asciiCaseInsensitiveContains` / `asciiCaseInsensitiveRegexSource`, new exports
  on `@objectstack/spec/data` — because the two obvious per-package spellings are
  both wrong in the same direction: `toLowerCase()` folds the whole Unicode range,
  and so does a `RegExp` built with the `i` flag. SQLite folds ASCII only and three
  of the five drivers are SQLite underneath, so a Unicode fold on a JS face would
  re-open exactly the divergence the ruling closed. The pattern-binding faces
  (mingo, mongo) therefore emit one `[Aa]` character class per ASCII letter and
  pass NO flags; mongo's `$icontains` is the one arm in its family that does not
  set `$options: 'i'`.

  The comparand keeps the rules its SQL twin has: matched LITERALLY (`%`, `_` and
  regex metacharacters are ordinary characters), and refused when empty or
  non-string — an empty comparand matches every row, which is a predicate that
  constrains nothing.

  **User-visible effect.** A filter using `$icontains` now behaves the same on the
  in-memory double and on SQL, so an app whose tests run on one and whose
  production runs the other stops getting two answers from one filter. Downstream,
  #5814 (better-auth `Where.mode: 'insensitive'`) no longer hits a 400 on the
  memory double.

  Not changed, and still tracked: the `$contains` family still folds Unicode on
  `driver-memory`'s query path and `driver-mongodb` (#6682) — both remain DEBT rows
  in `scripts/check-driver-conformance.mjs`, now naming one open requirement each
  instead of two. `formula`'s unknown-operator posture stays a silent, fail-closed
  `false` (it governs a write-side check, where an unevaluable condition denies
  rather than widens); the decision and its limits are documented on
  `matches-filter.ts`, and no operator the spec DECLARES is answered that way any
  more.

- 82397b6: feat(drivers,objectql): `$regex` / `$options` are refused everywhere, and `$icontains` is implemented on the SQL family (#5702)

  The driver half of the #4706 ruling. #5701 landed the contract (the vocabulary,
  the `RETIRED_FILTER_OPERATORS` prescriptions, the shared text case-set) and
  #5710 flipped the last live producer — `plugin-auth`'s ObjectQL adapter, which
  emitted `$regex` on the authentication path — so the refusal can now land
  without breaking sign-in.

  **BREAKING for anyone writing `$regex` or `$options` in a filter.** Both are
  refused on every backend with `INVALID_FILTER` / 400 and a message that names
  the replacement. `$regex` was never a declared operator: `driver-sql` compiled
  it to a LIKE-escaped substring (so `a.b` matched only the literal `a.b`),
  `driver-memory` ran it as a real `RegExp` (so the same filter also matched
  `axb`, and an _invalid_ pattern was caught and answered `false` — zero rows, in
  silence), and `objectql`'s `having` did the same. Write `$icontains` for the
  case-insensitive substring search this was almost always used for, `$contains`
  for a case-sensitive one; a pattern that genuinely needs a regex has no
  filter-level replacement.

  **`$icontains` now runs on the SQL family** — `driver-sql`, `driver-sqlite-wasm`,
  and both of `driver-turso`'s transports (the remote one does not go through
  knex, so it needed its own). It compiles to `LOWER(col) LIKE LOWER(?) ESCAPE ?`
  through the same `applyLike` / `pushLike` that carries the `%` / `_` / `\`
  escaping, as a `fold` parameter rather than a second emitter — a copied emitter
  is where the escape class would have been dropped, and an unescaped `%` matches
  every row. An empty or non-string comparand is refused on the validating walk
  (an empty one matches every row, which widens rather than narrows). On SQLite
  `lower()` folds ASCII only, which IS the contract (#4706 Q1 = A): `$icontains:
'café'` does not match `CAFÉ`.

    <!-- adr-0087: registered filter-regex-options-retired -->

  `driver-mongodb`'s unknown-operator arm was throwing a bare `Error` with no
  `code` and no `status`, three lines from the helper in its own file that sets
  `INVALID_FILTER` / 400 — a 500-shaped body for a 400-class client mistake. It
  now speaks the same envelope as its three siblings.

  Two parts of the ruling are deliberately NOT in this change and stay tracked in
  `scripts/check-driver-conformance.mjs`'s ledger: the `$contains` family's
  case-sensitivity (#4706 Q2 = A) needs SQLite's `LIKE` replaced by a case-exact
  construct in the driver, the RLS lowering and the analytics lowering together,
  or one permission rule compiles to two row sets (#6518); and `$icontains` on the
  JS evaluation faces needs the spec vocabulary to take the operator, which cannot
  happen before `driver-memory` has an arm for it (#6520).

### Patch Changes

- 8825a06: drivers: `limit: 0` returns no records, on every driver and every read door

  `limit: 0` was ruled in #6485 to mean **return no records**. Three of the five shipped
  drivers did not honour it, in three different ways — and the ones that disagreed
  returned **more** data than was requested, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter. Reachable since #6578: the client now puts
  `top=0` on the wire, so the answer depended on which driver a deployment configured.

  **`driver-memory` — the slice was dropped.** `find()` sliced with `if (query.limit)`,
  truthiness, and `0` is falsy. Measured before the fix, three rows seeded:
  `{ limit: 0 }` returned **3 of 3**, and `{ limit: 0, offset: 1 }` returned 2 — the
  OFFSET applied and the LIMIT silently did not, which is why every paging suite stayed
  green over it. Two more sites of the same shape in `memory-analytics.ts` (the `$limit`
  pipeline stage and the SQL string builder) moved with it. Mingo honours `{ $limit: 0 }`
  as zero records (measured), so presence is sufficient there.

  **`driver-mongodb` — the value was forwarded faithfully, to a client that means
  something else by it.** `buildFindOptions` already tested presence, so `0` arrived
  exactly as written — but the MongoDB Node driver DEFINES `limit: 0` as _no limit_, so
  the answer was still the whole collection. Fixed with an explicit short-circuit that
  returns the empty result **before the client is consulted** (`[]` from `find`, `null`
  from `findOne`, which had the same hole). No round trip is made for a query whose
  answer is already known, and no future change in the upstream driver's reading of `0`
  can move this behaviour. Deliberately `=== 0`, not `<= 0`.

  **`driver-sql` — two doors disagreed with a third.** `findRows()`, the door `find()`
  goes through, has always compiled `limit` on presence. Two others compiled it on
  truthiness:

  - `findWithWindowFunctions()` — the live window-function read door (#4286). Returns
    rows, so this was user-visible wrong data: `{ limit: 0 }` returned the whole table.
  - `analyzeQuery()` / `explain()` — returns a plan. It compiled `select * from "orders"`
    where `find()` sent `... order by "id" asc limit ?`, so it explained a statement
    other than the one that would run.

  `offset` moved with `limit` at both doors for internal consistency only. That half is
  **measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
  and MySQL alike. It is pinned as the no-op it is rather than reported as a fix.

  **`driver-turso` remote transport — an `OFFSET` with no `LIMIT` was a syntax error.**
  Surfaced by the new conformance control that reads with a bare offset. SQLite's grammar
  is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses independently,
  so `find(obj, { offset: N })` with no `limit` produced `near "OFFSET": syntax error` —
  for **every** `N`, and only on the remote transport (the local half goes through knex,
  which synthesises the `LIMIT -1` no-limit sentinel). Remote now builds the same
  statement knex does.

  Result sets only ever get **narrower**. A caller who wants every row should omit
  `limit` rather than pass `0`.

  `@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
  case-set pinning this — with controls, so "return nothing, always" cannot pass it. All
  **five** drivers answer it, with **no DEBT rows**: future drift goes red at
  `check:driver-conformance` rather than being discovered in production.

- 3510e4a: refactor(spec,drivers,lint): one implementation of the filter identity reduction (#5659)

  `{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
  disjunct that absorbs its `$or`, `{ $not: {} }` is FALSE. That is a ruling
  (#5322/#5134) pinned for every backend by the four identity cases in
  `FILTER_LOGIC_CASES` — and it was implemented four times over: `reduceFilterNode`
  in `driver-sql`, the same function again in `driver-mongodb`, the
  `every`/`some`/truthiness algebra of `driver-memory`'s matcher, and nearly a
  fifth hand-written copy inside `@objectstack/lint`, which declined to write one
  and filed this issue instead.

  **New in `@objectstack/spec` (`@objectstack/spec/data`): `reduceFilterVerdict`**,
  beside the case table that proves it. It answers `'true' | 'false' | 'clause'`
  for a filter node and never throws on its own; each backend's own refusals — the
  undeclared `$`-combinator and the `undefined` comparand in `driver-sql`, the
  query-level keys and the `$null` comparand in `driver-mongodb` — are passed in as
  `FilterVerdictHooks` and are invoked from exactly the positions they were invoked
  from before. `reduceFilterKeyVerdict` answers the same question for one key, which
  is what both SQL and MongoDB emitters consult while walking a node.

  **No behaviour changes in the three drivers.** The move is mechanical: the shared
  algebra replaces each private copy, the refusals stay where they were, and the
  `FILTER_LOGIC_CASES` conformance suites are green on both sides of the change —
  including the SQL-inheriting `driver-sqlite-wasm` and `driver-turso`.

  **`@objectstack/lint` gains two warnings it was structurally blind to.** The
  `multi: true` unbounded-bulk-write rule (#5482) asked "does this filter have zero
  keys", so a `delete_record` bounded by `filter: { $and: [] }` or
  `filter: { $or: [{}] }` — a whole-object write by the ruling every driver executes
  — passed silently. It now asks the reduction, and it warns about both while
  staying quiet on `{ $or: [] }` and `{ $not: {} }`, which match nothing. The
  message names the shape it saw (`a filter that REDUCES TO TRUE ({"$and":[]})`)
  rather than calling a non-empty filter "empty".

  If you have a flow declaring a bulk write bounded by one of those two shapes, the
  lint will now tell you so — the write was already unbounded at run time; only the
  feedback is new.

- e13fd91: fix(objectql,driver-mongodb): declare the tenant index in `indexes[]`, so a registry-backed object stops reporting itself invalid (#6810)

  `applySystemFields` provisioned the injected `organization_id` column with
  `indexed: opts.multiTenant`. `indexed` is **not a `FieldSchema` key** — #2377 /
  ADR-0049 removed it because a field-level index flag built no index — and
  `FieldSchema` is a `strictObject`, so a field carrying it is rejected **by
  name**, with a purpose-written message.

  `registerObject` runs `applySystemFields` _before_ storing and
  `getItem('object', …)` serves that post-injection document, so the key travelled
  all the way out to `/meta`, where `decorateMetadataItem` re-parsed the served
  body and stamped the verdict on it. Measured on every registry-backed object, in
  **both** tenancy modes, at **both** read exits:

  ```
  _diagnostics: { valid: false,
    errors: [{ path: 'fields.organization_id', code: 'unrecognized_keys' }] }
  ```

  `_diagnostics` is what Studio renders invalid-metadata banners from and what an
  AI author reads to judge a document it produced. So the platform was reporting a
  defect on its own column — one the author never wrote and could not fix — and
  making the verdict useless as a signal on those objects, because a real
  authoring error was indistinguishable from this one.

  **Two directions, both of them user-visible:**

  - **The false `valid: false` verdict is gone.** A tenancy-enabled object
    registered through the real `SchemaRegistry` now reads back
    `_diagnostics: { valid: true }` at both `/meta` exits, in both tenancy modes.
    Nothing else about the served field changed — `type`, `reference`, and the
    governance keys that decide who may write it are byte-identical.
  - **The tenant index moved from a field-level flag to `indexes[]`**, the one
    surface an index is declared on in this system. On a multi-tenant stack the
    object now declares `{ fields: ['organization_id'] }`; on a single-tenant
    stack it declares **nothing** — the absence _is_ what `indexed: false` used to
    say, since nothing filters by organization on an unwalled stack.

  This is also the first time the intent is actually **enforced**. The sole reader
  of the old flag was one line in `driver-mongodb`; `driver-sql` — which every
  walled deployment runs — only ever materialized `indexes[]`, so the wall's
  hottest predicate ran unindexed no matter what the flag said. Expect the tenant
  index to now appear as ordinary index drift on existing SQL tables
  (`idx_<table>_organization_id`), created by `os migrate apply` or by the
  `autoMigrate: 'safe'` path in dev, like any other declared index.

  `driver-mongodb` reads declared `indexes[]` in place of the retired flag. The
  generated index name matches the field-level convention already in that file
  (`idx_<fields>` / `idx_<fields>_unique`), so a re-synced collection finds its
  existing `idx_organization_id` rather than building a second index under a new
  name. Declarations are materialized over their columns **verbatim** at every
  `unique` scope, `'organization'` included — the same call the driver's
  field-level `unique` documents, because it implements no row-level tenancy and
  refuses to boot into a multi-tenant deployment (#3724).

  No `FieldSchema` change: re-declaring `indexed` would restore exactly the
  declared-but-unenforced key #2377 removed.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- c7406b0: fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

  `FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
  授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
  钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

  ## 改了什么

  进入运行时的门有两扇,过去只有一扇按契约读:

  | 门                                                                                                | 改前                                                                                                                               | 改后                                                                                            |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | **Door 1** —— 协议/HTTP 面(`metadata-protocol`)                                                   | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER`                                                             | 不变                                                                                            |
  | **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动                                                                                                             | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
  | 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`)            | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400                                              |

  一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
  `RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
  删掉方言后两侧自然合流。

  ## 授权面:零变化

  `FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
  `filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
  这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

  ## ⚠️ 可观察的行为变更

  1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
     声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
  2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
     照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
     `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
     返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
  3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
     变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
  4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
     导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
     注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
     挡住这个输入,所以拒收必须在运行时。
  5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
     (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
     AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

  ## 删除的代码面

  - `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
  - `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
  - `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
  - `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

  `[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。

### Patch Changes

- 06ba036: feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

  `TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
  `objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
  公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
  的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
  `fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
  在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

  **新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
  带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
  `RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
  驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
  不要凭据（remote 面走包内的 sqlite stub）。

  **留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
  `vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
  `MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
  一部分，只是曾经同包而已。

  **目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
  `driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
  `knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
  `repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

  这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
  迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
  filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
  `LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
  补齐工作跟踪在 #5590。

- 71f205d: fix(driver-mongodb): 空 `$and` / `$or` / `$not` 按布尔单位元归约,非 filter 节点先响亮拒收 (#5239)

  `translateFilter` 过去把组合子数组**原样透传**给 MongoDB。而 MongoDB 对空数组既不答
  TRUE 也不答 FALSE,是第三种行为:**直接拒绝整条查询**(`$and/$or/$nor must be a
nonempty array`)。于是 `{ $and: [] }` 与 `{ $or: [] }` 一路走到 `find` /
  `countDocuments` / `updateMany` / `deleteMany`,变成一个不带 ADR-0112 错误码的服务端
  异常 —— 而 `driver-sql`(#5134 / PR #5243)、`driver-memory`、`formula` 三家早已按单位
  元作答。

  改成与它们同一套**结构性三值归约**:先把整棵 filter 树判成 `true` / `false` /
  `clause`,再据此产出。空 `$and` 归约为 TRUE(不产出条件),空 `$or` 归约为 FALSE 并产出
  一个**真实的零行条件** `{ _id: { $in: [] } }` —— 关键在于「什么都不产出」等于 `{}`,而
  `find` / `updateMany` / `deleteMany` 把 `{}` 读作**全部文档**,方向正好相反。`{}` 作为
  `$or` 的分支仍是 TRUE 析取项,`{ $not: {} }` 仍是零行,这两条 MongoDB 本来就与布尔代数
  一致,所以归约按结构做而不是只判 `length === 0`。发出的每个 `$and` / `$or` 数组因此都保
  证非空。

  **同一改动里的形状拒收**,顺序是先拒收后归约:单位元把「这个节点没有谓词」读作「匹配全部
  文档」,所以空节点必须只有一个成因。改前实测,本驱动这一格比 `driver-sql` 当年更糟 ——
  `{ $or: [new Date()] }` 译成 `{ $or: [{}] }`,即**每一份文档**;`{ $or: 'x' }` 与
  `{ $not: null }` 译成 `{}`,同样是每一份文档。`updateMany` / `deleteMany` 走的是同一个
  translate 层,在那里「放宽到全部文档」不是行数不对而是数据丢失。现在这类操作数按
  ADR-0112 以 `INVALID_FILTER` / `status: 400` 拒收,并在消息里点出位置
  (`filter.$or[0]`)。`Date` / `RegExp` / class 实例都满足 `typeof x === 'object'` 却枚举
  为空,故判定按**原型**而非 `typeof`。

  `packages/spec` 侧只动文档:`FilterConditionSchema` 的契约 TSDoc 写明 `$not` 的
  **NULL-safe** 语义(#5146 维护者拍板 —— 被比较列为 NULL 的行不满足被否定的条件,应当被
  返回,即 `NOT (…) OR col IS NULL`),并在 `filter-logic-conformance.ts` 记下三族已裁定但
  **尚未进表**的 case 及其实测矩阵。无运行时行为变化,无 API 变化。

- 9c5abf4: fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

  Two shapes the Filter Protocol never declared were reaching the drivers, and
  every driver ANSWERED them — with a different answer. Both are now refused with
  `INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
  already speaks.

  ## `$null` with a non-boolean comparand — a behaviour change you can observe

  `FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
  default branches hung on opposite sides, so one filter meant opposite things per
  backend. Measured against one row with `stage: 'won'` (id 1) and one with
  `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

  | backend                                     | read as                           | rows        |
  | ------------------------------------------- | --------------------------------- | ----------- |
  | driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`)    | `["2"]`     |
  | driver-memory query path, driver-mongodb    | IS NOT NULL (anything but `true`) | `["1"]`     |
  | driver-memory reference matcher             | no constraint at all              | `["1","2"]` |

  **What changes for you:** a caller that today gets rows back for
  `{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
  operator, the field and the position. That includes calls working by truthy /
  falsy coincidence — and the sharpest case is the STRING `"false"`, which is
  truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
  the opposite of what its author wrote it to mean, on at least one of them
  whichever they meant. A JSON round-trip or generated metadata produces it
  readily.

  **The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
  `{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
  backends, and so is every other operator. `$exists` is deliberately NOT tightened
  here — it diverges on its own axis (what "exists" means for a null-valued key)
  and is tracked separately.

  ## An undeclared `$op` in a document position — silent empty set becomes a 400

  `FilterConditionSchema` declares exactly three `$`-keys at a node
  (`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
  compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
  `{ $expr: … }` produced a predicate that matched nothing and reported nothing —
  a caller could not tell "no rows matched" from "the filter never compiled". The
  FIELD position had refused the same class of input since v16, so one driver gave
  two answers depending on depth.

  **What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
  returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
  (and `driver-sqlite-wasm`, which inherits it) into line. The three declared
  combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
  and every legal filter compile byte-identically.

  Both refusals are raised on the driver's validating walk rather than in its SQL
  emitter, so a malformed node is refused regardless of whether a sibling
  disjunct would have short-circuited the compile.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- c6d1cb4: refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

  `findStream` was a **required** method on the driver contract — every driver and
  every test double had to implement it — documented as the read

  > Optimized for large datasets to avoid memory overflow.

  Three things were true about it at once, and each is worse in the light of the
  others.

  **Nothing called it.** Not the query engine (there is no `stream` entry on it),
  not REST export, not import, not any bulk-read path. Repo-wide, outside the
  contract declaration and the three driver implementations, every single hit was
  a test double — and roughly twenty of those satisfied the required method like
  this:

  ```ts
  findStream() { throw new Error('not implemented'); }
  ```

  Twenty stubs that throw, across four packages, for years, and no test ever went
  red. That is not an anecdote about test hygiene; it is the proof of absence. A
  method whose every double throws is a method nothing reaches.

  **Two of the three implementations inverted its one guarantee.** `SqlDriver` and
  `InMemoryDriver` both did this:

  ```ts
  const results = await this.find(object, query, options); // ← the entire result set
  for (const row of results) yield row;
  ```

  The whole table is resident in memory before the first `yield`. A caller who
  believed the doc comment and reached for `findStream` precisely because a result
  set was too large would have hit the overflow it existed to prevent, at exactly
  the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
  admitting it.

  **The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
  did walk a cursor — but it was the only read in that driver never routed through
  `buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
  discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
  and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
  that divergence rather than fixing it — there is nothing left to fix it for.)

  Rather than manufacture a caller to justify three implementations, the method is
  retired. If a cursor-based read is wanted, it should arrive **with** the caller
  that needs it, so the contract can be shaped by a real requirement instead of
  being reverse-engineered from a doc comment nobody could test.

  **Migration.**

  | Wrote                                                      | Write instead                                              |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
  | `findStream(…) { … }` on your own driver                   | delete the method (see below)                              |
  | `findStream() { throw new Error('ni'); }` in a test double | delete the line                                            |

  Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
  and memory it is strictly better (bounded pages instead of one full
  materialisation), and the paged read is the one with an **enforced** guarantee —
  `IDataDriver.find` requires a total order across the whole walk, checked by the
  shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
  `data/pagination-conformance.ts`. `findStream` never had a conformance case at
  all.

  **Driver authors: nothing breaks on you.** An implementation left in place still
  compiles — an extra method is not an error on a class or a widened object — it is
  simply never reached, so deleting it is cleanup you can do whenever. The break is
  on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
  were no callers.

  **No tombstone, deliberately.** The other v17 retirements tombstone their key so
  authoring it fails loudly with a prescription. That would be noise here.
  `DriverInterfaceSchema` describes a contract that code _implements_; nothing in
  either repository ever ran a driver object through `.parse()`, so a
  `retiredKey()` there would carry its prescription to no one. The channel that can
  carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
  The key is removed from the schema and from `IDataDriver`, and the retirement is
  registered as the `data-driver-find-stream-retired` semantic entry in the
  protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool all carry it. There is no
  `os migrate meta` step: a driver is code, never stack metadata, so the chain has
  no source to rewrite.

  **Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
  whose only referent was this method. It has no readers either (and the values
  written into it were already wrong — `SqlDriver` declared `streaming: false`
  while implementing `findStream`, `InMemoryDriver` declared `true` for the
  copy-everything version), but removing a key from the capabilities literal breaks
  every driver that writes it, third-party included, and the same audit should
  cover the other ~30 flags in one pass rather than one at a time. Tracked as
  #4634.

- d9fa683: refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

  The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
  described a contract method that no longer exists — and a full liveness audit of
  the record (#4634, across objectstack + cloud, objectui confirmed clean) found
  `streaming` was not the exception but the rule. Of 34 declared bits, **three**
  have a decision-making reader and **thirty-one** were written by every driver
  and consulted by no engine, planner, REST layer or renderer:

  - Their `.describe()` strings promised engine adaptation that was never built
    ("If false, ObjectQL will fetch all records and filter in memory" — no such
    fallback ever keyed off the bit).
  - Zero readers let values go WRONG unnoticed: `SqlDriver` declared
    `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
    `streaming: true` over a full-table read — the exact inverse of the guarantee.
  - The real mechanism everywhere else is **method presence**: transactions gate
    on `driver.beginTransaction`, aggregate pushdown on
    `typeof driver.aggregate === 'function'`, schema sync on
    `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
    are called unconditionally.

  Survivors (each with a named reader — the bits method presence cannot carry):

  | bit                    | reader                                                                                   |
  | ---------------------- | ---------------------------------------------------------------------------------------- |
  | `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
  | `autonumber`           | engine defers autonumber generation to the driver (`engine.ts`)                          |
  | `batchSchemaSync`      | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`)              |

  Migration (FROM → TO):

  - Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
    `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
    `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
    `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
    `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
    `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
    `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
    literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
    tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
    error against `IDataDriver.supports` and a parse error carrying the per-key
    prescription, which names the mechanism that actually decides the behaviour.
  - `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
    already meant `false` at both readers, so `supports: {}` is now a valid,
    minimal advertisement. If you read `capabilities.batchSchemaSync` from a
    _parsed_ config and relied on the materialised `false`, treat absence as
    `false` (both engine readers always did).
  - Driver packages: `InMemoryDriver.supports` is now `{}`,
    `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
    is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
    Reading a removed bit off these literals no longer type-checks — and no code
    in any repository did.
  - A future capability (streaming reads, vector search, …) returns **with its
    caller and its reader in the same change** — the enforce route of ADR-0049 —
    never as a dangling boolean.

  The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
  (parse + `tsc` both audible; the schema IS parsed via
  `DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
  semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
  never stack metadata — `supports` lives in driver classes and `DriverConfig`
  is plugin TS configuration, so there is no stored row or stack source for a D2
  conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
  retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
  lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
  asserting every retired bit is unwritable (`undefined`) and every live bit is
  not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
  resurrection).

  No runtime behaviour changes — that impossibility is the point: every removed
  bit had zero readers, and the three live bits keep theirs.

### Patch Changes

- 9b43ee2: test(drivers): the filter-logic standard now covers the backend it was counted without (#4405)

  `FILTER_LOGIC_CASES` (#3774) opens by calling itself the standard "the four
  independent FilterCondition backends are each checked against". Five backends
  exist. `driver-mongodb`'s `translateFilter` was missed, not excluded — an
  independent implementation whose `$and`/`$or`/`$not` translation shares no line
  of code with the SQL compiler or the in-memory matcher, and the only one whose
  target language cannot spell the standard directly: MongoDB has no
  document-level `$not` at all (the server answers `unknown top level operator:
$not`), so a negation has to leave as `$nor`, and a branch's own keys have to
  stay in one document while `$and`/`$or` clauses are lifted beside them. That
  route was never checked against the shared cases. Both DEBT rows the #4363 gate
  recorded are now cleared, and `scripts/check-driver-conformance.mjs` reports
  `ok` for every cell of the matrix.

  **`driver-mongodb` runs the table twice, and the split is deliberate.**
  `mongodb-filter-logic-translation.test.ts` drives every shared case through
  `translateFilter` and evaluates the emitted MongoDB _document_ over the shared
  fixture — a pure function, no server, so it always runs. That matters here more
  than anywhere: `mongodb-memory-server` downloads a ~123 MB binary from
  fastdl.mongodb.org, and a defect only a downloadable binary can catch is a
  defect nobody catches on a restricted network. Its in-process reader is strict
  by construction — every shape it does not model throws instead of evaluating to
  true, a document-level `$not` included — and its own discrimination is pinned by
  cases that require a widened document to FAIL the case it widens, so "all green"
  cannot mean "the reader says yes to everything".
  `mongodb-filter-logic-conformance.test.ts` runs the same table against a real
  mongod and answers the one question the first half cannot — does MongoDB agree?
  — skipping cleanly (never silently) when the binary is unreachable.

  **`driver-sqlite-wasm` runs the table through its own engine.** It inherits
  `SqlDriver`'s filter compiler, so nothing is re-implemented; what the suite pins
  is that a nested `(… AND …) OR (… AND …)` survives the custom sql.js dialect
  that compiles, binds and marshals it — the same seam its temporal and pagination
  suites cover for their clauses. Tracked as DEBT rather than EXEMPT because
  "inherits, therefore fine" is the assumption those suites exist to disprove; the
  suite is what disproves it.

  **No divergence was found.** `translateFilter` answers all seventeen shared
  cases correctly today, `$not`-inside-a-branch and nested `$and`-inside-`$or`
  included, so no translation change ships here — what changes is that the next
  edit to it cannot quietly widen a filter. Both suites were verified to be
  discriminating rather than decorative by reintroducing the #3774 miscompile
  (propagating `or` into a branch's own contents): 15 of the mongodb translation
  suite's 26 tests fail, and 13 of the wasm suite's 18.

  `packages/spec`'s `filter-logic-conformance.ts` header now says five and names
  the fifth — a code comment; no schema, export or generated artifact moved.

- ec975f1: fix(objectql,driver-mongodb)!: `findOne` must say which record it wants, and executes every option it declares (#4419)

  `findOne` reads a single row, which makes its predicate the only thing between
  the caller and _an arbitrary record_. When the predicate is missing the result is
  not `null` — it is the object's **first row**: a real, plausible-looking record
  with nothing to do with the request, which the `if (!row)` check every call site
  already has cannot catch, and which then propagates into whatever is computed
  next. Reported downstream: line items defaulting their price from the first
  product in the catalog rather than the selected one, and "is this deal already
  closed?" answered against an unrelated record while the write that followed
  correctly targeted the intended id. A throw would have been caught in
  development; a `null` would have been caught by the null-check. A valid-looking
  wrong record defeats both.

  **Breaking — `findOne` now refuses a query that selects nothing in particular.**

  FROM → TO:

  | Was                                                         | Now write                                                           | Meaning                                          |
  | ----------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
  | `findOne(o)`, `findOne(o, {})`, `findOne(o, { where: {} })` | `findOne(o, { where: … })`                                          | the record matching this predicate               |
  |                                                             | `findOne(o, { search: 'Acme' })`                                    | the record this search finds                     |
  |                                                             | `findOne(o, { orderBy: [{ field: 'created_at', order: 'desc' }] })` | the FIRST record in this order — the newest      |
  |                                                             | `find(o, { limit: 1 })`                                             | any row will genuinely do, said at the call site |

  One-line fix: add the `where` you meant, or `orderBy` if you meant "the newest
  one", or switch to `find(o, { limit: 1 })` if any row will do. The error names
  all four. `find` and `count` are unchanged — returning or counting every row is
  an honest answer; only `findOne`'s implicit "just one of them" turns a missing
  predicate into a confidently wrong record. The guard reads the CALLER's
  predicate, before RLS/sharing middleware injects its own: a tenant filter
  narrows which rows are visible, it does not make "whichever comes first"
  something the caller asked for.

  **Two silent drops that produced the same wrong record are fixed with it.**

  - **`findOne({ search })` applies the search.** The ADR-0061 `search` →
    cross-field `$contains` expansion lived inline in `find` and nowhere else,
    while `find` and `findOne` are checked against the SAME legal-key set — so
    `search` passed the gate, rode onto the AST, and reached a driver. No driver
    reads `ast.search`. The read therefore ran with no predicate at all and
    `limit: 1` did the rest. The expansion is now one method both call.
  - **`MongoDBDriver.findOne` applies `orderBy`, `fields` and `offset`.** It
    translated `query.where` and dropped the rest, so `findOne({ orderBy })` did
    not return the newest record — it returned whichever document the scan reached
    first. `find` and `_findStream` in the same driver had always handled all
    three. This one matters beyond Mongo: the guard above tells an unpredicated
    caller to reach for `orderBy`, and an escape hatch one backend ignores is not
    an escape hatch. No ordering is IMPOSED when the caller supplies none — both
    drivers keep that carve-out (#4363), and `SqlDriver`'s comment about Mongo
    "never sorting" is corrected, since it cited the dropped parameter as
    agreement.

  **And a gate so the class does not come back.** A drift pin walks
  `ENGINE_OPTION_KEY_SETS.findOne` and requires each declared key to have an
  observable effect — on the AST the driver receives, on the driver options, or in
  an explicit "not executed, and here is why" entry (only `limit`, which the
  contract's `limit: 1` overrides). `search` sat declared-but-unexecuted through
  two rounds of hardening because nothing asked that question.

  Together with #4346 (`filter` → `where` folds on every entry point) and #4400
  (unknown option keys throw), a read parameter the engine does not execute now
  fails at the call site instead of quietly changing the answer.

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- b3a2318: fix(driver-memory,driver-mongodb): a bare-day upper bound covers the whole day (#4042)

  The non-SQL half of #3777's calendar-day rule. Both drivers compiled a bare
  `YYYY-MM-DD` `$lte` (and a `between` max) as-is, so on timestamp values the
  window cut off at the final day's midnight — the dashboard date-range filter's
  default configuration (`created_at`, 7 of 13 presets ending "today") lost the
  current day, exactly as it did on SQL before #3777 was fixed.

  Both drivers now compile a bare-day upper bound half-open, sharing
  `nextUtcCalendarDay` from `@objectstack/core`:

  - `driver-memory`: the Mongo-style and array `where` spellings in the mingo
    lowering (`$lte`/`<=` → `$lt` next day; `$between`/`between` max the same),
    the analytics cube-filter `lte`, and the analytics `dateRange` window — which
    now also matches BOTH stored forms of a timestamp (ISO strings and `Date`
    objects) instead of only `Date`s, since mingo compares cross-type as
    never-equal.
  - `driver-mongodb`: the `translateFilter` lowering, all three spellings
    (`$lte`, `$between`, array `<=`/`lte`).

  Unchanged on purpose, matching the #3777 semantics table: full-ISO/`Date`
  comparands keep instant semantics, and `$gte`/`$gt`/`$lt` keep their midnight
  anchoring. Known remaining gap (tracked separately): values stored as BSON
  `Date` (mongodb) or JS `Date` (memory `find()`) never match _string_ comparands
  of any operator — a storage-form problem, not a bound-semantics one.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 9e8f04d: fix(driver-memory,driver-mongodb): `Field.datetime` has one storage form per driver (#4047)

  The non-SQL counterpart of ADR-0053 D-B (#3912). Both drivers let the writer
  decide a datetime value's runtime type, and both compare across types by type
  bracket rather than by value — so a string comparand never matched a `Date`
  value, in either direction, for **every** operator including `$gte`.

  A datetime column genuinely held both forms: the drivers' own
  `created_at`/`updated_at` defaults bind a `Date` (mongo) or an ISO string
  (memory), while REST/JSON writes, relative-date tokens and `initialData`
  fixtures supply the other. A dashboard date window therefore answered with
  whichever half happened to match the comparand's type — on MongoDB, where
  `created_at` is a BSON `Date` and dashboard bounds are strings, that meant
  **no rows at all**, which is worse than the final-day loss #3777 fixed.

  Each driver now has one canonical form, applied on write and to every filter
  comparand:

  | Driver           | `datetime`                                                                                                           | `date`            |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
  | `driver-mongodb` | BSON `Date` — the dialect's native instant, its `timestamptz`                                                        | `YYYY-MM-DD` text |
  | `driver-memory`  | canonical UTC ISO text (sorts chronologically under the string comparison mingo performs; survives JSON persistence) | `YYYY-MM-DD` text |

  Both learn their temporal fields from `syncSchema`, so an object that was never
  declared is left exactly as written — the drivers do not guess types from
  values. `driver-memory` additionally converges rows already in the table when
  the schema arrives, which catches `initialData` fixtures and anything a
  persistence adapter restored (the in-memory analogue of
  `backfillCanonicalDatetimes`, and idempotent like it).

  `Field.date` deliberately stays timezone-naive text on both — converting it to
  an instant would invent a midnight and re-couple it to a zone. The
  calendar-day bound semantics from #3777/#4042 are unchanged and now compose
  with the converged storage: the whole-day rewrite runs on the calendar string
  first, and only the resulting bound is converted to the storage form.

- e59786e: fix(spec): five exported symbols resolved to `any` — type the recursive schemas and gate it in CI (#4171)

  A recursive Zod schema needs an explicit annotation to break its circular
  inference, and five of them took the cheapest one available:

  ```ts
  export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => …);
  export type NavigationItem = z.infer<typeof NavigationItemSchema>;   // → any
  ```

  It compiles, it validates correctly at runtime, and it silently throws the type
  away. `NavigationItem`, `FormField`, `JoinNode` and `NormalizedFilter` were all
  `any` on the published surface, plus `FieldNodeSchema` — which had no exported
  type alias yet, so `z.infer<typeof FieldNodeSchema>` was `any` and
  `QueryAST['fields']` with it.

  That is worse than a missing export. #4115 tells every consumer that a local
  declaration under a spec export's name must be replaced by a binding to the
  spec — and for these, obeying it **replaced a precise type with `any`**.
  objectui's `NavigationItem` is a 118-line documented interface (`recordId`
  template variables, `requiresObject` / `requiresService` capability gates,
  `filters` precedence); every key of it exists in the spec's version, so by every
  available signal it read as a redundant fork safe to delete. Deleting it swapped
  a fully-typed interface for `any`, with no compile error anywhere to say so.

  It is hard to catch by inspection because `any` is mutually assignable with
  everything, so the natural "are these the same type?" check answers _yes_ in both
  directions and recommends precisely the wrong action. Same failure family as
  #4075's `[key: string]: any` on `ActionDef`: a type that agrees with everything
  reads as agreement.

  **Now annotated with the real type**, using the pattern `QueryAST` already
  follows in `data/query.zod.ts` — infer the non-recursive part, tie the recursive
  knot in the type, so the keys stay derived from the schema instead of being
  hand-maintained beside it:

  ```ts
  const BaseXSchema = z.object({ …every non-recursive key });
  export type X = z.infer<typeof BaseXSchema> & { children?: X[] };
  export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({
    children: z.array(XSchema).optional(),
  }));
  ```

  `z.infer` now resolves to the type it should always have been: `NavigationItem`
  is the nine-branch discriminated union, `FormField` the 30-key form-field
  contract (with `visibleOn` absent by construction — ADR-0089 D2 folds it into
  `visibleWhen` at the boundary), `JoinNode` and the newly exported `FieldNode`
  the query AST nodes, `NormalizedFilter` the normalized filter AST. Runtime
  validation is unchanged: every schema parses exactly what it parsed before.

  **What the types immediately caught**, none of it visible while they were `any`:

  - `account.app.ts` set `defaultOpen` on three nav groups — a key the spec has
    never declared. It worked only because objectui's `NavigationRenderer` still
    falls back to that legacy alias. Fixed at the producer per Prime Directive
    #12: the canonical key is `expanded`.
  - The MongoDB driver built its projection with `projection[field] = 1` over
    `query.fields`, so a relationship `FieldNode` would have keyed the projection
    on `"[object Object]"`. It now reads the node's field name.
  - `setup.app.ts`, `studio.app.ts` and `setup-nav.contributions.ts` are annotated
    with the PARSED `App` / `NavigationContribution` types but omitted
    `.default()`ed keys (`expanded`, `target`), as did the form fields
    `metadata-protocol` synthesizes for `getUiView` (`span`). Each now states the
    default it was relying on, matching what the surrounding literals already do
    for `active` / `isDefault` / `collapsible` / `collapsed` / `columns`.

  **Gated, not just fixed** (`check:exported-any`, wired into the required
  `TypeScript Type Check` job). `api-surface.json` records that an export _exists_
  and never what it _resolves to_, which is how these survived a whole major with
  every gate green. The new scan reads the built `.d.ts` a consumer's import
  actually resolves to and fails on any exported type that resolves to `any` — or
  any exported schema whose output is `any`, the root cause, and the only reason
  `FieldNodeSchema` was visible at all. Its `KNOWN_ANY` ledger is shrink-only and
  currently empty. It self-tests against the real zod first, so if the internals it
  reads are ever renamed the gate fails loudly instead of quietly passing
  everything forever.

- a13827e: fix(data): paging a sorted read is a partition of the result set, not five queries that share a WHERE clause (objectui#3106)

  `ORDER BY status LIMIT 50 OFFSET 50` names a sort key that does not identify a
  row, and no backend promises that rows with equal keys keep the same relative
  arrangement between two queries. MongoDB documents this outright — `sort` +
  `skip`/`limit` on a non-unique key "may return the same document more than
  once". So page 2 could repeat a row page 1 already showed and skip one nobody
  ever saw:

  ```
  page 1: ORDER BY status LIMIT 5 OFFSET 0   -> [r05 r07 r11 r04 …]
  page 2: ORDER BY status LIMIT 5 OFFSET 5   -> [r04 …]        r04 again; one row never served
  ```

  Every page is full, every row is real and belongs, and the duplicate sits
  several screens from the omission — which is why this is found by a user
  counting records, never by reading a response.

  `SqlDriver` and `MongoDBDriver` now append a unique tie-breaker to any non-empty
  `orderBy`, in the last requested key's direction (determinism holds either way,
  but a same-direction suffix is the one an index can still walk in one pass).
  `driver-memory` already conformed — `Array#sort` is stable over a table whose
  order does not move — and now has a suite saying so, because that property is
  implicit and easy to lose in a refactor that looks like a speed-up.

  `SqlDriver` adds it only for objects it created itself (`initObjects` records
  those). A federated table (ADR-0015) may have no `id` column, and guessing there
  would be worse than doing nothing: the unknown-column error is answered by
  #3821's ladder retrying with **no ORDER BY at all**, trading a reshuffle among
  ties for the loss of the caller's whole sort.

  The obligation is now normative on `IDataDriver.find`, with shared cases in
  `@objectstack/spec/data` (`PAGINATION_CASES`) that all three drivers run — so a
  future driver is held to it by a gate rather than by remembering.

  Not covered by this change: a paged read with **no** `orderBy`. Same defect,
  wider blast radius, so it was carved out to #4363 rather than folded in — and
  closed there, in the same release. The contract, the shared cases and both
  drivers now cover a paged read whatever its `orderBy`, including none at all.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                              |
  | :---------------------------------------------------------------- | :--------------------------------------------------------------- |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`        |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                              |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | `fields: ['owner.name']` (dotted path)                           |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias` |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- 6038de7: feat(spec,drivers): the temporal conformance matrix gains its `Field.time` axis — and `time` finally gets a storage form off SQL (ADR-0053 D-A3.2)

  `@objectstack/spec/data` gains `TEMPORAL_TIME_ROWS` / `TEMPORAL_TIME_CASES`,
  the wall-clock half of the shared matrix. A time gets its own table rather than
  a third `kind` on the existing one because it shares no comparand vocabulary
  with the other two: no relative token resolves to a wall clock, and the
  bare-day whole-day rule (#3777) must **not** reach it — which the table now
  asserts rather than assumes, since "the rule leaked into the wrong field type"
  is exactly what a conformance matrix is for. The fixture is a business day
  carrying the boundaries #3994 measured: both window edges, the pair straddling
  the millisecond-suffix width change, midnight and `23:59:59.999`.

  **The axis found a real gap on its first run.** ADR-0053 D-C gave `Field.time`
  a canonical form on every SQL dialect, but `driver-memory` and
  `driver-mongodb` were never extended — both declared
  `TemporalFieldKind = 'datetime' | 'date'`, so a `time` column was never
  classified and never coerced. It therefore held whatever each writer produced,
  and both stores compare across types by bracket: a text bound matched no
  `Date`-written row, in either direction, for every operator. Measured on
  `driver-memory`, **8 of the 9 shared cases** returned only the text-written
  half — a business-hours window answering `[d_mid, f_close]` instead of
  `[c_open, d_mid, e_mid_ms, f_close]`. This is #4047's failure one field type
  over, and it survived #4047 because that work extended `datetime` and `date`
  without revisiting `time`. On mongo it was also a documentation failure: that
  module's canon table has listed `time` as `HH:MM:SS[.fff]` text since #3994,
  and nothing implemented it.

  Both drivers now carry `storageTimeValue`, mirroring the SQL
  `canonicalTimeOfDay`: `HH:MM:SS`, `.fff` only when the milliseconds are
  non-zero, a `Date` / epoch / full-timestamp folding to its **UTC** time-of-day
  (never the host's), and totality — an out-of-range wall clock like `'25:00'`
  passes through rather than being silently rewritten. Text on both, mongo
  included: a wall clock is not an instant, so a BSON `Date` would invent a
  calendar day and a zone the author never wrote.

  If you have existing `time` data on either driver, values written as `Date`
  objects converge to canonical text on their next write; reads of un-migrated
  documents are unchanged. Filters were already unable to reach the mixed half,
  so no query that worked before stops working.

- 8b50cb3: fix(data): a paged read with no `orderBy` is a partition too — the shape every list view actually sends (#4363)

  objectui#3106's server half closed the **sorted** paged read: a non-empty
  `orderBy` now carries a unique tie-breaker, so `ORDER BY status LIMIT 50 OFFSET
50` can no longer serve one row twice while never serving another. It stopped
  there deliberately. This closes the half it left, which is the more common one.

  A list view whose metadata configures no `sort`, on which nobody has clicked a
  column header, sends no `$orderby` at all. `SqlDriver` and `MongoDBDriver` then
  emitted a bare `LIMIT`/`OFFSET` — and neither backend promises anything about
  the order that slices:

  - **SQL** leaves the row order of an unordered read to the plan. Small tables
    hand back insertion order in practice, which is exactly why this survives
    testing; a parallel scan, an index scan, or a `VACUUM` need not.
  - **MongoDB** returns natural order, which describes where a document currently
    sits in its extent — and moves when the document does.

  Every row ties with every other on an empty sort key, so this is the same defect
  at full strength rather than a different one: page 2 repeats a row page 1 showed
  and drops one nobody sees, with every page full and every row real.

  Both drivers now order a paged read by their unique key column when the caller
  supplied no sort keys — the same `id` the tie-breaker was already appending, now
  standing alone. `driver-memory` again needed no change: it slices its backing
  array, and two reads with no write between them see the identical sequence. The
  contract asks for a partition, not for id order.

  **Unpaged reads are untouched, deliberately.** The rule keys off `limit`/
  `offset`, not off `orderBy` being absent. A read with neither hands back the
  whole matching set, so no caller can be shown a partial view of it, and sorting
  every read in the system would change plan selection to buy nothing. `limit`
  alone does count as paged: page one of a walk is routinely `limit=50` with no
  offset, and ordering only the later pages would leave the defect fully intact.

  `SqlDriver` keeps the existing restriction to objects it created itself
  (`initObjects` records them). It matters more here than for the sorted case: on
  a federated table (ADR-0015) there is no requested sort for #3821's ladder to
  fall back to, so a wrong guess about `id` would turn a reshuffle into a failed
  read. Those tables now get a warning — once per object, behavior unchanged —
  because the contract states determinism as a MUST, and a MUST that quietly does
  not hold is the same invisible failure the rule was written against.

  `findOne` is deliberately outside all of this, and the contract now says so.
  Engines reach a driver with `limit: 1`, which is shaped exactly like page one of
  a walk, but it promises _a_ matching record rather than a position in a
  sequence — nothing for a second call to be inconsistent with. Reading it as a
  page would put `ORDER BY id LIMIT 1` on the hottest read in the system, which is
  the classic shape for a planner to abandon the predicate's own index: measured
  on Postgres 16 over 2M rows, `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms
  and swapped the `owner_id` index for the primary key. `MongoDBDriver.findOne`
  has never sorted, so this also puts the two drivers back in step.

  The obligation is normative on `IDataDriver.find` and the cases are shared —
  `PAGINATION_UNORDERED_CASES` alongside `PAGINATION_CASES` in
  `@objectstack/spec/data` — so a future driver is held to both halves by a gate
  rather than by remembering.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- d1557d9: feat(driver-mongodb)!: declare the driver single-tenant and refuse to boot multi-tenant (#3724)

  `MongoDBDriver` implements **no row-level tenant isolation** — it never reads
  `DriverOptions.tenantId`, so reads carry no tenant predicate and writes are not
  stamped with a tenant column. The layer the SQL driver has (`resolveTenantField`

  - `applyTenantScope`) simply does not exist here, while everything above the
    driver — object metadata's `tenancy` block, `applySystemFields` injecting
    `organization_id`, the engine threading `tenantId` into every driver call —
    operates on the assumption that tenant isolation is a platform guarantee. Point
    a multi-tenant deployment's datasource at Mongo and every query read, updated
    and deleted other tenants' documents, silently.

  Rather than serve unisolated, the driver now fails fast at startup:

  - The **constructor** and `connect()` call `assertSingleTenantPosture()`, which
    refuses any tenancy posture other than `single` (`OS_TENANCY_POSTURE=group` /
    `isolated`, including the posture derived from `OS_MULTI_ORG_ENABLED=true`),
    resolved through the shared `resolveTenancyPosture()` so the driver can never
    disagree with auth / the registry / the CLI about the mode. The check sits in
    the constructor because that is the earliest seam — it fails before a host can
    hand the driver anywhere — and `connect()` re-checks in case a host flips the
    posture in between. (It originally had to live in the constructor because
    `ObjectQLEngine.init()` _caught_ a driver's connect rejection and booted
    anyway; that is fixed in the same release, #3741, so both seams abort boot.)
  - `syncSchema()` / `syncSchemasBatch()` call `assertObjectsNotTenantScoped()` and
    refuse objects declaring `tenancy.enabled: true`, naming every offender in one
    message.
  - `objectstack serve` / `dev` (CLI) now re-throw this error out of the
    auto-driver-registration block instead of swallowing it, so boot exits 1 with
    the actionable message — the same treatment `UnsupportedDriverError` already
    gets. Matched duck-typed by `code`, so the CLI takes no dependency on the
    driver package.

  Both throw `MongoDBMultiTenantUnsupportedError` with
  `code === 'MONGODB_MULTI_TENANT_UNSUPPORTED'`, a message that names the detected
  signal, the remedy, and `@objectstack/driver-sql` as the multi-tenant option.

  There is deliberately **no override env var**: an escape hatch would restore
  exactly the silent non-isolation this guard removes. Single-tenant deployments —
  every currently-working Mongo deployment — are unaffected.

  This is option B of #3724. Implementing real row-level isolation (option A)
  remains open; the `unique` index shape stays single-field until then, which is
  now correct by construction rather than by omission.

- b90086a: fix(driver-sql)!: `unique` materializes per tenant, ending its contradiction with the per-tenant autonumber sequence (#3696)

  `unique: true` became a **single-column global index that ignored `tenancy`
  entirely**, while the autonumber sequence table is keyed by
  `(object, tenant_id, field, scope)` and hands every tenant its own counter
  starting at 1. Two subsystems of the same platform contradicted each other:
  tenant B's `PROD-00001` was rejected by an index it could not see — **no user
  did anything wrong**, the platform's left hand refused what its right hand
  issued.

  The rejection also doubled as a **cross-tenant existence oracle**: a UNIQUE
  violation told tenant B that some _other_ tenant held the value, enumerable by
  probing emails / codes / names.

  **The contract now:**

  | Declaration                      | Materializes as                                                 |
  | -------------------------------- | --------------------------------------------------------------- |
  | `unique: true` + tenant column   | composite `(tenantField, field)` — unique **within** the tenant |
  | `unique: true`, no tenant column | single-column — single-tenant DDL is byte-identical to before   |
  | `unique: 'global'`               | single-column, always platform-wide                             |

  The tenant column comes first in the composite, so the index also serves the
  `WHERE tenant = ?` prefix scans every tenant-scoped read issues.

  **Declared `indexes[]` are deliberately unchanged.** They are materialized over
  exactly the columns listed — no tenant column is injected. The author already
  spells them out, per-tenant ones have always been written explicitly
  (`fields: ['organization_id', 'code']`), and many are legitimately platform-wide
  (a DNS hostname, a reserved slug, an external provider id). `'global'` is
  accepted there as a synonym of `true` so one vocabulary covers both spellings.

  **Migration is automatic and cannot fail.** Legacy indexes
  (`<table>_<col>_unique` from knex, `uniq_<table>_<col>` from the drift-rebuild
  path) are retired inline at schema-sync time. The old global constraint is
  strictly stronger than the new per-tenant one, so existing rows satisfy the
  replacement by construction — no dedup, no cleanup, no data touched. It
  converges at sync rather than waiting for a deliberate `os migrate` run because
  a deployment that never ran migrate would otherwise stay broken.

  **Upgrading — audit your `unique: true` fields.** On a tenant-scoped object the
  constraint is now per tenant. Anything that must stay platform-wide has to say
  so:

  ```ts
  hostname: Field.text({ unique: "global" }); // no two tenants may claim it
  ```

  Note the reach: `applySystemFields` injects `organization_id` into every
  registered object unless it opts out, and the driver falls back to that column
  when no `tenancy.tenantField` is declared — so most objects are tenant-scoped.
  Typical candidates for `'global'`: DNS hostnames, reserved slugs, external
  provider ids (Stripe customer/subscription), device identities.

  Postgres materializes `col.unique()` as a table CONSTRAINT rather than a bare
  index, so the retirement tries `DROP CONSTRAINT` before `DROP INDEX` —
  `DROP INDEX` alone would have made the migration a no-op on exactly the
  deployments that matter most.

  `@objectstack/driver-mongodb` accepts the new declaration but keeps single-field
  indexes: it implements no row-level tenancy at all (no tenant predicate on read,
  no tenant stamp on write), so a `(tenant, field)` index would advertise an
  isolation it does not deliver. Tracked separately.

### Patch Changes

- 030125b: feat(objectql)!: `init()` refuses to boot when a data driver fails to connect (#3741)

  `ObjectQLEngine.init()` wrapped every driver's `connect()` in a try/catch, logged
  one error line, and carried on. A server whose database was unreachable therefore
  "started successfully" — health endpoints could even stay green — and then failed
  every request with an error that reads nothing like _the database is down_. The
  warning it printed (`Operations may recover via lazy reconnection or fail at query
time`) was half fiction: grep the repo and no reconnection exists in `driver-sql`
  or `driver-mongodb`, so only the "fail at query time" half was ever real. The
  caller made it worse — `ObjectQLPlugin.start()` runs `syncRegisteredSchemas()`
  immediately after `init()`, issuing DDL against a driver that isn't there.

  The structural half of the bug was worse than the operational one: the catch
  removed a driver's ability to **refuse startup at all**. Any fatal startup check —
  licence, server version, incompatible configuration, missing capability, not just
  an unreachable socket — is expressed by throwing from `connect()`, and every one
  of them was silently downgraded to a runtime error. That is why driver-mongodb's
  multi-tenancy guard (#3724 / #3734) had to be hoisted into its constructor.

  - `init()` now **throws** `DriverConnectError` (`code: 'ERR_DRIVER_CONNECT'`)
    when any boot-registered driver's `connect()` rejects, aborting kernel
    bootstrap. It still attempts every driver first, so one failed boot names all
    of them. The message is self-contained — each failed driver and its cause —
    because the CLI prints `error.message` alone; the first cause is also attached
    as `error.cause`. Exported from both `@objectstack/objectql` and
    `@objectstack/objectql/core`.
  - `connect()` is now a supported place for a driver to veto boot. Startup
    validation that needs a live connection (server version, capability probes)
    no longer has to be forced into a constructor.
  - The misleading "lazy reconnection" warning is gone.
  - New escape hatch `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`
    (`resolveAllowDriverConnectFailure()` in `@objectstack/types`) restores the old
    lenient boot, but loudly: a `DEGRADED BOOT` banner names the failed drivers and
    states that they are never retried or reconnected and that every query and
    schema sync routed to them will fail for the process lifetime. The banner goes
    to stderr as well as the logger, because `os serve` swallows all of stdout
    during boot and `Logger` routes `warn` there — logger-only, the one message
    that matters would be invisible in exactly the deployment the flag is for.
    Defaults off.

  **Migration.** No code or config change is needed for a correctly configured
  deployment — a driver that connected before still connects. A deployment that was
  _silently_ booting without its database now fails the boot instead, with the
  driver name and cause in the error; fix the datasource configuration (typically
  `OS_DATABASE_URL`, credentials, or network reachability). To keep booting without
  it — deliberately, and knowing every request that touches it will fail — set
  `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Minor Changes

- d980f0d: feat: add a first-class `user` field type (person picker)

  A new `user` field type — the equivalent of Airtable's Collaborator / Notion's
  Person / Salesforce's `Lookup(User)`. Authored as `Field.user({ ... })`; use
  `{ multiple: true }` for collaborators/watchers and `{ defaultValue: 'current_user' }`
  to auto-fill the acting user on create.

  **Why a distinct type rather than telling authors to `Field.lookup('sys_user')`:**
  selecting a person is table-stakes, but the value is in _modelling
  discoverability_ — a "User" entry in the Studio/AI field palette instead of
  requiring authors (and AI) to know to reference the internal `sys_user` system
  object — plus `current_user` defaults and a user-search picker. Storage and
  runtime are unchanged.

  **Deliberately NOT a new storage primitive.** `user` is a _semantic
  specialization of `lookup`_ with the target fixed to `sys_user`: it shares the
  exact lookup code path — same FK string column (`multiple` ⇒ JSON), same
  `$expand` resolution, same indexing — so referential integrity and fresh display
  names come for free, and nothing is re-implemented. An existing
  `Field.lookup('sys_user')` is therefore equivalent at the storage layer (zero
  data migration to adopt `Field.user`).

  Ownership semantics are **unchanged**: the existing `owner_id` convention +
  `plugin-security` auto-stamp/RLS still apply. A declarative `owner` flag is a
  possible future follow-up; intentionally not added here to avoid a second
  field type for what is a system role (rationale: keep the `FieldType` surface
  lean — see related ADR-0059 freeze discipline).

  Changes: `FieldType` gains `'user'` + `Field.user()` builder; the SQL/Mongo
  drivers treat `user` exactly like `lookup`; the engine resolves `$expand` for
  `user` fields and honours a new `defaultValue: 'current_user'` token (resolved
  app-side from the execution context, mirroring the `NOW()` convention); kanban
  group-by and symbolic seed references accept `user`; approvals enrich `user`
  references. The public API surface is unchanged (additive enum member).

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Patch Changes

- 1e8b680: fix(security): close four P0 launch-readiness findings

  - **plugin-auth (P0-1):** `generateSecret()` now throws (fails boot) when no
    `OS_AUTH_SECRET` is set and `NODE_ENV==='production'`, instead of silently
    falling back to a predictable `dev-secret-<timestamp>` (session forgery). The
    dev/test fallback is unchanged.
  - **plugin-security (P0-2):** the permission-resolution `catch` now **fails
    closed** — it logs at ERROR and throws `PermissionDeniedError` rather than
    `return next()`. A degraded metadata service can no longer let every
    authenticated request bypass RBAC/RLS. System operations still bypass as before.
  - **driver-sql (P0-3):** the `contains` / `$contains` operator now escapes LIKE
    metacharacters (`%` / `_` / `\`) in the user value and binds an explicit
    `ESCAPE '\'`, so a value of `%` matches literally instead of every row
    (filter bypass). Correct across SQLite/MySQL/Postgres.
  - **driver-mongodb (P0-4):** the field-operator translator now rejects unknown
    `$`-operators instead of passing them through, blocking `$where` / `$function`
    / `$expr` (server-side JS execution / query-intent bypass). All legitimate
    ObjectQL operators remain allowlisted.

  +12 regression tests across the four packages.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
