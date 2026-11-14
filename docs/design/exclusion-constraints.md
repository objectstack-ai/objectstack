# Design: Exclusion Constraints (no two overlapping time ranges per group)

**Card**: [#32979](https://github.com/objectstack-ai/objectstack/issues/32979), step 1 of 3 (this design). Steps 2 and 3 get their own orders after contract review.
**Status**: proposal, rework r1 after contract review 6869162700. It decides only what the ruling left to the design. Every choice that replaces a premise of the ruling is in §8 with a recommendation.
**Anchor**: every `file:line` below was read on objectstack `68972cd2` (`origin/main`, 2026-11-14).

## The ruling

Maintainer, verbatim, answering decision batch #2 (ruling record `6844907250`, 2026-11-13T05:20Z): 「32677 暂停，先由元数据项目自己处理。其他同意」. For this card that is **A**, with the conditions the record attaches:

- An object declares an exclusion constraint (a group-by field, start and end fields, and a status filter). The data layer enforces it at write time, **atomically**, at the same layer as the unique index. It is not a validation rule: `packages/spec/src/data/validation.zod.ts:43-44` already says "A SELECT-then-INSERT "rule" is inherently racy (TOCTOU); a DB unique constraint is not", and a validation rule does no I/O (`:17-19`).
- A driver that cannot make it atomic **refuses the declaration loudly**.
- Intervals are **half-open**: a 21:30 end and a 21:30 start do not overlap.
- The design states what happens to **existing overlapping rows**.
- Acceptance: a second overlapping record is refused, an adjacent one is accepted, and of two concurrent requests only one succeeds.

## 1. Key shape

A sibling of `indexes` on the object (`packages/spec/src/data/object.zod.ts:3765`): a constraint the storage layer holds, not a predicate over one record.

```ts
exclusions: [{
  name: 'no_overlapping_overtime',        // snake_case, unique per object: identity + i18n address
  groupBy: ['owner_id'],                  // 1..n fields, compared by equality
  range: ['start_time', 'end_time'],      // [start, end]: both `date` or both `datetime`
  where: { status: { $ne: 'rejected' } }, // optional: which rows take part (shape: Q7)
  message: '该时段已有加班申请',            // optional authored refusal text
}]
```

**Which fields are eligible.** `groupBy`, `range` and `where` name stored, single-valued fields: no formula, no summary, no multi-value lookup, no JSON. They are either authored or injected at registration. `owner_id` is injected (`objectql/src/registry.ts:1431`) and is absent under `ownership: 'org' | 'none'`. So step 2's refine reads `resolveInjectedSystemColumns` (`spec/src/data/injected-system-columns.ts:196`) as well as `fields`. `range` names two distinct fields of the same type, `date` or `datetime`. `time` is refused because it has no date and wraps at midnight.

**What `where` admits**, if Q7 keeps the filter type:
- Admitted: implicit equality (`{ status: 'approved' }`), plus `$eq`, `$ne`, `$in`, `$nin`, `$null`, `$and` and `$or`, over the object's own eligible fields with literal values.
- Refused by name: `$not`, dotted paths, `{ $field }`, `{ $now }` / `addDays` (`filter.zod.ts:134`) and the date macros.
- Also refused: the context-token strings `{current_user_id}`, `{current_org_id}` and `{record_id}` (`context-tokens.zod.ts:16`). They are plain strings, so a "literal values" rule alone would admit them.

The rule behind both lists: a row enters or leaves the constraint only by a write to that row, so an update from `rejected` to `pending` is judged at that write.

**Organization scope is implied**: the constraint holds per organization, through the NULL-safe key part `unique: 'organization'` materializes (`object.zod.ts:618-627`). The key part degrades to nothing on an object with no organization column. Whether this needs no declaration is Q9.

**A row with a null `groupBy` value, or a null start, is outside the constraint.** That matches SQL's NULL-distinct reading. Lint advises `required` on the start field.

## 2. Interval semantics

Every driver uses **one** overlap definition, and the shared conformance suite pins it (§6):

> A and B conflict ⇔ same organization, every `groupBy` value equal and non-null, both rows satisfy `where`, both intervals are non-empty, `A.start < B.end` and `B.start < A.end`.

| Case | Meaning |
|:---|:---|
| `end` = `start` of the next row (21:30 / 21:30) | adjacent, **no** conflict (half-open `[start, end)`) |
| `end` is null | open-ended (+∞). A draft with no end blocks every later start in its group. See Q8 |
| `start` == `end` | an empty interval that conflicts with nothing. See Q1 |
| `start` > `end` | refused before the write, `400 VALIDATION_ERROR`, on every driver |
| `datetime` fields | compared as UTC instants (ADR-0053 D-B1): `21:30+08:00` and `13:30Z` are the same instant |
| `date` fields | zone-free calendar days (ADR-0053). How the end day is read is Q2 |

## 3. Atomicity

**Eligibility.** An exclusion is enforceable only when all three conditions below hold. The gate reads every one of them beside the capability bit, and any other case refuses the declaration:

1. The object is not federated. A federated object is registered with no DDL (`objectql/src/engine-compatibility-api.ts:206-210`), so the guard table cannot exist there, and the external system writes outside the lock.
2. The datasource's `schemaMode` is `managed`. The driver refuses every DDL operation on `external` and `validate-only` (`sql-driver-class-head.ts:530-537`).
3. The client is an emission client:
   - the Postgres family: `postgres`, `pg`, `postgresql`, `pgnative`;
   - `mysql` and `mysql2`;
   - the SQLite family: `sqlite3`, `sqlite`, `better-sqlite3` (`sql-driver.ts:904-922`).

**The guard row is written, not only locked (M2).** The driver owns this sequence inside its write transaction, as the autonumber counter does (`sql-driver-autonumber.ts:168-211`):

1. Seed the guard row `(object, constraint, group_key_hash)` if it is missing. MySQL uses a no-op `ON DUPLICATE KEY UPDATE`, which the counter measured at 0 deadlocks over 16 cold writers (`:160-166`).
2. Lock the row `FOR UPDATE` and **bump it** (`version = version + 1`). The counter is safe at every isolation level because it writes the row it locks. A guard that is only locked lets two overlapping rows land at REPEATABLE READ on Postgres 16, as the review measured. The driver sets no isolation level (`sql-driver-transactions.ts:73`).
3. Run the overlap query, then write, then commit.

When an update moves a row to another group, both keys are bumped in sorted order. Step 2 creates a supporting index `(organization, groupBy…, start)` with the guard table; without it, MySQL's locking read locks every row it scans.

| Face | Rule | Atomic? |
|:---|:---|:---|
| Postgres family, managed, non-federated | Lock and bump. At READ COMMITTED the second writer waits, then reads the first writer's row. At REPEATABLE READ / SERIALIZABLE the stale writer's bump fails with a serialization error (`40001`) and is retried (§5) | yes, at every level |
| MySQL / mysql2, managed, non-federated | Lock and bump. The overlap query is a **locking read** (`FOR SHARE`), because InnoDB's REPEATABLE READ snapshot can predate the commit the lock waited for. A deadlock rolls the transaction back and is retried (§5) | yes |
| SQLite family (file) | In process, the one-connection pool serializes (`sql-driver.ts:672`). Across connections or processes (`:1764`), SQLite transactions are serializable: the guard bump is the first write, so a second writer blocks or answers `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` and is retried (§5). Knex sends a plain `BEGIN`, and nothing depends on `BEGIN IMMEDIATE` | yes |
| driver-sqlite-wasm | one in-process database (`sqlite-wasm-driver.ts:67`, `:102`) | yes |
| driver-turso · local file | SQLite, as above | yes |
| driver-turso · embedded replica | Writes go to a local file and sync later (`turso-driver.ts:191-193`), and a second face can point at the same database (`:312`), so nothing serializes them | **no → refuse** |
| driver-turso · remote | `transactionsUnsupported: true` (`turso-driver.ts:1940`) | **no → refuse** |
| driver-memory | Synchronous check and push, with no `await` between them (`memory-driver.ts:855-857`) | yes |
| MSSQL, Oracle | Federation-only (`config-registry.zod.ts:280-298`). DDL is refused by name (`sql-driver-class-head.ts:545-548`) | **no → refuse** |
| cockroachdb, redshift | Postgres-wire only, and refused for emission (`sql-driver.ts:991`) | **no → refuse** |
| mariadb | Neither recognised nor refused for emission (`sql-driver.ts:1042`). The gate treats it as a non-emission client | **no → refuse** |
| any `external` / `validate-only` datasource, any federated object | no DDL, and an external writer is outside the lock | **no → refuse** |
| driver-mongodb | A written guard document in a replica-set transaction would hold. But `supports` is a literal (`mongodb-driver.ts:181-184`), topology is only known after connect, and no required lane runs a replica set (§6) | **no → refuse in v1** |
| driver-odata | `transactionsUnsupported: true` (`odata-driver.ts:144`) | **no → refuse** |
| third-party driver | It does not declare the capability bit | **no → refuse** |

**Where enforcement lives.** The check runs inside the driver's write methods (`create`, `update`, the bulk methods, `upsert`), the unique index's layer. So any caller that holds the driver is covered, the recycle-bin restore included (`objectql/src/recycle-bin/restore.ts:637`). The engine only wraps the refusal envelope (§5).

**Refusing the declaration.** `DriverCapabilitiesSchema` (`spec/src/data/driver.zod.ts:175`) gains an opt-in bit, `exclusionConstraints`, where absence means `false` (as with `batchSchemaSync`, `:240`). Each refusal point answers in its own form, and all of them carry the new ledger code `EXCLUSION_CONSTRAINT_UNSUPPORTED`. Each refusal names the object, the constraint, which eligibility leg failed (bit, federation, `schemaMode` or client) and the remedy:

| Point | Seam | Answer |
|:---|:---|:---|
| Boot | object registration (`engine-compatibility-api.ts`), on the federated branch (`:206`) and before `syncSchema` | throws `EXCLUSION_CONSTRAINT_UNSUPPORTED`, with no status. The kernel never reaches `listening` |
| Publish | the author-time gate (`metadata-protocol/src/runtime-authoring-gate.ts`), from a host fact for the target datasource, on the precedent of `findHierarchyScopeCapabilityGaps` (`:652`). The schema sync after a publish is non-fatal by design (`protocol-registry-hydration.ts:1888-1889`), so it cannot be the gate. A draft save always passes (`runtime-authoring-gate.ts:32`) | `422 INVALID_METADATA` (`:1547-1548`), with an issue at `exclusions[i]` whose `rule` carries the code |
| Install | the install gate, on the precedent of ADR-0120 D5e (`types/src/unique-scope-install-gate.ts`) | a hard stop listing each constraint and its failed leg |

## 4. Existing data

What holds under every option:

- Stored rows are never rewritten.
- The overlap probe is a self-join with no physical artifact behind it, so it does **not** run at every boot. It runs in `os migrate plan` and `os doctor`, which list each overlapping pair (ids, start and end), and at publish of a new or changed exclusion.
- No boot warning is emitted. That follows the never-a-boot-warning rule of the gate cited above (`unique-scope-install-gate.ts:47`, ADR-0120 D5d).

What a write meets when legacy overlapping pairs exist is **Q6**, with three options. The precedents disagree:

- ADR-0120 D4 blocks a unique index until the duplicates are cleared (`sql-driver-schema-sync.ts:340-360`).
- `validation.zod.ts:54-61` freezes a script-rule violator until it is repaired.
- ADR-0113 D1 (`docs/adr/0113-required-write-contract-vs-column-constraint.md:105-106`) is the accepted rule for a constraint tightened on deployed rows: "a pre-existing violation does not block writes that leave it in place".

## 5. Refusal on write

- **Envelope**: `code: 'EXCLUSION_VIOLATION'`, `status: 409`, plus `constraint` (its name) and `fields` (`groupBy` and range). The code is a ledger row per emitting package (`spec/src/api/error-code-ledger.zod.ts`); the standard catalog does not grow. It uses one spelling in-process and on the wire (Q4), so no door needs a per-door arm. That differs from the unique pair `DUPLICATE_RECORD` / `UNIQUE_VIOLATION` (`objectql/src/duplicate-record-error.ts:35-99`).
- **Message**: the authored `message` is translated through an i18n key beside `objectValidationMessageKey` (`spec/src/system/i18n-resolver.ts:4353`), with the same packaged-versus-tenant rule. Without one, a built-in sentence uses labels, and `developerMessage` names API names and the constraint.
- **No conflicting record id or values.** The probe runs in system scope, so naming the row would leak more than the unique-index oracle does.
- **The loser of a race (S5).** Each dialect's concurrency failure gets a defined answer:
  - Kinds of failure: a `40001` serialization failure, a MySQL deadlock (which rolls the whole transaction back, `sql-driver-autonumber.ts:215-218`), and `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT`.
  - **Where the driver owns the transaction**, it retries within a bound, as the counter's owning-transaction retry does (`sql-driver-autonumber.ts:219-220`). The retry then sees the winner's row, so the loser answers `409 EXCLUSION_VIOLATION`.
  - **Inside a caller's transaction** it never retries, because the failure already rolled the caller's unit back. It answers `409 CONCURRENT_MODIFICATION`, a standard-catalog member, and the caller retries its whole unit.
  - The engine's unique wrapper passes these failures through untouched today (`duplicate-record-error.ts:192`). Step 3 maps them.
- **Reach.** Every engine write door ends in the driver: insert, single and multi update, bulk create, import, the batch route, and the flow `create_record` / `update_record` nodes. A batch or an import reports the refusal per row, and a batch whose own rows overlap is refused.
  - **MCP.** An MCP data tool's envelope carries `code`, `message` and `status` only (`mcp/src/mcp-http-tools.ts:1632`). An agent branches on the code and shows the message, and `constraint` / `fields` do not reach it.
  - **Recycle-bin restore** must map the refusal into its closed reason set (`restore.ts:639`). That set is ADR-0148 D2's accepted list, which needs an amendment (Q10).

## 6. Acceptance test shape (step 3)

**The case set** is `packages/spec/src/data/exclusion-conformance.ts`, beside `unique-null-distinct-conformance.ts`. `scripts/check-driver-conformance.mjs` then makes every driver run it or carry a ledger entry. For a refusing driver, that entry is the boot-refusal pin. The cases:

1. The second overlapping insert gets 409 `EXCLUSION_VIOLATION`; the test asserts `code` and `status`.
2. Adjacent rows (18:30–21:30, then 21:30–23:00) are accepted.
3. **Concurrency.** Two overlapping inserts on separate connections are released together, for 20 rounds. In every round exactly one wins and **the loser answers 409 `EXCLUSION_VIOLATION`**.
4. A burst of 16 cold writers over two groups. Exactly one wins per group, with zero deadlocks surfacing.
5. A row excluded by `where`, another group, and another organization do not block.
6. An update that enters through `where` (`rejected` → `pending`) is refused, and so is one that moves into another group's overlap.
7. A null end blocks later starts, and `start > end` gets 400.
8. A bulk create of two mutually overlapping rows is refused as a whole.

**Lanes**:

- memory: unit tests.
- SQLite file: two connections on one file.
- sqlite-wasm: in-process.
- Postgres and MySQL: the live dialect matrix (`driver-sql/src/live-dialect-matrix.globalsetup.ts`), with Postgres run at both READ COMMITTED and REPEATABLE READ.
- MSSQL, Oracle and MongoDB: no CI lane provisions them (`live-dialect-matrix.testkit.ts:368`), and the Mongo kit starts a standalone server only.

**The rule: the bit is `true` only where the concurrency case runs on a required lane.** That keeps MongoDB refusing in v1. A dogfood case also drives the card's overtime scenario over HTTP and MCP.

## 7. Steps 2 and 3

**Step 2: the key, the gate and authoring.** The key ships loud from day one: until step 3, every driver refuses it. Its gate lives outside `packages/spec`, so step 2 spans spec, objectql, metadata-protocol and lint. It is likely **Tier H**: exporting `ExclusionSchema` regenerates `skills/objectstack-data/references/_index.md:15` (`check:skill-refs`).

- Spec:
  - `ExclusionSchema` and `exclusions`, beside `IndexSchema` and `indexes` (`object.zod.ts:592`, `:3765`). It is a `strictObject` with guidance, and its refine covers §1: eligible fields, injected columns, same-type range, the `where` vocabulary and unique names.
  - Fix `validation.zod.ts:42`: point overlap at `exclusions`, and drop the stale `partial` pointer.
  - `DriverCapabilitiesSchema.exclusionConstraints`.
  - The `EXCLUSION_CONSTRAINT_UNSUPPORTED` ledger rows.
  - The liveness row in `packages/spec/liveness/object.json`, recorded as refused by every driver until step 3.
  - Generated artifacts via `check:generated`. A `minor` changeset with `Metadata-protocol: added`.
- The gate, at the three points of §3: `objectql/src/engine-compatibility-api.ts`, `metadata-protocol/src/runtime-authoring-gate.ts`, `packages/lint/src/runtime-gate.ts`, and the install gate in `packages/types`.
- Lint (`packages/lint/src/authoring-rules.ts`, `rule-explanations.ts`): advise `required` on start (and end, per Q8).
- Docs: `content/docs/data-modeling/{indexing,validation,objects}.mdx`.
- The AI authoring rule in `skills/objectstack-data` (Tier H).

**Step 3: enforcement per driver.** It is also a spec-face change, because registering a code is Clause-② wherever it lands (`error-code-ledger.zod.ts:102`). Order: the engine and memory first, then SQL.

- Spec:
  - the `EXCLUSION_VIOLATION` ledger rows;
  - a strict translation group for exclusion messages, beside `_validations` (`spec/src/system/translation.zod.ts:806`);
  - the i18n key in `i18n-resolver.ts`.
- objectql:
  - the envelope beside `duplicate-record-error.ts`;
  - the loser mapping (§5);
  - `start > end` refused;
  - the restore refusal (`recycle-bin/restore.ts:639`), after the ADR-0148 D2 amendment.
- driver-memory: `memory-exclusion-constraint.ts`.
- driver-sql:
  - the guard table and its supporting index;
  - lock, bump and overlap query in `sql-driver-crud.ts` / `sql-driver-bulk-operations.ts`, plus the owning-transaction retry;
  - the eligibility reading;
  - the `os migrate plan` / `os doctor` probe (`sql-driver-schema-sync.ts`, `schema-drift.ts`).
  - sqlite-wasm and local Turso inherit; the replica and remote Turso faces keep the bit `false`.
- The conformance file of §6.

## 8. Open questions (for the maintainer, as one batch)

1. **Should `start == end` be accepted?** Recommend **accept it as empty**, conflicting with nothing, which is the range semantics every SQL engine documents. The alternative is a 400.
2. **How is a `date` end read?**
   - A. Through the whole day, `[start, end + 1 day)`, on ADR-0053 D-D1's precedent (a bare-day upper bound means the whole day).
   - B. As a literal half-open bound.
   - C. A per-constraint bound (`rangeEnd: 'inclusive' | 'exclusive'`), so a checkout-style exclusive end stays declarable.

   Recommend **A**. Under B, two one-day leaves on the same day are both empty and both pass. C can come later if a checkout case appears.
3. **Native Postgres `EXCLUDE` in v1?** Recommend **no**. The written guard row gives one code path on every SQL dialect, needs no `btree_gist` privilege, and works over legacy pairs, which Postgres's `EXCLUDE` (it has no `NOT VALID`) cannot. Native `EXCLUDE` can come later as hardening.
4. **Which error code?** Recommend a **new `EXCLUSION_VIOLATION`**, with one spelling at both boundaries. `RESOURCE_CONFLICT` is too generic for an agent to branch on, and `UNIQUE_VIOLATION` names a different fact. Precedent the other way: the upsert-collision ruling took no new code.
5. **Can an `object_extension` add exclusions?** It can add `indexes` (`object.zod.ts:5753`). Recommend **not in v1**: the package that owns the data owns its invariant.
6. **Existing overlapping rows: what does a write meet?**
   - A. **Frozen**: any write to a row of a legacy pair is refused until it is repaired. Every update takes the lock. Flows, approvals and roll-ups that touch such a row start answering 409, and a pair whose repair another rule forbids (a state machine or an approval lock) cannot be repaired.
   - B. **New pairs only**: a write is refused only when it creates an overlapping pair that did not exist before. An update that touches no `groupBy`, range or `where` field skips the lock and the probe.
   - C. **Blocked until clean** (ADR-0120 D4): the declaration does not activate while the probe finds pairs.

   Recommend **B**. It is ADR-0113 D1's accepted rule, it protects from the moment of publish, and it leaves no row stuck. C denies the protection to exactly the tenants that already have a duplicate, which is how the card was found.
7. **What shape does `where` take?** The ruling's "existing conditional-index form" is gone: `indexes[].partial` was retired at protocol 17 (`object.zod.ts:439-457`) and was a raw SQL string, never a filter.
   - A. `FilterConditionSchema`, the summary filter shape (`field.zod.ts:2213`), narrowed by the §1 refine.
   - B. `lifecycleOnlyWhenSchema` (`object.zod.ts:961`): equality, `$in` and `$null` only. Its JSON Schema and TypeScript type equal what a parse accepts.

   Recommend **A**. It admits `$ne` / `$nin`, which fail closed: a state added later stays constrained. B forces an `$in` list, which fails open, because a new state is silently outside the constraint. The cost of A is a schema wider than its parse, which the refine and lint name.
8. **What does a null end mean?** Recommend **+∞**: an unfinished booking holds its time, with lint advising `required` on the end. The alternative, "outside the constraint", lets a draft with no end overlap anything.
9. **Is the organization scope implied?** Recommend **implied, with no `'global'` arm in v1**. ADR-0120 D1 makes a declared index state its scope because bare `true` meant two things by position. Here there is one meaning, so there is nothing to disambiguate. A `'global'` arm, if ever needed, arrives as a required `scope` key together with the D5e install gate.
10. **Which ADRs are needed?** Recommend an ADR for the **guard table** (a new platform table with an isolation contract) and an amendment to **ADR-0148 D2**, adding "an exclusion constraint would overlap" to restore's closed refusal list (Prime Directive 13). The two codes need only their ledger rows. Both records are Tier H and the maintainer's.
