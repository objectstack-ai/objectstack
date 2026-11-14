# Design: Exclusion Constraints (no two overlapping time ranges per group)

**Card**: [#32979](https://github.com/objectstack-ai/objectstack/issues/32979), step 1 of 3 (this design). Steps 2 and 3 get their own orders after contract review.
**Status**: proposal, for contract review. It decides only what the ruling left to the design; each open question carries a recommendation.
**Anchor**: every `file:line` below was read on objectstack `68972cd2` (`origin/main`, 2026-11-14).

## The ruling

Maintainer, verbatim, answering decision batch #2 (ruling record `6844907250`, 2026-11-13T05:20Z): 「32677 暂停，先由元数据项目自己处理。其他同意」. For this card that is **A**, with the conditions the record attaches:

- An object declares an exclusion constraint (a group-by field, start and end fields, and a status filter). The data layer enforces it at write time, **atomically**, at the same layer as the unique index. It is not a validation rule: `packages/spec/src/data/validation.zod.ts:43-44` already says "A SELECT-then-INSERT "rule" is inherently racy (TOCTOU); a DB unique constraint is not", and a validation rule does no I/O (`:17-19`).
- A driver that cannot make it atomic **refuses the declaration loudly**.
- Intervals are **half-open**: a 21:30 end and a 21:30 start do not overlap.
- The design states what happens to **existing overlapping rows**.
- Acceptance: a second overlapping record is refused, an adjacent one is accepted, and of two concurrent requests only one succeeds.

## 1. Key shape

A sibling of `indexes` on the object (`packages/spec/src/data/object.zod.ts:3765`), because it is the same kind of thing: a constraint the storage layer holds, not a predicate over one record.

```ts
exclusions: [{
  name: 'no_overlapping_overtime',        // snake_case, unique per object: identity + i18n address
  groupBy: ['owner_id'],                  // 1..n own fields, compared by equality
  range: ['start_time', 'end_time'],      // [start, end]: both `date` or both `datetime`
  where: { status: { $ne: 'rejected' } }, // optional: which rows take part
  message: '该时段已有加班申请',            // optional authored refusal text
}]
```

- **Organization scope is implied.** The constraint holds per organization: the driver prepends the NULL-safe organization key part exactly as `unique: 'organization'` does (ADR-0120 D1/D3, `object.zod.ts:642`). There is no `'global'` arm in v1. Without one, two tenants' bookings never meet, and the refusal is no cross-tenant existence oracle.
- **A row with a null `groupBy` value, or a null start, is outside the constraint.** That matches SQL's NULL-distinct reading of a unique index. Lint advises `required` on the start field.
- **Why `where` reuses an existing filter shape, and which one.** The ruling names "the existing conditional-index form". On `main` there is none: `indexes[].partial` was retired at protocol 17, and `IndexSchema` refuses `where` with guidance (`object.zod.ts:427-487`, `:600`). The comment at `validation.zod.ts:41` still points to `partial` and is stale. Two filter shapes are live: `FilterConditionSchema`, the query `where` that `summaryOperations.filter` uses (`field.zod.ts:2213`), and the narrower `lifecycleOnlyWhenSchema` (`object.zod.ts:961`). The card's confidence gap asks "a status filter only or a full filter", and recommends "the same filter shape summaries use". The design takes **`FilterConditionSchema` as the type, narrowed by a closed-subset check**. The author writes the same `where` as everywhere else, and only the part a constraint can honour is admitted:
  - only the object's own fields, with no dotted paths;
  - only `$eq`, `$ne`, `$in`, `$nin`, `$null`, `$and` and `$or`, over literal values;
  - nothing that varies with the caller or the clock (`$currentUser`, relative date tokens). A row must not move in or out of the constraint unless the row itself changes. This also matches Postgres, which requires an IMMUTABLE predicate in `EXCLUDE … WHERE`.

## 2. Interval semantics

Every driver uses **one** overlap definition, and a shared conformance suite pins it (§6):

> A and B conflict ⇔ same organization, every `groupBy` value equal and non-null, both rows satisfy `where`, both intervals are non-empty, `A.start < B.end` and `B.start < A.end`.

| Case | Meaning |
|:---|:---|
| `end` = `start` of the next row (21:30 / 21:30) | adjacent, **no** conflict (half-open `[start, end)`) |
| `end` is null | open-ended (+∞, "still running"). It conflicts with every later start in its group |
| `start` == `end` | an empty interval that conflicts with nothing (Postgres `'empty'` range semantics). See Q1 |
| `start` > `end` | refused before the driver, `400 VALIDATION_ERROR`, on every driver (Postgres itself raises on an inverted range) |
| `datetime` fields | compared as UTC instants. ADR-0053 D-B1 gives one canonical storage form per dialect, so time zones never enter: `21:30+08:00` and `13:30Z` are the same instant |
| `date` fields | calendar days, with no zone (ADR-0053). The end day is read as running through that whole day, `[start, end + 1 day)`, which is Postgres `daterange(s, e, '[]')` in canonical form. A one-day leave (start = end) occupies its day. See Q2 |
| mixed `date`/`datetime`, or `time` | refused at authoring. `time` has no date and wraps at midnight |

## 3. Atomicity per driver

| Driver / face | Mechanism | Atomic? |
|:---|:---|:---|
| driver-sql · Postgres | **Guard-row lock** (below), the v1 path. Native `EXCLUDE USING gist (org WITH =, group WITH =, tstzrange(s, e, '[)') WITH &&) WHERE (…)` would be stronger but needs `btree_gist` and cannot be built over overlapping rows. See Q3 | yes |
| driver-sql · MySQL / MSSQL / Oracle | Guard-row lock. MySQL has no exclusion constraint and no partial index at all | yes |
| driver-sql · SQLite file | The range query and the write run inside one write transaction (`BEGIN IMMEDIATE`), which serializes every writer on the file (`sql-driver.ts:2313-2314`) | yes. Multi-process SQLite stays out of scope, as it is for the counter |
| driver-sqlite-wasm | Inherits `SqlDriver` and has one in-process connection, its only mode | yes |
| driver-turso · local/embedded | SQLite semantics, as above | yes |
| driver-turso · remote | `supports.transactionsUnsupported: true` (`turso-driver.ts:1940`): no transaction reaches the statement | **no → refuse** |
| driver-memory | Synchronous check and write in one tick, with no `await` between them, like `memory-unique-constraint.ts` | yes (single process) |
| driver-mongodb · replica set | A session transaction (`mongodb-driver.ts:668-671`) plus one guard document per group, bumped with `findOneAndUpdate`, so concurrent writers hit a WriteConflict and one aborts | yes |
| driver-mongodb · standalone | There are no transactions | **no → refuse** |
| driver-odata | A remote service, with `transactionsUnsupported: true` (`odata-driver.ts:144`) | **no → refuse** |
| third-party driver | It does not declare the capability bit | **no → refuse** |

**The guard-row lock** follows the pattern the autonumber counter already uses (`_objectstack_sequences`, `SELECT … FOR UPDATE`, `sql-driver.ts:2308-2316`). Inside the write's transaction the driver does three things in order:

1. It upserts a guard row `(object, constraint, group_key_hash)` and locks it `FOR UPDATE`. When an update moves a row to another group, it locks both keys in sorted order, so two writers cannot deadlock.
2. It runs the overlap query as a **locking read** (`FOR SHARE`), or under READ COMMITTED. MySQL's default REPEATABLE READ snapshot can predate the commit the lock just waited for, and a plain `SELECT` there would miss the competing row.
3. It writes, then commits.

A raw-SQL writer outside the platform bypasses the lock. That is the same reach every platform-side invariant has, and the native Postgres constraint (Q3) is what closes it.

**The refusal is loud.** `DriverCapabilitiesSchema` (`packages/spec/src/data/driver.zod.ts:175`) gains an opt-in bit, `exclusionConstraints`, where absence means `false`. It mirrors `transactionsUnsupported` and can differ per face (remote Turso answers `false`). The engine judges every declaration against the driver of the object's datasource, at three points, and all three answer with one new ledger code, `EXCLUSION_CONSTRAINT_UNSUPPORTED`, naming the object, the constraint, the driver and the remedy (a different datasource, or drop the declaration):

- **Boot**, at object registration and schema sync. The kernel never reaches `listening`, the same pre-HTTP abort as `MEMORY_MULTI_TENANT_UNSUPPORTED`.
- **Publish**: a metadata save of the object, or of a datasource change under it, answers `400 VALIDATION_ERROR` at `exclusions[i]` and commits nothing, so an AI author learns it at save time.
- **Install**: a hard stop listing each constraint, like ADR-0120 D5e's gate (`packages/types/src/unique-scope-install-gate.ts`).

## 4. Existing data

Precedent: a unique index declared over existing duplicates is **blocked with a row report** and never rewrites rows (ADR-0120 D4, `sql-driver-schema-sync.ts:340-360`).

**Recommendation: report, and enforce from now on.**

- Schema sync runs an overlap probe. `os migrate plan` and `os doctor` list every overlapping pair (ids, start, end), and boot warns once with the count. Rows are never rewritten.
- New writes are checked at once against all rows, the old pairs included.
- A write that leaves an existing overlapping row still overlapping is refused. A repairing write lands: a reject, a cancel, or a time change. This is the "frozen, not bricked" invariant reading `validation.zod.ts:54-61` gives `script` rules.

Refusing the declaration instead would deny the protection to exactly the tenants that already have a duplicate, which is how the card was found. Postgres has no `NOT VALID` for exclusion constraints, so this choice is also part of why v1 does not depend on the native constraint (Q3).

## 5. Refusal on write

- **Envelope**: `code: 'EXCLUSION_VIOLATION'`, `status: 409`, plus `constraint` (its name) and `fields` (`groupBy` and range). It is a new ledger code in the 409 group (`api/errors.zod.ts:94-99`). It uses **one spelling in-process and on the wire**, unlike the unique pair `DUPLICATE_RECORD` / `UNIQUE_VIOLATION` (`objectql/src/duplicate-record-error.ts:34-48`). See Q4.
- **Message**: the authored `message` is translated through an i18n key beside `objectValidationMessageKey` (`spec/src/system/i18n-resolver.ts:4353`), with the same packaged-versus-tenant rule. Without one, a built-in sentence uses labels, as the unique refusal does ("overlaps another Overtime Request for the same Owner"). `developerMessage` names the API names and the constraint.
- **No conflicting record id or values.** The probe runs in system scope, so a row the caller cannot read still blocks; naming it would leak more than the unique-index oracle does.
- **Reach**: every write door goes engine → driver. That covers insert, single and multi update, bulk create, upsert, import, the batch route, and the flow `create_record` / `update_record` nodes. A batch whose rows overlap each other is refused too. An MCP or agent caller gets the same 409 envelope: `code` is for branching, `message` is for the person.

## 6. Acceptance test shape (step 3)

There is one shared conformance case file, in the way `driver-sql/src/cross-field-conformance-cases.ts` is shared, and every supporting driver runs it:

1. The second overlapping insert gets 409 `EXCLUSION_VIOLATION`. The test asserts `code` and `status`, not a bare throw.
2. Adjacent rows (18:30–21:30, then 21:30–23:00) are accepted.
3. **Concurrency**: two overlapping inserts on separate transactions or connections are released together (`Promise.all`), for 20 rounds, and exactly one is fulfilled each round.
4. A row excluded by `where` (rejected), another group, and another organization do not block.
5. A null end blocks later starts, and an update that moves a row into an overlap is refused.
6. A bulk create of two mutually overlapping rows is refused as a whole.

Per driver:

- **memory**: unit tests.
- **SQLite file**: two connections on one file.
- **sqlite-wasm**: in-process.
- **Postgres and MySQL**: the live dialect matrix (`driver-sql/src/live-dialect-matrix.globalsetup.ts`).
- **MongoDB**: a replica set runs the cases, and a standalone server proves the refusal.
- **Turso**: local runs the cases, and remote proves the refusal.
- **OData, and a no-bit fake**: boot-refusal pins.
- **End to end**: a dogfood case drives the card's overtime scenario over HTTP and MCP.

## 7. Steps 2 and 3

**Step 2, spec and authoring (`domain:spec`).** The key ships loud from day one: until step 3, every driver refuses it.

- `ExclusionSchema` beside `IndexSchema`, and `exclusions` beside `indexes` (`object.zod.ts:592`, `:3765`). It is a `strictObject` with guidance. A parse refine checks that names are unique, that `range` and `groupBy` name declared fields, that the two range types match (`date`/`datetime`), and the closed `where` subset (§1).
- `validation.zod.ts:39-44`: point overlap at `exclusions`, and drop the stale `partial` pointer.
- `DriverCapabilitiesSchema.exclusionConstraints`. The engine-side `EXCLUSION_CONSTRAINT_UNSUPPORTED` gate at registration and publish (§3), plus its ledger row in `spec/src/api/error-code-ledger.zod.ts`.
- Lint (`packages/lint/src/authoring-rules.ts`, `rule-explanations.ts`): advise `required` on the start field.
- Generated artifacts via `check:generated`. A `minor` changeset with `Metadata-protocol: added`. The `metadata-form-zod-reconciliation` classification of the new key.
- The AI authoring rule in `skills/objectstack-data` is Tier H, so it goes in its own PR.

**Step 3, enforcement per driver (`domain:data`).** One PR for the engine and memory first, then SQL, then MongoDB.

- objectql: the write-path seam calls the driver's check on every door in §5, the `EXCLUSION_VIOLATION` envelope lives beside `duplicate-record-error.ts`, and `start > end` is refused. Ledger rows go in per emitting package, plus the i18n key.
- driver-memory: `memory-exclusion-constraint.ts`, beside the unique module.
- driver-sql: the guard table, and the locked overlap query in `sql-driver-crud.ts` / `sql-driver-bulk-operations.ts`. The overlap probe and its report go in `sql-driver-schema-sync.ts` / `schema-drift.ts`. sqlite-wasm and local Turso inherit; remote Turso keeps the bit `false`.
- driver-mongodb: a guard document plus the transaction, with standalone detected and refused. driver-odata declares no bit.
- The conformance suite of §6.

## 8. Open questions (each is what the ruling leaves open)

1. **Should `start == end` be accepted?** Recommend **accept it as empty**, conflicting with nothing. That is what the range types every SQL engine documents do. Refusing it would add a rule the user never asked for.
2. **Should a `date` end mean the whole day?** Recommend **yes**, `[start, end + 1 day)`. Leave forms write the last day off, and a literal half-open reading of days would let two leaves on the same day both pass, because each would be empty.
3. **Native Postgres `EXCLUDE` in v1?** Recommend **no**: the guard-row lock on every SQL dialect gives one code path and one conformance suite. It works without extension privileges (`btree_gist`), and it enforces from now on over legacy overlaps (§4). Native `EXCLUDE` can come later as hardening, built only once the probe is clean.
4. **Which error code?** Recommend a **new `EXCLUSION_VIOLATION`**, with one spelling at both boundaries. `RESOURCE_CONFLICT` is too generic for an agent to branch on, and `UNIQUE_VIOLATION` names a different fact.
5. **Can an `object_extension` add exclusions?** It can add `indexes` (`object.zod.ts:5753`). Recommend **not in v1**: only the owning object declares one, so the package that owns the data owns its invariant.

No ADR is required for this design: the ruling record is the decision, and the key is a new protocol addition under it. If contract review wants the guard-table or error-code choices recorded, that ADR is Tier H and the maintainer's.
