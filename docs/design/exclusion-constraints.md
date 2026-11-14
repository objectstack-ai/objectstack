# Design: Exclusion Constraints (no two overlapping time ranges per group)

**Card**: [#32979](https://github.com/objectstack-ai/objectstack/issues/32979), step 1 of 3 (this design). Steps 2 and 3 get their own orders after contract review.
**Status**: proposal, rework r2 after contract review 6869162700 and its delta 6869686158. The doc decides only what the ruling left to the design. Every choice that replaces a premise of the ruling is in §8, with a recommendation.
**Anchor**: every `file:line` below was read on objectstack `68972cd2` (`origin/main`, 2026-11-14).

## The ruling

Maintainer, verbatim, answering decision batch #2 (ruling record `6844907250`, 2026-11-13T05:20Z): 「32677 暂停，先由元数据项目自己处理。其他同意」. For this card that is **A**, with these attached conditions:

- An object declares an exclusion constraint (a group-by field, start and end fields, and a status filter). The data layer enforces it at write time, **atomically**, at the same layer as the unique index. It is not a validation rule: `packages/spec/src/data/validation.zod.ts:43-44` says "A SELECT-then-INSERT "rule" is inherently racy (TOCTOU); a DB unique constraint is not", and a validation rule does no I/O (`:17-19`).
- A driver that cannot make it atomic **refuses the declaration loudly**.
- Intervals are **half-open**: a 21:30 end and a 21:30 start do not overlap.
- The design states what happens to **existing overlapping rows**.
- Acceptance: a second overlapping record is refused, an adjacent one is accepted, and of two concurrent requests only one succeeds.

## 1. Key shape

The key is a sibling of `indexes` on the object (`packages/spec/src/data/object.zod.ts:3765`). It is a constraint the storage layer holds, not a predicate over one record.

```ts
exclusions: [{
  name: 'no_overlapping_overtime',        // snake_case, unique per object: identity + i18n address
  groupBy: ['owner_id'],                  // 1..n fields, compared by equality
  range: ['start_time', 'end_time'],      // [start, end]: both `date` or both `datetime`
  where: { status: { $ne: 'rejected' } }, // optional: which rows take part (shape: Q7)
  message: '该时段已有加班申请',            // optional authored refusal text
}]
```

**Which fields are eligible.**
- `groupBy`, `range` and `where` name stored, single-valued fields: no formula, summary, multi-value lookup or JSON field. They may be authored or injected at registration.
- `owner_id` is injected (`objectql/src/registry.ts:1431`) and is absent under `ownership: 'org' | 'none'`. So step 2's refine reads `resolveInjectedSystemColumns` (`spec/src/data/injected-system-columns.ts:196`) as well as `fields`.
- `range` names two distinct fields of one type, `date` or `datetime`. `time` is refused: it has no date and wraps at midnight.

**What `where` admits**, if Q7 keeps the filter type:
- Admitted: implicit equality (`{ status: 'approved' }`), plus `$eq`, `$ne`, `$in`, `$nin`, `$null`, `$and` and `$or`, over the object's own eligible fields with literal values.
- Refused by name: `$not`, dotted paths, `{ $field }`, `{ $now }` / `addDays` (`filter.zod.ts:134`), the date macros, and the context-token strings `{current_user_id}`, `{current_org_id}` and `{record_id}` (`context-tokens.zod.ts:16`).

The point of these limits is that a row enters or leaves the constraint only by a write to that row.

**Organization scope is implied.** The organization key part is NULL-safe, as `unique: 'organization'` materializes it (`object.zod.ts:618-627`). On an object with no organization column it degrades to nothing (Q9).

**A row with a null `groupBy` value, or a null start, is outside the constraint** (SQL's NULL-distinct reading). Lint advises `required` on the start field.

## 2. Interval semantics

Every driver uses **one** overlap definition, and the shared conformance suite pins it (§6):

> A and B conflict ⇔ same organization, every `groupBy` value equal and non-null, both rows satisfy `where`, both intervals are non-empty, `A.start < B.end` and `B.start < A.end`.

| Case | Meaning |
|:---|:---|
| `end` = `start` of the next row (21:30 / 21:30) | adjacent, **no** conflict (half-open `[start, end)`) |
| `end` is null | open-ended (+∞) (Q8) |
| `start` == `end`, `datetime` | empty, conflicts with nothing (Q1). Under Q2-A, a `date` row with start = end is one whole day |
| `start` > `end` | `400 VALIDATION_ERROR`, judged only when the write touches a range field, so a stored inverted row stays editable |
| `datetime` | compared as UTC instants (ADR-0053 D-B1): `21:30+08:00` and `13:30Z` are the same instant |
| `date` | zone-free calendar days (ADR-0053). The reading of the end day is Q2 |

## 3. Atomicity

**Eligibility.** An exclusion is enforceable only when all three legs hold. Legs 1 and 2 are read by the engine; leg 3 is reported by the driver.

1. **The object is not federated.** The engine reads this with `isFederatedObject`. A federated object registers with no DDL (`objectql/src/engine-compatibility-api.ts:206-210`).
2. **The datasource's `schemaMode` is `managed`.** The engine reads it from the datasource definitions (`engine-registration.ts:660`). The driver refuses DDL on `external` and `validate-only` (`sql-driver-class-head.ts:530-537`).
3. **The driver reports the face can hold it.** This is the `exclusionConstraints` bit, computed per instance in the `supports` getter (`sql-driver.ts:363`) with a reason string the gate prints when it is false. driver-sql derives it from its family getters (`isPostgres`, `isMysql`, `isSqlite`), not from client strings, so sqlite-wasm qualifies through its `isSqlite` override (`sqlite-wasm-driver.ts:73-80`). That makes the Postgres family, MySQL and SQLite true. driver-turso answers per face, and driver-memory declares the bit itself.

**The SQL sequence (guard row).** For a write to an object that declares an exclusion, step 3 **opens a transaction**. Today `create` and `bulkCreate` send one statement with no transaction (`sql-driver-crud.ts:312-318`).

- **Isolation.** The driver pins `isolationLevel: 'read committed'` on a transaction it opens; knex takes it. That way nothing retries on serialization failures on Postgres, and InnoDB takes no gap locks for the overlap read.
- **Autonumbers.** The reservation runs **before** the transaction opens and commits on its own, as the bulk path already records (`sql-driver-bulk-operations.ts:125-145`). On SQLite's one-connection pool, a reservation inside the transaction would wait for the connection the transaction holds.

Inside the transaction, **lock order is: the stored row, then the guard keys in sorted order**. The steps:

1. **Update only:** read the stored row under a row lock first (`SELECT … FOR UPDATE`). On SQLite, the first statement is a write that takes the database lock, a no-op `UPDATE … SET id = id WHERE id = ?`. The old group, range and `where` membership come from that locked row, and the new ones from the merged row. Without this lock, a range edit racing a group move both commit and leave a pair (measured, delta review M3).
2. Seed each guard row `(object, constraint, organization_key, group_key_hash)` if it is missing. MySQL uses a no-op `ON DUPLICATE KEY UPDATE`, measured at 0 deadlocks over 16 cold writers (`sql-driver-autonumber.ts:160-166`). Then lock it `FOR UPDATE` and **bump** it (`version = version + 1`). A guard that is only locked lets two rows land at REPEATABLE READ (record 6869162700). The bump keeps a caller's transaction safe at any level. On SQLite, the seed or bump is the first write of an insert, so a second writer waits on the busy timeout and does not fail at once.
3. Run the overlap query (MySQL: a locking read, `FOR SHARE`), then write, then commit.
4. **Bulk writes** lock their stored rows by id order and their guard keys in one sorted list, so a multi-group batch cannot deadlock on its own order.

| Face | Rule | Atomic? |
|:---|:---|:---|
| Postgres family | the sequence above. A caller's transaction at REPEATABLE READ or SERIALIZABLE gets `40001` on a stale bump (§5) | yes |
| MySQL / mysql2 | the sequence, with a locking overlap read (InnoDB's read view can predate the commit the lock waited for). A deadlock is retried (§5) | yes |
| SQLite family (file) | the one-connection pool serializes within a process (`sql-driver.ts:672`). Across connections, SQLite transactions are serializable, and the first write takes the database lock | yes |
| driver-sqlite-wasm | one in-process database (`sqlite-wasm-driver.ts:67`, `:102`) | yes |
| driver-turso · local file | SQLite, as above | yes |
| driver-turso · embedded replica | writes go to a local file and sync later (`turso-driver.ts:191-193`), and another face can point at the same database (`:312`) | **no → refuse** |
| driver-turso · remote | **every hosted tenant database runs on this face** (`turso-driver.ts:290-293`), and the card's evidence is a hosted tenant. The guard sequence cannot run here because no interactive transaction reaches the statement (`transactionsUnsupported`, `:1940`). But that does not show the face cannot be atomic. Each record is already written as one composed statement (`remote-transport.ts:1698-1715`), the counter is already one atomic statement (`turso-driver.ts:336-339`), and a single conditional `INSERT … SELECT … WHERE NOT EXISTS (overlap)` had exactly one winner in 600 rounds on SQLite (delta review probe) | **Q11** |
| driver-memory | synchronous check and push, with no `await` between them (`memory-driver.ts:855-857`) | yes |
| MSSQL, Oracle | federation-only (`config-registry.zod.ts:280-298`); DDL refused by name (`sql-driver-class-head.ts:545-548`) | **no → refuse** |
| cockroachdb, redshift; mariadb | refused for emission (`sql-driver.ts:991`); mariadb is not a family member (`:1042`) | **no → refuse** |
| any `external` / `validate-only` datasource or federated object | legs 1 and 2 | **no → refuse** |
| driver-mongodb | a written guard document in a replica-set transaction would hold. But `supports` is a literal (`mongodb-driver.ts:181-184`), and no required lane runs a replica set (§6) | **no → refuse in v1** |
| driver-odata; third-party drivers | `transactionsUnsupported` (`odata-driver.ts:144`); no bit | **no → refuse** |

**What refusal on remote Turso means for the product.** If v1 refuses there (Q11-A), a hosted tenant that declares the key is refused at publish. The overtime case then stays open in the product where it was measured, and step 2's authoring rule must teach the key as conditional on the datasource.

**Where enforcement lives.** The check runs inside the driver's write methods (`create`, `update`, the bulk methods, `upsert`), at the unique index's layer. Any holder of the driver is covered, the recycle-bin restore included (`objectql/src/recycle-bin/restore.ts:637`). The engine only wraps the refusal envelope (§5).

**Refusing the declaration.** `DriverCapabilitiesSchema` (`spec/src/data/driver.zod.ts:175`) gains the opt-in bit; absence means `false` (as with `batchSchemaSync`, `:240`). Each point names the object, the constraint, the failed leg with its reason, and the remedy:

| Point | Seam | Answer |
|:---|:---|:---|
| Boot | object registration (`engine-compatibility-api.ts`), on the federated branch (`:206`) and before `syncSchema` | throws `code: 'EXCLUSION_CONSTRAINT_UNSUPPORTED'` with no status; the kernel never reaches `listening` |
| Publish | the author-time gate (`metadata-protocol/src/runtime-authoring-gate.ts`), from a host fact for the target datasource, on the precedent of `findHierarchyScopeCapabilityGaps` (`:652`). The post-publish schema sync is non-fatal by design (`protocol-registry-hydration.ts:1888-1889`), so it cannot be the gate. A draft save passes (`runtime-authoring-gate.ts:32`) | `422 INVALID_METADATA` (`:1547-1548`). The issue at `exclusions[i]` carries the kebab-case rule id `exclusion-constraint-unsupported`, as the precedent's rule ids are spelled (`:637`); the upper-case code is the boot and `defineStack` spelling |
| Install | the install gate, on the precedent of ADR-0120 D5e (`types/src/unique-scope-install-gate.ts`) | a hard stop listing each constraint and its failed leg |

## 4. Existing data

What holds under every option:

- Stored rows are never rewritten.
- The overlap probe is a self-join with no physical artifact, so it does **not** run at boot. It runs in `os migrate plan` and `os doctor` (each overlapping pair, with ids, start and end) and at publish of a new or changed exclusion. At publish, a tenant with no CLI (Studio) sees the pairs as advisories on the save answer (`SaveMetaItemResponseSchema.advisories`, `runtime-authoring-gate.ts:102-103`).
- There is no boot warning (`unique-scope-install-gate.ts:47`, ADR-0120 D5d).

What a write meets when legacy pairs exist is **Q6**. The precedents disagree:

- ADR-0120 D4 blocks the unique index until the data is clean (`sql-driver-schema-sync.ts:340-360`).
- `validation.zod.ts:54-61` freezes a violating row until it is repaired.
- ADR-0113 D1 (`docs/adr/0113-required-write-contract-vs-column-constraint.md:105-108`) judges one record: a write is refused only when the record's post-state violates and its pre-state complied.

## 5. Refusal on write

- **Envelope.** `code: 'EXCLUSION_VIOLATION'`, `status: 409`, plus `constraint` and `fields`.
  - The code is a ledger row per emitting package (`spec/src/api/error-code-ledger.zod.ts`); the standard catalog does not grow. It has one spelling in-process and on the wire (Q4).
  - A bulk refusal names the index of the offending incoming row, so per-row reports have something to report.
- **Message.** The authored `message` is translated through an i18n key beside `objectValidationMessageKey` (`spec/src/system/i18n-resolver.ts:4353`), under the same packaged-versus-tenant rule. Without one, a built-in sentence uses labels. `developerMessage` names the API names and the constraint.
- **No conflicting record id or values.** The probe runs in system scope, so naming the row would leak more than the unique-index oracle does.
- **Concurrency failures, and the loser's answer.**
  - **Retried** (driver-owned transaction only): a deadlock (Postgres `40P01`, MySQL `ER_LOCK_DEADLOCK` / 1213) and `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT`. The bound is 5 attempts, with jittered backoff of 20 ms × 2ⁿ, capped at 320 ms. Under the pinned READ COMMITTED, Postgres raises no `40001` on this path; a valid burst of non-overlapping writers of one group lands on the first attempt (delta review probe). The retry then sees the winner's row, so **the loser answers `409 EXCLUSION_VIOLATION`**.
  - **When the bound is spent**, the answer is `409 CONCURRENT_UPDATE` (Q4), never the driver's raw error.
  - **Inside a caller's transaction** the driver never retries; it answers `409 CONCURRENT_UPDATE` and the caller retries its unit. This covers an engine-opened unit too (`engine-hook-dispatch.ts:80`, `recycle-bin/restore.ts:700`), because to the driver that is a caller's transaction.
  - A MySQL deadlock has already rolled the caller's transaction back. `40001` and `40P01` on Postgres leave it aborted. `SQLITE_BUSY` leaves it open, but the write did not happen.
  - The unique wrapper passes all of these through untouched today (`duplicate-record-error.ts:192`); step 3 maps them.
- **Reach.** Every engine write door ends in the driver: insert, single and multi update, bulk create, import, the batch route, and the flow `create_record` / `update_record` nodes.
  - An MCP data tool carries `code`, `message` and `status` only (`mcp/src/mcp-http-tools.ts:1632`). An agent branches on the code; `constraint` and `fields` do not reach it.
  - Restore maps the refusal into its closed reason set (`restore.ts:639`), which is ADR-0148 D2's accepted list and needs an amendment (Q10).

## 6. Acceptance test shape (step 3)

The case set is `packages/spec/src/data/exclusion-conformance.ts`, beside `unique-null-distinct-conformance.ts`. `scripts/check-driver-conformance.mjs` makes every driver run it or carry a ledger entry; a refusing driver's entry is its boot-refusal pin. The conformance object carries an autonumber field (§3). Cases:

1. A second overlapping insert gets 409 `EXCLUSION_VIOLATION`; the test asserts `code` and `status`.
2. Adjacent rows (18:30–21:30, then 21:30–23:00) are accepted.
3. **Concurrency:** two overlapping inserts on separate connections, 20 rounds. Exactly one wins each round, and the loser answers 409 `EXCLUSION_VIOLATION`.
4. 16 cold overlapping writers over two groups: one winner per group, with no deadlock surfacing.
5. A burst of 8 non-overlapping writers in one group, inside caller transactions at REPEATABLE READ and through driver-owned transactions. Every driver-owned write lands, and a caller-transaction loser answers `CONCURRENT_UPDATE`.
6. **Two concurrent updates of one row:** a range edit against a group move, and a range edit against a `where` entry (`rejected` → `pending`). No overlapping pair is stored, and the loser answers 409.
7. A row excluded by `where`, another group, and another organization do not block. An update that enters through `where` is refused.
8. A null end blocks later starts. `start > end` gets 400 only on a write that touches a range field.
9. A bulk create of two mutually overlapping rows is refused as a whole, naming the row index.
10. After the Q6 ruling: one case for the chosen legacy-pair outcome.

**Lanes:**
- memory: unit tests.
- SQLite file: two connections on one file.
- sqlite-wasm: in-process.
- local Turso: its file face in the driver's own suite.
- Postgres at READ COMMITTED and REPEATABLE READ, and MySQL 8.0: the live dialect matrix (`driver-sql/src/live-dialect-matrix.globalsetup.ts`; CI provisions both).
- Remote Turso, if Q11-B: the libsql-over-SQLite stub (`driver-turso/src/libsql-sqlite-stub.testkit.ts`).
- MSSQL, Oracle and MongoDB: no lane (`live-dialect-matrix.testkit.ts:368`).

**The rule: the bit is `true` only where the concurrency cases run on a required lane.** A dogfood case also drives the card's overtime scenario over HTTP and MCP.

## 7. Steps 2 and 3

**Step 2: the key, the gate and authoring.** The key ships loud from day one, refused by every driver until step 3. The work spans spec, objectql, metadata-protocol, lint and types, and it is likely **Tier H**, because exporting `ExclusionSchema` regenerates `skills/objectstack-data/references/_index.md:15` (`check:skill-refs`).

- **Spec**
  - `ExclusionSchema` and `exclusions` beside `IndexSchema` and `indexes` (`object.zod.ts:592`, `:3765`). It is a `strictObject` with guidance; its refine covers §1.
  - `validation.zod.ts:42`: point overlap at `exclusions` and drop the stale `partial` pointer.
  - `DriverCapabilitiesSchema.exclusionConstraints`, plus the reason string.
  - The `EXCLUSION_CONSTRAINT_UNSUPPORTED` ledger rows.
  - The liveness row in `packages/spec/liveness/object.json`, as `live` with the gate as its evidence.
  - `check:generated`, and a `minor` changeset with `Metadata-protocol: added`.
- **The gate at the three points of §3:** `objectql/src/engine-compatibility-api.ts`, `metadata-protocol/src/runtime-authoring-gate.ts`, `packages/lint/src/runtime-gate.ts`, and the install gate in `packages/types`.
- **Lint and docs**
  - Lint (`packages/lint/src/authoring-rules.ts`, `rule-explanations.ts`): advise `required` on start (and on end, per Q8).
  - Docs: `content/docs/data-modeling/{indexing,validation,objects}.mdx`.
  - The AI authoring rule in `skills/objectstack-data` (Tier H), conditioned on the datasource if Q11-A.

**Step 3: enforcement per driver.** This step is also spec-face: registering a code is Clause-② (`error-code-ledger.zod.ts:102`). Order: engine and memory first, then SQL, then the Turso remote face if Q11-B.

- **Spec:** the `EXCLUSION_VIOLATION` ledger rows, a strict translation group for exclusion messages beside `_validations` (`spec/src/system/translation.zod.ts:806`), and the i18n key.
- **objectql:** the envelope beside `duplicate-record-error.ts`, the concurrency mapping (§5), the `start > end` refusal, and the restore refusal (`recycle-bin/restore.ts:639`) once the ADR-0148 D2 amendment lands.
- **driver-memory:** `memory-exclusion-constraint.ts`.
- **driver-sql**
  - The transaction it opens, pinned to READ COMMITTED, with the autonumber reservation before it.
  - The guard table and the supporting index `(organization, groupBy…, start)`. Without that index, MySQL's locking read locks every row it scans.
  - The lock order, the bump, the overlap query, the bounded retry, and the eligibility bit in `sql-driver-crud.ts` / `sql-driver-bulk-operations.ts`.
  - The `os migrate plan` / `os doctor` probe (`sql-driver-schema-sync.ts`, `schema-drift.ts`).
  - sqlite-wasm and local Turso inherit all of this.
- **driver-turso remote (Q11-B):** a conditional statement per row in `remote-transport.ts`, and the bit computed per face.
- The conformance file of §6.

## 8. Open questions (for the maintainer, as one batch)

1. **Is `start == end` (`datetime`) accepted?**
   - A. Accepted as an empty interval that conflicts with nothing (Postgres range types).
   - B. Refused with a 400.
   - C. An instant that conflicts inside another interval (SQL `OVERLAPS`).

   Recommend **A**: a zero-length booking holds no time. C is the stricter reading if instants matter.
2. **How is a `date` end read?**
   - A. Through the whole day, `[start, end + 1 day)`, on the precedent of ADR-0053 D-D1 (a bare-day upper bound means the whole day).
   - B. As a literal exclusive bound.
   - C. Declared per constraint (`rangeEnd: 'inclusive' | 'exclusive'`), so a checkout-style end stays declarable.

   Recommend **A**: under B, two one-day leaves on one day are both empty and both pass.
3. **Native Postgres `EXCLUDE` in v1?** Recommend **no**. The guard row is one path on every SQL dialect, needs no `btree_gist`, and works over legacy pairs. Postgres's `EXCLUDE` has no `NOT VALID`.
4. **Which codes?**
   - The refusal: a new `EXCLUSION_VIOLATION` with one spelling at both boundaries, or `RESOURCE_CONFLICT`. Recommend **the new code**: `RESOURCE_CONFLICT` is too generic for an agent to branch on. Precedent the other way: the upsert-collision ruling took no new code.
   - The loser of a race inside a caller's transaction, or when retries run out: `CONCURRENT_UPDATE` or `CONCURRENT_MODIFICATION`. Recommend **`CONCURRENT_UPDATE`**, the data path's existing 409 for "another writer got there first" (`objectql/src/concurrent-update-error.ts:8-10`). The doors already classify it. `CONCURRENT_MODIFICATION` has no emitter.
5. **May an `object_extension` add exclusions?** It can add `indexes` (`object.zod.ts:5753`). Recommend **not in v1**: the package that owns the data owns its invariant.
6. **What does a write meet when legacy overlapping rows exist?**
   - A. **Frozen:** any write to a row of a legacy pair is refused until it is repaired. Every update takes the lock, flows and roll-ups touching such rows answer 409, and a pair another rule locks has no repair.
   - B. **New pairs only:** a write is refused only when it creates an overlapping pair that did not exist before. This is ADR-0113 D1 read per pair, not per record: read per record, a row already in a pair could take new overlaps. An update touching no `groupBy`, range or `where` field skips the lock and the probe.
   - C. **Inactive until clean** (ADR-0120 D4).

   Recommend **B**. It protects from publish onward and leaves no row stuck. C denies the protection to the tenants that already have a duplicate, which is how the card was found.
7. **What shape does `where` take?** The ruling's "existing conditional-index form" is gone: `indexes[].partial` was retired at protocol 17 (`object.zod.ts:439-457`), and it was a raw SQL string.
   - A. `FilterConditionSchema` (the summary filter, `field.zod.ts:2213`), narrowed by the §1 refine.
   - B. `lifecycleOnlyWhenSchema` (`object.zod.ts:961`): equality, `$in` and `$null`.
   - C. A dedicated closed shape holding exactly §1's operators.

   Recommend **C**. It keeps A's fail-closed `$ne` / `$nin`, so a state added later stays constrained, and B's property that the JSON Schema and type equal what a parse accepts. B fails open, because an `$in` list silently misses new states.
8. **What does a null end mean?** Recommend **+∞**: an unfinished booking holds its time, and lint advises `required` on the end. The alternative is that the row is outside the constraint.
9. **Is the organization scope implied?** Recommend **implied, with no `'global'` arm in v1**. ADR-0120 D1 makes a declared index state its scope because bare `true` meant two things by position; here there is one meaning. A `'global'` arm would arrive as a required `scope` key, together with the D5e install gate.
10. **Which ADRs?** Recommend an ADR for the **guard table** (a new platform table with an isolation contract) and an amendment to **ADR-0148 D2** adding "an exclusion constraint would overlap" to restore's closed refusal list (Prime Directive 13). The codes need only ledger rows. Both are Tier H and the maintainer's.
11. **The hosted face (remote Turso).**
    - A. Refuse in v1. The card stays open for hosted tenants, and the authoring rule is conditioned on the datasource.
    - B. Step 3 enforces there with one conditional statement per row: `INSERT … SELECT … WHERE NOT EXISTS (overlap)`, and `UPDATE … WHERE id = ? AND NOT EXISTS (…)`, with zero rows affected meaning refused. This is a second mechanism beside the guard, proved on the libsql stub. A bulk write on that face is judged row by row, because the face has no transaction.

    Recommend **B**: the card's evidence is a hosted tenant, and SQLite makes one statement atomic across connections (600 of 600 rounds with one winner).
