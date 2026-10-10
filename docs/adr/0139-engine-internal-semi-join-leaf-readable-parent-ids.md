# ADR-0139: One engine-internal semi-join leaf — "the ids of object X this caller may read" — pushed down by ObjectQL, never authorable; ADR-0055 row (a) and ADR-0056's non-goal revisited for this one leaf

**Status**: Proposed (2026-10-10). **This record declares; it implements nothing.** It becomes **Accepted** on the
maintainer's approval (`docs/adr/**` is Tier H, Prime Directive #14); the execution cards under
[Execution plan](#execution-plan-after-acceptance) are cut after acceptance and ⛔ never before it. Until then the
platform stays in the ruling's letter D state, and letter C (a located 400 at the bound, after objectui#12081 item 8)
is the `domain:services` lane's interim on [#22590](https://github.com/objectstack-ai/objectstack/issues/22590).
**Decided by**: the maintainer, 「同意」 to the director seat's batch #312 item 2 (ruling
[`6097072172`](https://github.com/objectstack-ai/objectstack/issues/22590#issuecomment-6097072172), 2026-10-10T11:34Z):
**A is the end state, its first deliverable an ADR**; B (an unbounded `$in`) and a raised cap are ⛔ not taken. The
ruling took the `domain:services` seat's decision request
([`6095537369`](https://github.com/objectstack-ai/objectstack/issues/22590#issuecomment-6095537369)) and the rule census
in the dev report [`6095496633`](https://github.com/objectstack-ai/objectstack/issues/22590#issuecomment-6095496633);
triage [`6093122404`](https://github.com/objectstack-ai/objectstack/issues/22590#issuecomment-6093122404) set the
direction and [`6097212566`](https://github.com/objectstack-ai/objectstack/issues/22590#issuecomment-6097212566) filed the card.
**Builds on**: [ADR-0055](./0055-master-detail-controlled-by-parent.md) (the read derivation whose alternatives row (a)
this record revisits), [ADR-0056](./0056-permission-model-landing-verification.md) (D2 deny baseline; the non-goal this
record revisits), [ADR-0052](./0052-audit-is-not-the-activity-feed.md) §5 (the ActivityPointer pair every consumer
keys on), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10 (delegation), [ADR-0096](./0096-execution-surface-identity-admission.md)
D5 (principal-less refusal), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove: why no
capability bit returns), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the refusal envelope),
[ADR-0057](./0057-system-data-lifecycle-and-retention.md) (the `telemetry` datasource split that makes a parent federated).
**Leaves unchanged**: ADR-0055 §2's chosen mechanism (b) for `controlled_by_parent`, its `rlsMembership` IN-form and
the four-form fail-closed RLS compiler; ADR-0053 D-D1 (drivers receive lowered input) for every form but this one leaf.
**Consumers**: `@objectstack/spec` (the leaf's declaration), `@objectstack/objectql` (composition and push-down),
`@objectstack/driver-sql` and the drivers that inherit it, `@objectstack/driver-turso` (remote transport),
`@objectstack/driver-memory`, `@objectstack/driver-mongodb`, `@objectstack/plugin-audit` (five of the six consumers),
`@objectstack/service-storage` (the sixth).
**Card**: [#22678](https://github.com/objectstack-ai/objectstack/issues/22678).

---

## TL;DR

Six read gates answer "a row about a record is readable when that record is readable" the same way: a SYSTEM pre-scan
of at most 2,000 candidate rows, one caller-scoped read per parent object, one `$in` of the readable ids per object.
Past the bound the gate fails closed — the un-scanned rows are excluded and a `warn` says so — and the list's `total`
agrees with the short answer, so nothing an API reader can see distinguishes a complete page from a truncated one.
Measured on `main` `1b99388505` (report `6095496633`): a member who may read 1,808 of 5,042 activity rows was served
1,105, `total` 1,105; an administrator was cut at exactly 2,000; the warning fired on every read.

**Decision:** the engine gains **one** filter leaf it composes itself and never accepts from a request —
*"the ids of parent object P this caller may read"* — placed where a list of ids goes today. ObjectQL composes the
leaf from `canReadObject`, `getReadFilter` and nothing else, and hands it to the driver as a subquery against P's
table, inside the driver's own tenant wall. `driver-sql` compiles it; each other driver compiles it or refuses loudly.
The six consumers emit one such leaf per parent object and no pre-scan. The withheld-update rule, the one consumer
whose judgement reads a JSON text column, moves to a writer-stamped `changed_fields` column with a backfill. Three
classes stay on today's bounded fail-closed probe, by name. ⛔ Not a general subquery capability; ⛔ not authorable.

## Context

### The mechanism today, and the six consumers

One module decides which rows are judged and turns the answer into a WHERE
(`packages/plugins/plugin-audit/src/parent-record-read-gate.ts#computeParentRecordFilter`); readability itself is one
caller-scoped engine read per parent object (`packages/plugins/plugin-audit/src/comment-access-hooks.ts#resolveReadableParentIds`),
so the parent's own CRUD grant, OWD/sharing and RLS decide and no second derivation exists. The bound is
`packages/plugins/plugin-audit/src/parent-record-read-gate.ts#PARENT_GATE_SCAN_LIMIT` (2,000), the comment gate's
`packages/plugins/plugin-audit/src/comment-access-hooks.ts#READ_SCAN_LIMIT` reused. The consumers, as read on
`origin/main` `d8830c28`:

| # | consumer | gate | bound | reading |
|:--|:--|:--|:--|:--|
| 1 | the activity stream | `packages/plugins/plugin-audit/src/activity-read-visibility.ts#installActivityReadVisibility` | `PARENT_GATE_SCAN_LIMIT` | **measured** (above) |
| 2 | the compliance ledger | `packages/plugins/plugin-audit/src/audit-log-read-visibility.ts#installAuditLogReadVisibility` | the same | source reading; same mechanism, plus an outside class and the `#LEDGER_AUDIT_CAPABILITY` exemption |
| 3 | the withheld-update rule | `packages/plugins/plugin-audit/src/activity-field-redaction.ts#computeWithheldUpdateFilter` | the same, its own SYSTEM pre-scan | source reading; sits on consumer 1's read path, so its bound caps the read even once consumer 1 is pushed down |
| 4 | comment threads | `packages/plugins/plugin-audit/src/comment-access-hooks.ts#installCommentReadVisibility` | `READ_SCAN_LIMIT` | source reading, not measured |
| 5 | comment reactions | the same installer, its reaction branch | `READ_SCAN_LIMIT` | source reading, not measured |
| 6 | attachments | `packages/services/service-storage/src/attachment-access-hooks.ts#installAttachmentReadVisibility` | its own `#READ_SCAN_LIMIT` (2,000) | source reading, not measured |

The window is shared by everyone's rows: the pre-scan runs as SYSTEM, outside the driver's tenant wall, so on a
multi-organization deployment every organization's rows compete for one 2,000-row window — which is how a reader with
640 rows of their own hit the bound (source reading, not measured). ⛔ Raising the cap only moves the cliff (triage).

### Why no push-down exists, and what already decided against one

- The filter vocabulary has no subquery spelling: `packages/spec/src/data/filter.zod.ts#FieldOperatorsSchema` and
  `#VALID_AST_OPERATORS` are closed, and an unknown operator is refused `INVALID_FILTER` / 400 at
  `#parseFilterAST` and at the engine's comparand doors (`packages/objectql/src/filter-comparand-shape.ts#assertListComparandShapes`).
- The driver contract retired `packages/spec/src/data/driver.zod.ts#querySubqueries` and `#joins` in 17.0.0 with the
  words "ObjectQL never plans subqueries through a driver, so there was nothing for the bit to switch on" — a
  zero-consumer bit removed under ADR-0049, not a ruling that the platform never evaluates one.
- **ADR-0055's alternatives row (a)** rejected `masterFK IN (SELECT id FROM master WHERE …)` because "the RLS compiler
  deliberately has no subquery support; the query AST has no EXISTS/sub-select form. Would require extending both",
  chose the pre-resolved id set (b), and recorded its own limit: "large-tenant scale (≫ thousands of masters) is a
  known limit — a future share-table/join mechanism would replace the id list". **ADR-0056** restated it as a
  non-goal: "Not adding RLS-compiler subquery support". Prime Directive #13 makes reversing either a decision of its
  own, hence this record.
- The engine's standing posture for an id set that outgrows a filter is to refuse, never truncate:
  `packages/objectql/src/relation-filter-lowering.ts#RELATION_FILTER_ID_CAP` (`INVALID_FILTER` / 400 past 1,000 ids).
  Letter C applies that posture to the six probes as the interim; it is honest and it serves no rows.
- The two halves of a read are one contract already: `packages/spec/src/contracts/security-service.ts#ISecurityService`
  answers `#canReadObject` (object admission, fail closed) and `#getReadFilter` (tenant Layer 0, authored RLS,
  `controlled_by_parent`, OWD and record shares; deny sentinel on any failure), and the analytics raw-SQL door asks both
  and applies the filter to every joined object (`packages/services/service-analytics/src/read-admission.ts`). What is
  missing is only the last step: evaluating that filter against P's table from inside a query on another object —
  what Postgres row-level security does with `EXISTS`, and Salesforce's sharing does for Feed and History children.

## Decision

### D1 — One leaf, declared in spec, structurally unspellable by a request

`@objectstack/spec` (`packages/spec/src/data/`) declares one **branded comparand value**, `ReadableIds`, meaning
*"the ids of records of object `object` that the reading caller may read"*. It sits where a list of ids sits today —
the comparand of `$in` on the pointer field: `{ record_id: { $in: ReadableIds.of('cpz_doc') } }`. Three properties
follow from that position, and they are the whole reason for it:

- **No request can spell it.** A request's `where` arrives as JSON and is lowered by `#parseFilterAST`; a plain object
  in a `$in` comparand is refused today by `#assertListComparandShapes` (`INVALID_FILTER` / 400). The leaf adds no
  operator to `#FieldOperatorsSchema` or `#VALID_AST_OPERATORS`, so no author — human or AI — gains a spelling, and
  nothing new has to be refused at ingress: the refusal that exists is the refusal.
- **Losing the brand fails closed.** The brand is a `Symbol.for` key (the device
  `packages/spec/src/data/filter-subtree-provenance.ts#markFilterSubtreeProvenance` already uses). A copy that crosses
  JSON, structured clone or a serializing wire arrives unbranded and is refused as a non-list comparand — ⛔ never
  dropped, which would leave `{ object_name: P }` alone and serve every row of P.
- **It is a leaf, not a form.** It composes under `$and` / `$or` / `$not` like any `$in`; the NULL-safe `$not` of the
  shared lowering applies to it unchanged.

The leaf is legal on `find`, `findOne`, `count` and `aggregate` (`where` only). On a write verb, in a `having`, or at
any position but a `$in` comparand, the engine refuses it loudly. ⛔ No second leaf, no `EXISTS`, no correlated form.

### D2 — ObjectQL composes the scope, once per parent object per request, fail closed

At the engine's own filter seam — where `packages/objectql/src/engine.ts#lowerRelationConditions` runs today, after
ingress parsing and the comparand doors — every `ReadableIds` leaf is replaced by its composed form, still branded,
before any driver sees it:

1. `canReadObject(P, caller)` false, a throw, or a service that exposes neither it nor `explain` ⇒ `$in: []`, FALSE on
   every driver (the identity the relation lowering already relies on). The caller sees nothing of P.
2. otherwise `scope = getReadFilter(P, caller)`: `undefined` ⇒ no row restriction; the deny sentinel
   (`packages/plugins/plugin-security/src/rls-compiler.ts#RLS_DENY_FILTER`) ⇒ `$in: []`; any other filter is run
   through the same lowering P's own direct read runs (comparand doors, relation lowering, the shared temporal lowering)
   so the driver receives a lowered scope, and is marked `'policy'` with `#markFilterSubtreeProvenance`, so a driver's
   refusal diagnostic withholds its operands exactly as it does for an injected RLS predicate.
3. The composed leaf carries `{ object: P, scope }`. **The tenant wall is not composed here**: the driver applies its
   own tenant scope to the subquery's table with the outer read's options (D3). The engine never re-derives it.

The engine asks the registered `ISecurityService` the way the analytics door does — both halves, every request, nothing
memoised across requests (the `getReadFilter` contract's own rule). An uncomposed leaf reaching a driver (a direct
driver call that bypassed the seam) is refused by the driver as uncomposed: fail closed, never evaluated as "no
restriction".

### D3 — Driver obligations: compile it, or refuse loudly — no capability bit

- **`driver-sql`** (`packages/drivers/driver-sql/src/sql-driver.ts#SqlDriver`) compiles the composed leaf in its filter
  compiler (`#applyFilterCondition`) to `field IN (SELECT id FROM P_TABLE WHERE SCOPE AND TENANT)`, the subquery scoped
  by `#applyTenantScope` with the outer read's options. One statement, so `find`, `count` and `aggregate` agree by
  construction. `packages/drivers/driver-sqlite-wasm/src/sqlite-wasm-driver.ts#SqliteWasmDriver` and the local
  transport of `packages/drivers/driver-turso/src/turso-driver.ts#TursoDriver` inherit it.
- **The Turso remote transport** (`packages/drivers/driver-turso/src/remote-transport.ts#RemoteTransport`, an
  independent compiler) implements the same compilation: it serves a production deployment class and is SQL.
- **`driver-memory`** (`packages/drivers/driver-memory/src/memory-driver.ts`) implements it in process — read P under
  the composed scope, then member-test — unbounded because no parameter ceiling exists in process; it refuses
  multi-tenant boot (`packages/drivers/driver-memory/src/memory-tenancy-guard.ts`), so no tenant wall is owed.
- **`driver-mongodb`** (`packages/drivers/driver-mongodb/src/mongodb-filter.ts#translateFilter`) **refuses loudly**
  until a card measures the cost of a pipeline form (open item O3); an implementation later needs no amendment here.
- **The refusal** is one envelope on every driver (ADR-0112): status 500, `INTERNAL_ERROR`, a message naming the
  driver, the leaf and the remedy, logged at `error` once per driver — a composition fault, not an author error, so
  ⛔ not `INVALID_FILTER`. A consumer does not catch it into its deny-all sentinel: the read fails and says why
  (prefer failing to falling back). ⛔ No `DriverCapabilities` bit returns: the 17.0.0 rationale stands — a bit the
  engine does not consult is inert — and here the driver answers by compiling or refusing, so there is nothing to read.
- The leaf joins the per-driver conformance case-sets, so a driver that compiles it is measured and one that refuses
  is recorded as refusing.

### D4 — The six consumers emit one leaf per parent object, and no pre-scan

- **The activity stream and the compliance ledger** keep `#computeParentRecordFilter` as the one mechanism and replace
  its body: the parent objects are enumerated from the metadata registry (every registered object outside
  `packages/plugins/plugin-audit/src/audit-writers.ts#AUDIT_EXCLUDED_OBJECTS` and outside the gated object itself);
  for each, one branch `{ object_name: P, record_id: { $in: ReadableIds.of(P) } }`, ANDed into the read's `where` as
  today. Rows naming no parent, a non-machine name, an unregistered object, the gated object itself, or a parent that no
  longer exists are excluded exactly as today (the subquery finds no such id). The ledger's outside class becomes a
  plain predicate on its own columns, and its exemption capability is decided before anything, unchanged.
- **Comment threads, reactions and attachments** take the same shape over their own pointer pairs, after the activity
  gate's switch has proven the leaf.
- **The withheld-update rule** cannot be pushed as it stands: it judges the stored `{ old, new }` change inside the
  `metadata` text column of `packages/plugins/plugin-audit/src/objects/sys-activity.object.ts#sys_activity`
  (`#isWithheldOnlyUpdate`). So `sys_activity` gains a writer-stamped column, **`changed_fields`** — the key set of the
  recorded change, stamped by the CRUD mirror from the same `packages/plugins/plugin-audit/src/audit-writers.ts#diff`
  that composes the change — and the rule becomes a predicate: an update row with a non-empty `changed_fields` none of
  whose members this reader is served is withheld. Stored rows are **backfilled** from their `metadata.old` /
  `metadata.new` keys by one idempotent stored-row migration in the shape of
  `packages/plugins/plugin-audit/src/stored-metadata-body-migration.ts#migrateStoredMetadataBodyCopies` (the object is
  `managedBy: 'append-only'`, so the backfill goes through the migration door, never the CRUD write path). A row the
  backfill cannot judge keeps the fail-closed answer it has today.

### D5 — Three classes stay on the bounded fail-closed probe, by name

Each is recognised by the engine, which **refuses to compose a leaf for it** (loud, as D3's envelope), and routed by the
consumer to today's probe before the leaf is written. ⛔ No silent fallback: the probe is chosen up front, never
reached by catching a refusal.

1. **A delegated (on-behalf-of) caller** (ADR-0090 D10). `packages/plugins/plugin-security/src/security-plugin.ts#getReadFilter`
   answers the deny sentinel for such a context because the delegator intersection is not threaded through the
   read-scope path, while the CRUD middleware intersects it; a composed leaf would serve a delegated reader nothing.
   The probe, which reads through the middleware, stays until the intersection reaches `getReadFilter`.
2. **A parent whose rows are narrowed by an object-scoped read middleware** (`packages/objectql/src/engine.ts#registerMiddleware`
   with an `object`): `sys_attachment`, `sys_comment`, `sys_comment_reaction`, `sys_approval_request`, and the two
   gated objects themselves. Their WHERE is built at read time and is no part of `getReadFilter`, so a leaf over them
   would be WIDER than a direct read. Over-inclusion (a redaction-only middleware) costs the bound; under-inclusion
   costs a leak; the rule errs to the bound.
3. **A federated parent**: P bound to a different datasource than the gated object
   (`packages/objectql/src/engine.ts#resolveDatasourceBinding`). No driver evaluates a subquery across two of them.
   ⚠️ This includes every parent of `sys_activity` on a deployment that registers the `telemetry` datasource
   (ADR-0057 §3.6, `#LIFECYCLE_DATASOURCE`): there the leaf serves consumer 1 nothing, and letter C's loud bound is what
   that deployment class has. Recorded as a limit, not solved.

### D6 — What ADR-0055 and ADR-0056 now say

ADR-0055's row (a) is reversed **for this one leaf and nothing else**: the leaf is composed by the engine from the
compiled output of the RLS compiler, whose four forms, `rlsMembership` IN-form and deliberate lack of a subquery form
are unchanged (`packages/plugins/plugin-security/src/rls-compiler.ts#RLSCompiler`). §2's mechanism (b) for
`controlled_by_parent` stands, set-size ceiling included; whether that id set becomes a seventh consumer is ⛔ not
decided here. ADR-0056's non-goal stands as written for the compiler and is revisited only as the engine-side leaf.
Each record carries one status-line pointer to this one, landed with this record; nothing else in either moves.

## Consequences

- **Positive.** A reader gets every row they may see and a `total` that is true, on any table size; the pre-scan,
  its SYSTEM window and its cross-organization contention go; six bounded probes become one mechanism; the interim
  letter C is retired from each consumer as it switches.
- **Cost, named.** Spec, engine, four driver packages, `plugin-audit`, `service-storage`, a new column and a backfill —
  roughly 3–5k lines over 6–10 PRs across three lanes, by the ruling's own estimate, with no precedent in the tree.
- **A deployment on a refusing driver** (`driver-mongodb`, until O3) reads the six objects as a loud 500, not a short
  list — the ruling's "refuse loudly"; a silent re-entry into the probe is the shape this record exists to remove.
- **The bound-parameter ceiling moves, it does not vanish.** `getReadFilter`'s scope may itself carry pre-resolved id
  lists (ADR-0055's `rlsMembership`, record shares); they now bind inside the subquery. ADR-0055's known limit is
  unchanged, and O1 names the ceilings as unmeasured.
- **A federated or telemetry-split deployment gains nothing** for the affected consumer (D5.3) and keeps letter C.
- **`changed_fields` is a schema change** on an append-only engine-owned object, with a backfill a deployment must run;
  the changeset of that card says so.

## Alternatives considered

- **B — an unbounded `$in` of every readable parent id** (the ADR-0055 shape, in `plugin-audit` alone): ⛔ ruled out.
  Past the dialect's parameter ceiling the whole read throws and the gate's catch denies it — no rows, not fewer.
- **Raising the cap**: ⛔ ruled out; it moves the cliff.
- **A general subquery or `EXISTS` form in the filter vocabulary**, or re-declaring `querySubqueries` / `joins`:
  rejected. Authorable means AI-writable; ADR-0055's reason for refusing a compiler form stands; a bit nobody consults
  is the defect 17.0.0 removed.
- **A `$`-operator spelling refused at ingress**: rejected in favour of a leaf no request can form at all — a refusal
  list is one more thing to keep closed; a branded value is closed by construction.
- **A materialised accessible-ids column** (ADR-0055 (c)): rejected for ADR-0055's reason — stale the moment access
  changes, a correctness hazard on a security primitive.
- **Amending ADR-0055 in place**: rejected. Its mechanism (b) is not changed; a new consumer set and a new engine seam
  are more than a status-line amendment carries.

## Open items (not blocking acceptance; each becomes a reading on its card)

- **O1** — the bound-parameter ceilings of SQLite, Postgres and MySQL are documented values, not measured here.
- **O2** — consumers 4–6 are source readings; the activity measurement is the only one.
- **O3** — `driver-mongodb`: the cost of a pipeline form is unprototyped; it refuses until measured.
- **O4** — `packages/plugins/plugin-sharing/src/sharing-service.ts` reads a caller's record-share grants at
  `limit: 5000` with no warning; that scope rides into the subquery unchanged. A separate finding, not this record's.
- **O5** — whether `controlled_by_parent`'s id set becomes a seventh consumer (D6).

## Acceptance criteria

The maintainer approves this record (Tier H), with the two status-line pointers it carries: ADR-0055 (row (a)
revisited for one engine-internal leaf; §2 stands) and ADR-0056 (the non-goal stands for the compiler).

## Execution plan (after acceptance)

The `domain:engine` lane (with `domain:spec`) cuts these from the accepted record; ⛔ none is filed before acceptance,
and none changes `packages/spec` before it.

| Card | Decisions | What lands | Pins (red before, green after) | Order |
|:--|:--|:--|:--|:--|
| **E1** — the leaf | D1 | `ReadableIds` in `packages/spec/src/data/`; the comparand door admits the branded value and refuses the unbranded one | a JSON round-trip of a `where` holding the leaf is refused; the plain-object spelling is refused 400 | first |
| **E2** — composition | D2, D5 | the engine seam composes the leaf, refuses it on write verbs and for D5's three classes, marks the scope `'policy'`; the conformance case-set | `canReadObject` false ⇒ no row; deny sentinel ⇒ no row; a delegated, middleware-gated or federated parent ⇒ the loud refusal | after E1 |
| **E3** — SQL family | D3 | `driver-sql` compiles the leaf inside `#applyTenantScope`; wasm and local Turso inherit; the remote transport compiles it | a reader with more than 2,000 readable candidates gets every visible row; an unreadable row stays hidden; a deleted parent is excluded; `count` equals the rows served | after E2 |
| **E4** — memory and mongodb | D3 | memory implements; mongodb refuses with the envelope | the conformance table records both | with E3 |
| **E5** — the activity and ledger switch | D4, D5 | `#computeParentRecordFilter` emits leaves, no pre-scan; D5's classes keep the probe; letter C's refusal retired from these two | the measured scenario answers 1,808 of 1,808; the exemption capability unchanged; the outside class as a predicate | after E3 |
| **E6** — `changed_fields` | D4 | the column, the writer stamp, the backfill migration, the rule as a predicate | the org-peer sign-in case stays withheld; an empty change is unaffected; the backfill is idempotent | after E5 |
| **E7** — comments, reactions, attachments | D4 | the three gates switched | each gate's own bound case | after E5 |
