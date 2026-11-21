# ADR-0155: The sharing scope's share-grant arm lowers to an engine-internal semi-join leaf over the record-share table, not a capped id list; every grant counts

**Status**: Accepted — 2026-11-17, recording the maintainer's answers to questions ①–③ (ruling record
[`6942854600`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6942854600) on #33787, verbatim:
「三问都按 ADR 推荐」): ① **A**, the subquery carries no tenant scope; ② **the recommended column, row by row**, so no
capped id list is kept anywhere; ③ **A**, the leaf's write form is admitted on a predicate `update` only. Each answer
is recorded under [Questions for the maintainer](#questions-for-the-maintainer), beside the options it was chosen
from, and every sentence of the Decision that depended on one now states it. `docs/adr/` is Tier H (Prime Directive
#14): this edit lands on a `GOVERNED_APPROVERS` approval, and the execution cards under
[Execution plan](#execution-plan-after-acceptance) are cut after it lands and ⛔ never before it. **This record
declares; it implements nothing.**
- **Date**: 2026-11-15
- **Card**: [#33899](https://github.com/objectstack-ai/objectstack/issues/33899). It is the precondition of
  [#33787](https://github.com/objectstack-ai/objectstack/issues/33787) (the defect), which is `Blocked-by` this card
  and closes when the plugin-sharing switch lands.
- **Ruling it serves**: the maintainer's 「只做根治」 on #33787 (ruling record
  [`6895275749`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6895275749), 2026-11-15T13:47Z):
  the root fix only, with no interim. The root fix is the semi-join shape. It has no compile path today, so its first
  deliverable is this record.
- **Builds on**: [ADR-0139](./0139-engine-internal-semi-join-leaf-readable-parent-ids.md) (the engine-internal
  semi-join leaf: its brand device, its position rules, its executor seam and its refusal envelope);
  [ADR-0147](./0147-membership-scoped-rls-lowers-to-an-engine-internal-org-member-semi-join-leaf.md) (Proposed: the
  first record to add a leaf under its own brand, with a fixed inner read under system authority and no tenant wall —
  the pattern this record follows and the seam it shares, [D4](#d4--the-engine-seam-and-what-is-built-once-with-adr-0147));
  [ADR-0111](./0111-record-share-management-authority-and-verb-boundary.md) D3 (a share widens edit, never delete)
  and D7 (no inert grants; only `user` recipients are enforced);
  [ADR-0142](./0142-ownership-queue-membership-claim-and-assignment-rules.md) D3 (the queue arm);
  [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) D1 and D8 (NULL is not a state; the
  driver's tenant scope is the wall's verdict); [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10
  (delegation); [ADR-0052](./0052-audit-is-not-the-activity-feed.md) §5 (the pointer pair);
  [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the refusal envelope);
  [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove).
- **Revisits**: ADR-0139 D1's "⛔ No second leaf", for one more leaf and nothing else. This is the second record to do
  so (ADR-0147 is the first), and the prohibition stays the default: a new leaf needs a Tier H record of its own. It
  answers ADR-0139's open item O4, which names this read. Three further places move, as the maintainer ruled: ADR-0139
  D1's read-verbs sentence (③ ruled A); ADR-0139 D3's "⛔ No `DriverCapabilities` bit returns" (② ruled R2 on the
  storage rows, which consults a driver declaration); and ADR-0111 D7's list of inert grants (② ruled R2).
  The dated pointer notes those records are owed are ⛔ not in this record's diff: they land with the governed edit
  that records the maintainer's rulings in this record's Status line
  ([O7](#open-items-not-blocking-acceptance-each-becomes-a-reading-on-its-card)).
- **Leaves unchanged**: every authorable surface (no operator, no CEL function, no object, permission-set or
  sharing-rule key, and no stored predicate to migrate); `sys_record_share`'s columns; its write path (grant, revoke,
  rule materialisation, the organization stamp), the by-id gates and share-management authority, which move only
  under ②'s R2, ruled for the storage rows, and only on the objects those rows name; the owner match and its depth,
  the queue arm, the source of the approval arm, the external floor, the guest denial, the phantom-anchor narrowing
  and the delegation intersection; the outer read's tenant wall; `ReadableIds` and its consumers; ADR-0147's leaf and
  its floor. The shared seam's recipient rule reads that leaf's anchor and changes nothing it carries
  ([D4](#d4--the-engine-seam-and-what-is-built-once-with-adr-0147)).
- **Consumers**: `@objectstack/spec` (the leaf's declaration, the comparand door's option, the conformance case-set,
  the `ISharingService` and `ISecurityService` prose), `@objectstack/objectql` (the door and the executor seam),
  `@objectstack/driver-sql` and the drivers that inherit it, `@objectstack/driver-turso` (its remote transport),
  `@objectstack/driver-memory`, `@objectstack/driver-mongodb`, `@objectstack/driver-odata`,
  `@objectstack/service-analytics` (its read-scope compilers), `@objectstack/plugin-security` (the read filter that
  carries the leaf; the explainer's record pass) and `@objectstack/plugin-sharing` (the one producer, and the
  switch).

---

## TL;DR

A member's read of a private, owner-scoped object carries a share arm: the records that `sys_record_share` grants to
that user. Today `packages/plugins/plugin-sharing/src/sharing-service.ts#buildReadFilter` builds the arm by reading the
user's grant rows into memory and binding their ids as a list, and that read stops at `limit: 5000`. The card states
the consequence, and this record repeats its words and adds none: past 5,000 share grants a member silently loses
access, failing closed. The predicate-update scope (`packages/plugins/plugin-sharing/src/sharing-service.ts#buildWriteFilter`)
reads the same way.

This record decides that the arm lower to one more engine-internal branded comparand, provisionally
`SharedRecordIds`, which a SQL driver compiles in the list's own position:

```sql
id IN (SELECT record_id FROM sys_record_share
       WHERE object_name = :object AND recipient_type = 'user' AND recipient_id = :user
         AND record_id IS NOT NULL AND record_id <> '')
```

Every grant then counts, whatever the count. No grant is read into memory, and the share arm binds a fixed handful
of parameters where it bound one per grant. Below today's cap the visible set is the same set; above it the answer
is the corrected one. The owner match, the queue arm and the approval arm stay in the same filter as sibling
disjuncts. No request can spell the leaf, and no author gains a spelling.

Three things were the maintainer's, put with a recommendation each, and the maintainer ruled every one as recommended
(ruling record [`6942854600`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6942854600)):

- **①** Whether the subquery carries a tenant scope. Today's grant read carries none. Ruled: none, which is parity.
- **②** What an evaluator that cannot run a subquery answers: MongoDB, OData, an object on another datasource, the
  analytics native-SQL compiler, the explainer, and with them one host class: a middleware or a find hook registered
  for the grant table by name, which the subquery would read around. A materialised list, or a refusal. Ruled: no
  list anywhere. The analytics compiler compiles the leaf and the explainer resolves it per record. On storage that
  cannot run a subquery, share grants become unsupported: refused at the grant door and no longer counted, with a
  visible trail. That takes away something that works there today, and
  [Q2](#q2--an-evaluator-that-cannot-run-the-leaf) says exactly what. The host class is refused at boot from the
  switch on, until the registration is removed, with no exemption for a registration that declares it skips system
  reads.
- **③** `buildWriteFilter` feeds a predicate `update`, and ADR-0139 D1 admits a leaf on read verbs only. Ruled: this
  leaf's write form is admitted on `update`, and nowhere else.

## Provenance

- **The defect.** [#33787](https://github.com/objectstack-ai/objectstack/issues/33787), filed from the bench report
  [`6893177082`](https://github.com/objectstack-ai/objectstack/issues/33701#issuecomment-6893177082) on #33701.
- **The R9 item.** Epic #33631's addendum
  [`6893156419`](https://github.com/objectstack-ai/objectstack/issues/33631#issuecomment-6893156419) names the
  semi-join as the target shape. The `domain:server` seat's three constraints on whoever builds it are
  [`6893239331`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6893239331): keep every arm,
  pin parity, quote the speed figure narrowly. Its item 1 is read as corrected by `6895112167` below.
- **The reading that found no compile path.** os-dev-report
  [`6895027257`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6895027257) on #33787
  (`needs_decision`): the arm cannot reuse `ReadableIds`, and its option A is a second leaf decided by a new record.
- **The routing and the independent review.**
  [`6895112167`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6895112167): an independent
  review confirmed the report's four claims and found option A under-scoped on write verbs, the analytics native-SQL
  scope, the in-process explainer and verdicts, and cross-datasource objects. [D5](#d5--the-evaluator-census),
  [Q2](#q2--an-evaluator-that-cannot-run-the-leaf) and [Q3](#q3--the-leaf-on-a-predicate-update) are that scoping. The
  same comment corrects constraint 1: "every arm stays in the same filter", not "inside the subquery".
- **The ruling.** [`6895275749`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6895275749):
  「只做根治」, and the root fix starts with this record.
- **The answers to ①–③.** The routing analysis
  [`6938582405`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6938582405) on #33787 put the
  three questions to the maintainer, who chose 「三问都按 ADR 推荐」 on 2026-11-17; ruling record
  [`6942854600`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6942854600) records it: Q1 A ·
  Q2 the recommended column · Q3 A.
- **This card and its triage.** [#33899](https://github.com/objectstack-ai/objectstack/issues/33899); triage audit
  [`6896032788`](https://github.com/objectstack-ai/objectstack/issues/33899#issuecomment-6896032788) (lane, grade, and
  the standing principle quoted under Q2).
- **This record's own reading** is of `origin/main` `b8ac0e24`. The card's was of `45dee177`. The premise holds on
  both, and [What this reading adds](#what-this-reading-adds-to-the-cards) lists where the newer reading is more exact.
  The sentences added after the at-tier review of this record
  ([`6899302526`](https://github.com/objectstack-ai/objectstack/pull/34064#issuecomment-6899302526)) were read on
  `origin/main` `27c2f1ea`, those added after its delta review
  ([`6900428326`](https://github.com/objectstack-ai/objectstack/pull/34064#issuecomment-6900428326)) on `385ea1cc`,
  and those added after its second delta review
  ([`6901557418`](https://github.com/objectstack-ai/objectstack/pull/34064#issuecomment-6901557418)) on `b29f2dd1`,
  and those added after its third delta review
  ([`6902450506`](https://github.com/objectstack-ai/objectstack/pull/34064#issuecomment-6902450506)) on `e9fb0987`.
  The sentences changed after its fourth delta review
  ([`6902721135`](https://github.com/objectstack-ai/objectstack/pull/34064#issuecomment-6902721135)) and its fifth
  ([`6902940583`](https://github.com/objectstack-ai/objectstack/pull/34064#issuecomment-6902940583)) add no new code
  reading.

## Context

### The mechanism today (read on `origin/main` `b8ac0e24`)

- **The read scope.** `packages/plugins/plugin-sharing/src/sharing-service.ts#buildReadFilter` answers `null` (no
  restriction) for a bypass or system context, an object with no registered schema, an object whose org-wide default
  is not private for this principal, an object with no owner field, and an `org` read depth. It answers the deny
  sentinel for the guest and for a context with no user id. Otherwise it composes
  `{ $or: [ownerMatch, queueMatch, { id: { $in: grantedIds } }] }`: the queue disjunct is there when the object has a
  queue column and the caller sits in a queue, the `$in` disjunct only when the list is not empty, and the owner match
  stands alone when neither is. A federated object whose owner column is the platform's injected anchor takes neither
  the owner arm nor the share arm
  (`packages/plugins/plugin-sharing/src/federated-phantom-anchors.ts#hasPhantomOwnerAnchor`).
- **The grant read.** One `find` of `sys_record_share` with `{ object_name, recipient_type: 'user', recipient_id }`, of
  which it uses `record_id`, at `limit: 5000`, with no ordering, under
  `packages/plugins/plugin-sharing/src/sharing-service.ts#SYSTEM_CTX`. That context is system authority and names no
  organization. The security middleware passes a system context through, and
  `packages/objectql/src/engine-driver-options.ts#driverReadScope` projects no driver tenant scope for such a
  context. So the read runs outside the tenant wall, and it returns the user's rows for the object whatever
  organization each row carries. `grantedRecordIds` drops a
  nullish `record_id`, stringifies the rest and drops the empty string.
- **The approval arm.** `packages/plugins/plugin-sharing/src/sharing-service.ts#pendingApproverReadGrants` asks the
  approvals service for the records a pending step waits on the caller for. They grant read only, none to a delegated
  principal, and they fail closed. Their ids are unioned into the same list as the grants' ids.
- **The queue arm.** `packages/plugins/plugin-sharing/src/sharing-service.ts#queueSittingMatch` is
  `owner_id IS NULL AND queue IN (the caller's queues)` (ADR-0142 D3): a sibling disjunct over the object's own
  columns, and no part of the id list.
- **The write scope.** `packages/plugins/plugin-sharing/src/sharing-service.ts#buildWriteFilter` scopes a predicate
  (multi-row) write wherever the object is not write-open to the caller: a `private` model and a `public_read` one
  alike. For `delete` it answers the owner match alone (ADR-0111 D3). For `update` it reads the grants the same way,
  narrowed to `packages/plugins/plugin-sharing/src/access-level.ts#WRITE_ACCESS_LEVELS` (`edit`, and the retired
  `full`, still honoured), at the same `limit: 5000`, and ORs the queue arm in. It has no approval arm, and on a
  phantom-anchor object it answers the deny sentinel. A by-id write never reads the list:
  `packages/plugins/plugin-sharing/src/sharing-service.ts#checkEdit` asks one record's rows (`record_id = :id`,
  `limit: 1`), and the delete gate has no share branch.
- **Where the scope goes.** `packages/plugins/plugin-sharing/src/sharing-plugin.ts#buildSharingMiddleware` ANDs the
  read scope into the `where` of every `find`, `findOne`, `count` and `aggregate` (the delegator's beside it,
  ADR-0090 D10) and the write scope into the `where` of a predicate `update` or `delete`.
  `packages/plugins/plugin-security/src/security-plugin-sharing-verdicts.ts#resolveSharingReadFilter` hands the same
  read scope to two more readers. One is `packages/plugins/plugin-security/src/security-plugin-read-filter.ts#getReadFilter`,
  so the scope also rides into every composed `ReadableIds` scope whose parent is such an object and into the
  analytics read-scope compilers. The other is the explainer's record pass.
- **The table.** `packages/plugins/plugin-sharing/src/objects/sys-record-share.object.ts#SysRecordShare`: `record_id`
  is the id half of a pointer pair with `object_name` (ADR-0052 §5), text on both halves, and not a relation. Only
  `recipient_type: 'user'` rows are written and enforced (ADR-0111 D7). The index
  `(object_name, recipient_type, recipient_id)` serves the grant read. A direct grant stamps the row's organization
  from the shared record, or from the acting session for a record that carries none
  (`packages/plugins/plugin-sharing/src/sharing-service.ts#resolveDirectGrantOrganization`). A rule-materialised grant
  carries its rule's, or the record's where the rule is platform-global and has none
  (`packages/plugins/plugin-sharing/src/sharing-service.ts#resolveSystemGrantOrganization`). No access gate reads the
  stamp.
- **The term used below.** An operation is *sharing-scoped* when one of the two builders composes such a filter for
  it: the object has an owner field, the caller is below `org` depth, and the object is not open to the caller on
  that side (a `private` model for a read; a `private` or `public_read` model for a predicate update; for an external
  principal, whatever the external floor leaves closed).

> **Note (2026-11-21, #33787) — `grantedRecordIds` is gone; its filter is the leaf's blank-id guard.** Plan step 6
> removed the grant read above, and `grantedRecordIds` with it, from
> `packages/plugins/plugin-sharing/src/sharing-service.ts`: the sharing scopes carry the share arm as the
> `SharedRecordIds` leaf, and no grant is read into a list. What `grantedRecordIds` did to a grant row, dropping a
> nullish or empty `record_id`, is now the blank-id guard every evaluator owes the leaf's inner read, declared with
> `packages/spec/src/data/fixed-read-leaf.ts#FixedInnerRead` (D2's blank-id guard bullet). The grant-read bullet
> above anchored the removed symbol; it now names the symbol bare, as D2 does, and this note carries the live
> anchor. The bullet otherwise stands as written, a reading of `b8ac0e24`.

### Why no existing form serves

- **`ReadableIds` means one thing**: the ids of P this caller may read. Its SQL always projects the parent's `id`
  (`packages/drivers/driver-sql/src/sql-driver.ts#readableIdsSubquery`), under a scope the engine composes from the
  security service and under the outer read's tenant scope. It has no slot for another projected column or for a fixed
  system predicate, and ADR-0147's alternatives rejected giving it one: one brand carries one meaning.
- **The filter vocabulary is closed** (`packages/spec/src/data/filter.zod.ts#VALID_AST_OPERATORS`) and has no
  subquery operator. An authorable one is the form ADR-0139 refused, because authorable means request-spellable.
- **The nested-relation lowering materialises** an id list and refuses past
  `packages/objectql/src/relation-filter-lowering.ts#RELATION_FILTER_ID_CAP` (1,000), and `record_id` is not a relation.
- **A longer list is not an answer.** The ruling behind ADR-0139
  ([`6097072172`](https://github.com/objectstack-ai/objectstack/issues/22590#issuecomment-6097072172)) took neither an
  unbounded `$in` nor a raised cap for that record's class: one moves the cliff to the dialect's bound-parameter
  ceiling, the other moves it by a constant.
- **ADR-0139 D1 ends "⛔ No second leaf, no `EXISTS`, no correlated form"**, and its O4 records this very read as "A
  separate finding, not this record's". ADR-0147 is the precedent for one more leaf under its own brand.

### What it costs

- **The defect**, in the card's words: past 5,000 share grants a member silently loses access, failing closed. It is
  triaged p2, and the maintainer ruled no interim knowing it stays until the switch lands.
- **Every sharing-scoped operation reads the grants again.** A list page is a `find` and a `count`, so two grant
  reads, and each statement then binds one parameter per grant. Inside a `controlled_by_parent` read the list binds
  once more, within the parent's subquery.
- **The measured figure, quoted as narrowly as the seat constrained it** (`6893239331` item 3). It covers the scope
  statements alone: the account page, its total and the two grant reads, at 1M rows and 5,000 grants. There the
  id-list scope against the semi-join scope read PG 21.6 → 7.0 ms. SQLite read 18.3 → 12.1 ms for the same pair, and
  the line-item chain stayed flat. It is not a whole-request figure, and no card under this record may claim more.

### What this reading adds to the card's

- **The write scope's share arm exists on `update` only**, and only on the predicate door. `delete` never had one and
  the by-id gates read one record, so ③ is about one verb.
- **Every addressed predicate write is already narrowed to the rows the read door returns**, at most 10,000 of them,
  with a loud refusal above (`packages/plugins/plugin-security/src/security-plugin-addressed-writes.ts#readableRowsScopeForPredicateWrite`,
  `packages/plugins/plugin-security/src/security-plugin.ts#PREDICATE_WRITE_READABLE_ID_CAP`). That bounds the rows a
  predicate update touches. The narrowing is a read through the read door, so it carries the read scope's share arm.
  What it leaves out is the write scope's.
- **"Share rows can carry a NULL organization" is narrower than it reads.** ADR-0131 D1 makes NULL not a state, and
  that record's TL;DR (item 2) and D3 name a record share among the rows that carry their organization, NOT NULL.
  What remains is ADR-0131's own exceptions: a lean embedding that registers no organization object, and rows an
  uncertified database still holds. The parity argument under ① does not rest on those rows: today's grant read
  consults no organization at all.
- **The share disjunct becomes universal.** Today it is present only for a caller who holds a grant or a pending
  approval. As a leaf it is present on every sharing-scoped operation, so an evaluator's answer to ② is met by
  nearly every member read of such an object, not by grantees alone.
- **The analytics native compiler has a third answer.** It need not choose between a list and a refusal: the leaf
  needs no composition, so that compiler can compile it.
- **The explainer judges one record at a time**, and for one record the leaf is one indexed point read, the read
  `checkEdit` already makes. That is exact at every grant count, and it is neither a list nor a refusal.

## Decision

### D-0 — The same-set invariant

Name the set once, so every later sentence can point at it:

- **G(object, user, levels)** is the set of `record_id` values over the `sys_record_share` rows with
  `object_name = object`, `recipient_type = 'user'`, `recipient_id = user`, a `record_id` that is neither NULL nor
  empty, and, where `levels` is given, an `access_level` in `levels`. It is read with system authority, with no
  organization predicate (① ruled A), with no cap and no ordering.
- **The leaf denotes G, the whole of it.** Today's list is at most 5,000 members of G.
- **Below the cap nothing changes.** Where a caller's rows number 5,000 or fewer, today's list is G, and every read
  and every predicate update answers the same rows before and after the switch, on every evaluator that evaluates
  the leaf.
- **Above it the answer is the corrected one**: every member of G counts.
- **Nothing else moves.** No row enters or leaves a scope through the owner match or its depth, the queue arm, the
  approval arm, the org-wide default, the external floor, the guest denial, the phantom-anchor narrowing, the
  delegation intersection or the outer read's tenant wall. One exception: on a host with a registration that names no
  object and changes a system read of `sys_record_share`, the share arm's rows can differ after the switch, and the
  host is told (D4's boundary; the price is among Q2's costs).
- **An outer key of another type answers the same rows.** Where an object's `id` column is not a string, the subquery
  answers the rows today's list answers (O2). A refusal there would narrow this invariant on that object, so it is no
  driver card's to choose: a card that cannot keep the same rows stops, and the case goes to the maintainer under ②.
- **Anything beyond that is a visibility change, and it is the maintainer's first.** That is why ①, ② and ③ were put
  as questions: each had an answer that keeps this invariant and an answer that narrows it on purpose. ①'s A and ③'s
  A keep it. ②'s ruled answer is the one visibility change made on purpose, and only where Q2's costs say: on the
  storage rows that cannot run the leaf, which evaluate no leaf and so sit outside this invariant, share grants stop
  counting.

### D1 — The leaf: its own brand, engine-internal, never authorable

- **One more branded comparand, declared in spec.** `@objectstack/spec` declares it in `packages/spec/src/data/`
  beside `packages/spec/src/data/readable-ids.ts#ReadableIds`, with ADR-0139 D1's device unchanged: the brand is a
  `Symbol.for` key, non-enumerable, and the value is frozen. A copy that crosses JSON, structured clone or a
  serializing wire arrives unbranded and is refused as a non-list comparand (`INVALID_FILTER` / 400). ⛔ It is never
  dropped and never read as an empty list.
- **Its own brand.** It is not a mode of `ReadableIds` and not a mode of ADR-0147's leaf. ADR-0147 D-a reads ADR-0139
  D1's reason for one leaf as this: one brand carries one meaning, so no composer has to ask which meaning it holds.
  This record keeps that reason the same way, by giving each further meaning a brand of its own.
- **What it carries: the inputs of G and nothing else.** The object's name, the recipient's user id, and the admitted
  access levels: none on the read form, which admits every level, and `WRITE_ACCESS_LEVELS` on the write form
  (③ ruled A), supplied by the producer so the level vocabulary keeps its one home. `recipient_type = 'user'` is fixed, not
  carried. It carries no organization, no caller scope and no reading context. The inputs are ordinary enumerable
  properties, as `ReadableIds`' object name is, so two users' leaves never compare or serialise as equal; only the
  brand is non-enumerable. The rest of its representation is the spec card's.
- **The recipient is the producer's.** It is captured from the context the scope is built for, where today's
  `recipient_id` comes from. ⛔ No seam and no driver re-derives it from the reading context. The seam checks it
  against that context and never replaces it ([D4](#d4--the-engine-seam-and-what-is-built-once-with-adr-0147)).
- **It arrives composed.** It asks no security service and composes no scope, so the engine's executor seam passes
  it through ([D4](#d4--the-engine-seam-and-what-is-built-once-with-adr-0147)).
- **Position.** It is legal only as the `$in` comparand of `id` on the object it names: directly in that object's
  `where`, or inside the composed scope of a `ReadableIds` leaf whose parent is that object. There it composes under
  `$and`, `$or` and `$not` like any `$in`.
- **Verbs.** `find`, `findOne`, `count` and `aggregate`, `where` only, and its write form in the `where` of a predicate
  `update` (③ ruled A). On `delete`, in a `having`, or at any other position, the engine refuses it loudly, as
  ADR-0139 D1 refuses a misplaced `ReadableIds`.
- **No request can spell it, and no author gains a spelling.** No operator joins
  `packages/spec/src/data/filter.zod.ts#VALID_AST_OPERATORS`, and there is no CEL function and no lint vocabulary.
  One producer writes it: plugin-sharing's read-scope builder, and its write-scope builder (③ ruled A).
- **⛔ No `EXISTS`, no correlated form, no join.** It sits in the list's own position, so `find`, `count` and
  `aggregate` agree by construction, and a record matched by several grant rows is still one row.
- **The name.** `SharedRecordIds` is provisional ([O1](#open-items-not-blocking-acceptance-each-becomes-a-reading-on-its-card)):
  a new public name is the seat's call. It names what the ids are, record ids, because a name read as "the ids of the
  grants" points at the wrong column.

### D2 — The inner read: today's grant read, with no cap

The subquery is `buildReadFilter`'s own read restated as SQL, with the `limit` gone and nothing added:

```sql
-- the read form
id IN (SELECT record_id FROM sys_record_share
       WHERE object_name = :object AND recipient_type = 'user' AND recipient_id = :user
         AND record_id IS NOT NULL AND record_id <> '')

-- the write form (③ ruled A) adds one predicate inside the subquery
         AND access_level IN (:levels)
```

- **System authority.** No row-level security, org-wide default, sharing or field-level security applies to
  `sys_record_share` here. Today's read runs under `SYSTEM_CTX`, and the sharing service bypasses its own table.
- **Tenant scope: none (① ruled A).** Today's read carries none, and the subquery carries none either: the
  driver ⛔ does not apply `packages/drivers/driver-sql/src/sql-driver.ts#applyTenantScope` to it. The driver card
  records that absence against the driver's read-side chokepoint guard (`scripts/check-tenant-chokepoint.mjs`): an
  exemption citing this record if the guard reads the builder, a pin if it does not. So it reads as a decision and
  not as an oversight. The outer statement's wall is untouched either way.
- **No validity, status or source filter.** Today's read has none, and adding one narrows G.
- **The blank-id guard** restates `grantedRecordIds`' filter. It also keeps a negation NULL-safe: `id NOT IN (…)` over
  a subquery that holds one NULL is never true, so it would answer no row at all.
- **Set semantics.** Several grant rows on one record (one per source, ADR-0111 D7, and one per rule) are one member.
  Nothing de-duplicates, and nothing needs to.
- **No cap, no ordering.** The `limit` is not raised and not made loud. It is gone, because nothing is materialised.
- **Same datasource.** The subquery reads `sys_record_share` on the datasource the outer object is bound to. An object
  bound to another one is in ②'s census, ruled R2 with R1 behind it: no driver evaluates a subquery across two.
- **Index-backed** by `(object_name, recipient_type, recipient_id)`. Whether that index should also carry `record_id`
  is a measurement on the driver card (O3).
- **Key comparison.** Both keys are strings on every table the platform manages (`id` a `varchar`, `record_id` a
  `text`), and today's list is normalised through `String()`. Where an outer key is of another type, the compiled
  form owes the same rows or a loud refusal, ⛔ never a silent miss (O2).
- **Statement time.** The subquery reads the grants when the statement runs. Today's list is read once per operation,
  before its statement. A grant or a revoke is therefore seen no later than it is today.

### D3 — Every arm stays in the same filter

After the switch the read scope is:

```text
{ $or: [ ownerMatch,
         queueMatch,                                       when the object has a queue column and the caller sits in a queue
         { id: { $in: SharedRecordIds(object, user) } },
         { id: { $in: approvalIds } } ] }                  when the approvals service names any
```

- **The seat's rule, as corrected** (`6895112167`): every arm stays in the same filter. ⛔ None moves to the
  application, and none is dropped.
- **The approval ids become a disjunct of their own.** Today they are unioned into the grant list. A union of two id
  sets and an OR of two memberships select the same rows. They stay a list: they are not share rows, the approvals
  service vouches for them, and no subquery over `sys_record_share` can express them.
- **The queue arm stays a sibling disjunct** over the object's own columns. ⛔ It is never moved into the share
  subquery, which cannot express it.
- **The owner match is unchanged**, at every depth.
- **The share disjunct is always present** on a sharing-scoped read, on every object ② leaves it on (R2, ruled for
  the storage rows, takes it off theirs). Today it is absent for a caller with no grant. An empty subquery admits
  nothing, so the rows are the same.
- **The write scope** takes the same shape with the write form (③ ruled A) and, as today, no approval arm. `delete` keeps
  answering the owner match alone, and no leaf is ever written on it.
- **A phantom-anchor object** keeps today's answers: on a read the approval ids or the deny sentinel, on a predicate
  write the deny sentinel, and no share arm on either.
- **A delegated operation** carries one leaf per identity, each on its own side of the ADR-0090 D10 intersection,
  where it carries two lists today.
- **The outer read's tenant wall** is composed where it is composed today.

### D4 — The engine seam, and what is built once with ADR-0147

**The seam.**

- **Admission.** Two callers admit `ReadableIds` today, through
  `packages/spec/src/data/filter-comparand-shape.ts#ListComparandShapeOptions`: the engine's comparand door
  (`packages/objectql/src/filter-comparand-shape.ts#assertListComparandShapes`), and the analytics merges that hand a
  read scope on to the engine (`packages/services/service-analytics/src/read-scope-sql.ts#assertReadScopeComparandsRunnable`).
  The engine's door admits this brand the same way. The analytics merges are a row of ②, ruled to admit the brand.
  ⛔ No other caller admits it.
- **Pass-through.** At the executor boundary (`packages/objectql/src/engine.ts#composeReadableIdsAtBoundary`) there is
  nothing to compose. The seam checks position and verb (D1) and the recipient (next), and hands the leaf to the
  driver as it stands.
- **The recipient rule.** The seam admits the leaf only when its recipient is the user of the context the operation
  runs under (the reading context; under ③, the predicate update's), or that context's delegator (ADR-0090 D10). Those
  are the two identities D3 writes a leaf for. A system context is the one exemption, and it is stated here: it is the
  platform's own code, it already holds every authority, and it may carry a scope composed for any principal. Any
  other recipient is a composition fault, answered with the refusal below. The reason is one ADR-0139 already acts
  on: a composed scope is trusted only for the principal it was composed for. `ReadableIds` keeps that by
  construction. The engine composes it for the reading caller on every request (its D2), and no door admits a leaf
  that arrives composed (`packages/spec/src/data/readable-ids.ts#ComposedReadableIds`). This leaf arrives composed
  (D1), so the seam keeps the same rule by a check. The check compares, and ⛔ it never replaces the recipient (D1). It
  holds at every occurrence the seam descends to, on the write form as on the read form. It is the seam's rule alone:
  an in-process judge that is handed another principal's scope, as the explainer is, reaches no seam. Under ②'s
  ruled answer the analytics native-SQL compiler compiles the leaf with no seam in front of it, and the seam's
  position, verb and recipient checks hold there by construction: one strategy context, built per request
  (`packages/services/service-analytics/src/analytics-service.ts#callCtx`), asks for the scope under the request's
  context and issues the statement that carries it. That compiler compiles the leaf only where the seam would hand
  it to a driver. Where either of the two classes below applies, it declines the query to the engine strategy before
  anything compiles, so the class gets the answer ② ruled for it, at boot or from the seam after it: R2 with R1
  behind it for an object on another datasource, and R1 at boot, with the seam's refusal behind it, for the host
  class. Each class has one answer, and the seam's answer is this record's.
- **The same rule on ADR-0147's anchor, in full.** The seam is built once for both leaves (below), and it holds one
  rule for both: every identity named by a leaf that arrives composed is compared with what the reading context
  itself carries. This leaf names one, its recipient, and the context carries its user and its delegator (above).
  ADR-0147's leaf names two, the caller and the organization of its anchor, and the context carries an anchor of its
  own, which ADR-0147 D-e has the builders and carriers of the list carry. The seam compares the two anchors, caller
  and organization together, and admits the leaf only when both are equal. Nothing is re-derived from the reading
  context's `userId` or `tenantId` (ADR-0147 D-a). ADR-0147 D-c names the context that needs it so: the delegator's
  rebuilt context (`packages/plugins/plugin-security/src/explain-engine.ts#resolveDelegatorContext`) carries the
  live principal's list, and after that record the live principal's anchor, under the delegator's user and with no
  delegation link. It is a reading context: on a delegated write to a `controlled_by_parent` detail the master's
  write gate runs once per principal, and its delegator pass reads the master under that context
  (`packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#assertControlledByParentChainEditable`).
  A leaf compiled under that context carries the same anchor, and the seam admits it. A reading context that carries
  no anchor matches none. A system context is the same one exemption, and any mismatch is the same composition
  fault, answered with the refusal below. This record states the rule in full, for both fields, and does not leave
  the caller to ADR-0147's cross-reference note. That note (O7) carries the rule into ADR-0147, and it lands with
  this record's other pointer notes.
- **Every occurrence, nested ones included.** The scope the engine composes for a `ReadableIds` leaf is the security
  service's read filter for the parent (`packages/objectql/src/engine-readable-ids-permission-formula.ts#composeReadableIdsChain`),
  and for a sharing-scoped parent that filter carries this leaf. The seam's checks descend into composed scopes.
  `driver-sql` compiles a composed scope with the same compiler, so the leaf compiles there too.
- **Two classes the seam recognises before the driver call.** The first is an object bound to another datasource than
  `sys_record_share` (`packages/objectql/src/engine.ts#resolveDatasourceBinding`). The second is a registration made
  for `sys_record_share` by name, which today's grant read runs and the subquery would read around. It has two
  kinds, treated alike: an object-scoped middleware (`packages/objectql/src/engine.ts#hasObjectMiddleware`), which is
  ADR-0139 D5.2's class, and a find hook, `beforeFind` or `afterFind`
  (`packages/objectql/src/engine.ts#registerHook`), which this record adds for this table. ⛔ The seam never reads
  around either. What each class answers is ②'s, as ruled, and each is a row of Q2's census. No package in this
  repository names the table in either kind of registration on its own. plugin-audit registers its record-view hook for the objects a
  host opts in, so a host that opts this table in is in the class. That hook returns at once on a system read
  (`packages/plugins/plugin-audit/src/read-audit.ts#installReadAuditWriter`, through its record-view handler), which
  the grant read is.
  "Treated alike" holds for such a registration all the same: the seam and the boot check read a registration by the
  object it names, and nothing the engine holds says what a handler does on a system read. So this record keeps it
  in the class. The other answer exempted a registration that declares it skips system reads, on a declaration the
  engine enforces. Q2 priced both, in its host row and its cost list, and the maintainer ruled under ② that the class
  is kept whole: a registration that declares it skips system reads stays in the class, and no such declaration is
  added. Hosts outside this repository were not read, and O8's census looks for both kinds.
- **The class's boundary: a registration that names no object.** A middleware registered with no `object` (or with
  `'*'`), and a find hook registered for no object, run on every read, today's grant read among them; from the switch
  on, the subquery does not run them. They are outside the second class, on the line ADR-0139 D5.2 draws for its
  leaf: the engine recognises a registration by the object it names, and counts no global one
  (`packages/objectql/src/engine.ts#hasObjectMiddleware`). A registration keyed to no object says nothing the engine
  can read about one table, and platform plugins in this repository register middleware that names no object
  (`packages/plugins/organizations/src/organizations-plugin.ts` is one), so a class that took them in would refuse
  every host that runs such a plugin. The rule this record keeps for them: a sharing-scoped read answers the same
  rows before and after the switch on every host, or the host is told. The contract prose of plan step 1 and the
  switch card's changeset (plan step 6) tell it one thing: a narrowing of reads of `sys_record_share` registered for
  that table by name is never read around, and the host gets the answer ② ruled for the second class (R1 at boot,
  with the seam's refusal behind it); a narrowing
  that names no object is not run on the share arm. That line has a price, stated among Q2's costs: on a host whose
  registration names no object and changes a system read of the table, D-0's same rows rest on the telling alone.
  O8's census reads registrations that name no object as well, and records any that changes a system read of the
  table; this record's own reading at `e9fb0987` (Provenance) found none in this repository. The maintainer ruled
  this boundary with Q2's host row, on the recommended line: a registration that names no object stays outside the
  class, and the host is told.
- **The refusal** is ADR-0139 D3's envelope wherever it occurs: status 500, `INTERNAL_ERROR`, a message naming the
  evaluator, the leaf and the remedy, logged at `error` once per evaluator
  (`packages/core/src/utils/readable-ids-driver-refusal.ts#refuseReadableIdsOnce` is the device). ⛔ It is not
  `INVALID_FILTER`: the fault is a composition's, not an author's.

**Built once.** The card records ADR-0147 as approved and unbuilt, and its Status line still reads `Proposed`. Both
records add a leaf that is a branded `$in` comparand, arrives composed, and compiles to a fixed inner read of one
platform table under system authority, behind a blank-id guard, with no tenant scope (ADR-0147 D-b; here, ① ruled
A). That is one mechanism:

| Piece | Built |
|:--|:--|
| The brand, its factory and guard, its meaning, its producer | per leaf, never shared: one brand, one meaning |
| The comparand door's admission of engine-internal comparands | once, as one option that names the brands it admits, not one flag per brand |
| The executor seam's pass-through, its position and verb checks, its recipient rule, its descent into composed scopes | once. The recipient rule compares this leaf's recipient with the reading context's user and delegator, and ADR-0147's anchor, caller and organization together, with the anchor that context carries |
| The fixed inner read: one table, one projected column, a closed set of bound equality and membership predicates, the blank-id guard, system authority, and the tenant scope each record rules for its leaf (none in ADR-0147 D-b; none here, ① ruled A) | once per evaluator (`driver-sql`, the Turso remote transport, `driver-memory`, and the analytics native compiler, which ② ruled compiles it). Each leaf supplies its description, and no evaluator restates either leaf's predicate by hand |
| What a leaf compiles to outside its subquery | per leaf. ADR-0147 ORs its caller arm in, and issues no subquery when no organization is active (its D-a and D-c). This leaf is the subquery alone |
| The recognition of D4's two classes | once, in the seam. The analytics native compiler asks the seam's recognition before it compiles and restates none |
| The refusal envelope and its once-per-evaluator log | once |
| The conformance case-set | once, with a case per leaf |
| A driver's declaration that it evaluates such leaves | once, if either record consults one. ADR-0147 D-d does. This record does: ② ruled R2 for the storage rows, which consults one |
| What an evaluator that cannot run a leaf answers | per leaf. ADR-0147 D-d states its own; this record's is ② as ruled |

- **Sequencing.** Whichever record's cards are cut first build the shared pieces in the two-leaf shape, and the other
  record's cards add their leaf on top. ⛔ Neither builds a private copy.
- **This record does not revisit ADR-0147's decisions.** The recipient rule is the shared seam's: it checks that
  record's anchor, and it changes neither what the anchor carries nor where it is captured (its D-a and D-c).
  ADR-0147's floor was chosen for a leaf whose refusal would fail every `sys_user` read, and whether the SQL-first
  rule changes that answer is that record's question (O6).

### D5 — The evaluator census

One rule holds for every evaluator, whatever ② rules: **an evaluator evaluates the leaf exactly, or refuses it
loudly. ⛔ It never reads it as an ordinary comparand.** The in-process matcher shows why:
`packages/formula/src/matches-filter.ts#matchesFilterCondition` answers `false` for an `$in` whose comparand is not an
array, where this rule asks for a refusal.

Three rows are not in question:

| Evaluator | Answer |
|:--|:--|
| `driver-sql`; `driver-sqlite-wasm` and the local Turso transport, which inherit it | compiles, in `packages/drivers/driver-sql/src/sql-driver.ts#applyFilterCondition`, beside the `ReadableIds` arm |
| the Turso remote transport (`packages/drivers/driver-turso/src/remote-transport.ts#RemoteTransport`, an independent compiler) | compiles the same SQL |
| `driver-memory` | evaluates in process, as it evaluates `ReadableIds` (`packages/drivers/driver-memory/src/memory-driver.ts#readableParentIds`): it reads the store's `sys_record_share` rows under the fixed predicate and member-tests them, unbounded and hashed once. It refuses a tenant-scoped call and a multi-tenant boot, so ① does not arise there |

`driver-memory`'s row is not the slower path Prime Directive 5 forbids. In-process evaluation is that driver's only
way to answer anything, the engine's own suites run on it, and the card's plan builds it (item 7). The standing
principle quoted under ② names memory beside MongoDB, so the maintainer could have moved this row under ② as well. Its
cost there was that every suite which exercises record sharing on `driver-memory` moves to SQLite. ② was ruled on its
recommended column, which does not hold this row, so the row stands as stated here.

The rest of the census is ②, ruled row by row in [Q2](#q2--an-evaluator-that-cannot-run-the-leaf): `driver-mongodb`,
`driver-odata`, a driver this repository does not ship, an object on another datasource, the analytics read-scope
compilers, the explainer's record pass, and the host class D4 recognises.

### D6 — What the switch must show

The plugin-sharing switch is where #33787 ends. Its card carries the pins the defect card and the seat set (#33787's
body; `6893239331` item 2):

- **Parity below the cap.** At 5,000 grants the leaf and today's id list answer the same, on SQLite and on
  PostgreSQL, for the list total and for GET by id, with each arm exercised: owner, queue, approval and share.
- **The corrected answer at the edge and above it.** At 5,001 and at 6,000 grants. 6,000 grants plus 1,000 owned
  records is 7,000 visible, and the 6,000th granted record answers 200.
- **Both scopes**: the read scope, and the predicate-update scope, which carries the leaf's write form (③ ruled A).
- **Ablated**, as the seat's constraint asks.
- **The speed figure** is quoted as [What it costs](#what-it-costs) quotes it, and no wider.

This record adds two more:

- **The nested and the delegated positions.** The leaf inside a composed `ReadableIds` scope (D4), and the pair of
  leaves a delegated operation carries (D3), answer the rows today's lists answer below the cap.
- **The caller with no grant.** This statement changes shape most. For a caller who holds no grant and no pending
  approval, and sits in no queue, today's scope is the bare owner match. After the switch it is an `$or` with the
  subquery arm, on every list page and its total. The driver card reads the plan and the timing of that page and its
  total on SQLite and on PostgreSQL, against today's statement, and says whether the planner still serves it from the
  owner index. The switch quotes that reading. It is not measured here.

## Questions for the maintainer

Each question states today's fact, the options, what each option costs, and a recommendation. Until the maintainer
rules, a recommendation is not a decision, and no execution card is cut.

**Ruled, all three, on 2026-11-17.** The maintainer chose the option 「三问都按 ADR 推荐」 on the decision card for
#33787 (2026-11-17T08:25:25Z), whose text reads in full:
「子查询不加租户墙；Mongo 等库上共享授权停用并响亮拒收，不留 id 列表；只在 update 上放行这个叶子。」. Ruling record
[`6942854600`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6942854600) records it against
the routing analysis [`6938582405`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6938582405):
Q1 A · Q2 the recommended column · Q3 A. Each section below keeps its options and their costs as the record of what
was weighed, and ends with its ruling.

### Q1 — The tenant scope of the subquery

**Today.** The grant read carries no tenant scope ([Context](#the-mechanism-today-read-on-originmain-b8ac0e24)). Every
access gate that consults share rows reads them the same way: the list scope, the by-id edit gate and the explainer.
None of them reads the organization a grant row is stamped with.

**Option A — no tenant scope (parity). Recommended.** The subquery is G as D-0 defines it: system authority and no
wall. The visible set is today's below the cap and the corrected one above it, under every posture. The records stay
behind the outer statement's wall, composed exactly as today: a record outside the reader's organizations is not
selected, whatever the subquery holds.

**Option B — the subquery takes the outer read's tenant scope**, as ADR-0139's `ReadableIds` subquery does. That
narrows G by the grant row's stamp:

- Under the `single` posture nothing changes: that posture has no wall between organizations for the driver to apply.
- Under `isolated` and `group`, a grant stamped outside the reader's scope stops counting. Where the stamp is the
  record's own organization (a direct grant on an object with a tenant column), nothing visible changes: the outer
  wall already decides that record. Where the two can differ (a grant on an object with no tenant column, stamped
  with the granting session's organization; a grant materialised by a rule that has an organization, stamped with the
  rule's and not the record's), a reader whose scope excludes the stamp loses a record they read today.
- A grant row with no organization stops counting wherever a tenant scope applies. ADR-0131 D1 leaves such rows to
  an uncertified database.
- The by-id gates and the explainer would have to take the same wall in the same change, or the list and the by-id
  answer disagree about one record.

**What B buys** is a second wall on rows whose records the outer wall already governs. Beyond that redundancy its
only effect is the narrowing above, which is a visibility change with its own migration reading.

**Recommendation: A.** It is the invariant (D-0), and it is what ADR-0147 D-b states for its own leaf, for the same
reason: the wall's only lawful effect on the inner read is redundancy, and anything more changes the set. B stays
available as a decision of its own. If grants are to be walled by their stamp, that is ruled for every gate that reads
them, with a migration reading, and not as a side effect of removing a cap.

**Ruled A** (2026-11-17, ruling record
[`6942854600`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6942854600), 「子查询不加租户墙」):
the subquery carries no tenant scope, in parity with today's grant read (D-0, D2). B was not taken; walling grants by
their stamp remains a decision of its own, for every gate that reads them.

### Q2 — An evaluator that cannot run the leaf

**Today.** These evaluators receive an ordinary `id IN (list)` arm and answer it like any list, up to the cap. Nothing
in the scope builders looks at where the object is stored, the phantom-anchor rule apart.

**The standing principle.** The maintainer, on the triage thread on 2026-11-15, as quoted in triage comment
[`6896032788`](https://github.com/objectstack-ai/objectstack/issues/33899#issuecomment-6896032788):
「有的功能如果Mongo内存不支持，那就不需要支持，首先保sql,应该用最高性能的方案，而不能为了兼容而兼容」. AGENTS.md Prime
Directive 5 states the rule in force (ruling record `6888468549`): "build a query capability at its fastest SQL shape
(JOIN or semi-join, aggregates in the database); memory and mongo refuse what they cannot run with a stable code; ⛔
never a slower path built only for parity". ADR-0147 D-d chose the other way for its leaf, an exact-array floor.
The principle names memory, and `driver-memory`'s row is decided in [D5](#d5--the-evaluator-census), outside the
census below: the maintainer may move this row under ② as well, at the cost D5 states. The ruling did not move it.

**The three answers an evaluator can give.**

- **L — keep a list.** The engine substitutes a materialised id list for the leaf before the call, chosen up front
  from a declaration the driver makes (ADR-0147 D-d's device), ⛔ never by catching a refusal. To keep "never drop
  silently" the list is complete up to a bind-safe bound, with a loud refusal past it. This is the fallback the
  independent review described, with a refusal where it had an error-level log.
- **R1 — refuse the read.** The producer writes the leaf for every object, and an evaluator that cannot run it
  refuses with D4's envelope. This is ADR-0139 D3 as written, and it needs no declaration.
- **R2 — refuse the feature.** Share grants are not supported on an object whose evaluator cannot run the leaf. The
  producer writes no share arm there, every gate stops consulting grants on that object, and the grant door and the
  sharing-rule save door refuse them as inert: ADR-0111 D7's rule with one more arm, `SHARING_NOT_ENABLED` / 422. A
  leaf that still reaches such an evaluator is refused as in R1. It needs the declaration, to know up front.

**The census.** The by-id sharing verdicts are not in it: they read one record's grant rows and never receive the
leaf (`packages/plugins/plugin-security/src/security-plugin-sharing-verdicts.ts#resolveSharingCanEdit`). In the table,
"such an object" is one a caller's operations are sharing-scoped on. One row is not an evaluator: the host class D4
recognises second. It is here because the same three answers apply to it.

| Evaluator | If it keeps a list (L) | If it refuses | Recommended |
|:--|:--|:--|:--|
| `driver-mongodb` (`packages/drivers/driver-mongodb/src/mongodb-filter.ts#translateFilter`, which refuses `ReadableIds`) | Everything that works today keeps working, up to the bound. The engine keeps a second evaluation path and a completion read per operation | **R1**: every sharing-scoped read and predicate update fails with 500, rows the caller owns included, because the leaf is on every such operation. **R2**: owner, queue and approval access is unchanged; share grants on those objects stop counting and can no longer be created | **R2**, with R1 behind it |
| `driver-odata` (`packages/drivers/driver-odata/src/odata-driver.ts#refuseReadableIds`) | As above; the backend's own ceiling is its request length | As above | **R2**, with R1 behind it |
| A driver this repository does not ship | As above, unless it declares that it evaluates the leaf | As above | **R2**, with R1 behind it |
| An object bound to another datasource than `sys_record_share`. That includes a federated object that declares a real remote owner column, which keeps its shares today (`packages/plugins/plugin-sharing/src/sharing-service.ts#inertGrantReason`) | As above | As above | **R2**, with R1 behind it |
| A host that registers an object-scoped middleware or a find hook for `sys_record_share` by name (D4's second class). Today's grant read runs the registration, and the subquery would not. No package in this repository names the table in one on its own, but a host that opts the table into plugin-audit's record-view auditing is in the class (D4), although that hook returns at once on a system read, which the grant read is. A registration that names no object is outside the class, and the host is told (D4's boundary) | The list is read through the engine, so the registration still runs and what works today keeps working, up to the bound. The SQL family keeps a list path for this class | **R1**: every sharing-scoped read and predicate update on that host fails with 500 until the registration is removed. For a host whose registration is that opt-in, removing it gives up record-view auditing of share rows. A boot check can name the registration, middleware or hook, and refuse the boot before any request is served. ADR-0139 D5's seventh-consumer note is the precedent, and it is keyed on what writes the leaf: the boot there refuses a `controlled_by_parent` detail whose master is in the middleware class, not the middleware alone. So the check lands with the switch (plan step 6) and refuses only where a producer writes the leaf: until then today's grant read still runs the registration, and nothing reads around it. A registration made after boot still meets the seam's refusal at read. **R2**: record sharing is unsupported on that host. No object takes a share arm, grants stop counting and are refused at both doors, and owner, queue and approval access is unchanged | **R1, at boot**, with the seam's refusal behind it, and the class kept whole (D4). The other answer exempts a registration that declares it skips system reads; its price is that declaration on hook registration, enforced by the engine. Ruled: the class kept whole, with no exemption. The boundary is ruled with this row, on the recommended line: the recommended line leaves a registration that names no object outside the class and tells the host (D4); the other line refuses at boot every host that has one, which includes every host running a platform plugin that registers one |
| The analytics native-SQL compiler (`packages/services/service-analytics/src/read-scope-sql.ts#compileScopedFilterToSql`). Today it binds one parameter per `$in` member and refuses `ReadableIds` at entry | The cap, or an unbounded list, returns on this path | It declines the query to the engine strategy, as it does for `ReadableIds` (`packages/services/service-analytics/src/strategies/native-sql-strategy.ts#readScopeCarriesReadableIds`). With the leaf on every sharing-scoped read, that is nearly every member query on such an object, and the shapes only native SQL serves, such as a multi-hop join (`packages/services/service-analytics/src/strategies/cross-object-where.ts#UnservedCrossObjectReason`), are then refused | **Neither: it compiles the leaf**, where the seam would hand the leaf to a driver. It is SQL, and the leaf needs no composition. Where either of D4's two classes applies, it declines the query to the engine strategy before anything compiles, so the class gets the answer this table rules for it, at boot or from the seam after it. The price: for those objects and hosts the shapes only native SQL serves are refused |
| The analytics engine strategy's merge and the dry-run SQL echo | not applicable | Unless its merge admits the brand (`packages/services/service-analytics/src/read-scope-sql.ts#assertReadScopeComparandsRunnable`), every query it serves on such an object is refused | **It admits the brand** and hands the scope to the engine, as it does `ReadableIds`. The echo prints the subquery the statement runs |
| The explainer's record pass (`packages/plugins/plugin-security/src/explain-engine.ts#matchUnderDeclaredColumns`). Today it matches the list in process and publishes it as the sharing layer's `rowFilter` (`packages/spec/src/security/explain.zod.ts#ExplainRecordAttributionSchema`) | It materialises the caller's whole grant list for each explanation, and the published filter grows with it | The record pass matches the sharing read filter for every record-grained explanation, whatever the verb. So each one on such an object fails, on every driver, and with it the attachment and comment gates that ask the explainer for a parent record's by-id judgement | **Neither: it resolves the leaf at the record.** One indexed read under the fixed predicate, keyed by the record ids it judges, the read `checkEdit` makes for one |

**What the recommended column costs, stated plainly.** It is the column the maintainer ruled, so these are the costs
the ruling accepts.

- **On the four storage rows, share grants stop working at the switch.** Grants that count today, up to the cap, stop
  counting, and new ones are refused. It fails closed, and it must not be silent. The switch card owes a report at
  boot of the objects that hold such rows, the refusal at both doors, the explainer's sentence and a changelog entry:
  ADR-0111 D10's "tighten directly, fail closed, with a visible trail". This reading has no census of deployments
  that hold such grants; that report is the instrument.
- **From the switch on, a host in the host class does not start until it removes the registration.** Its row is
  recommended as R1 on purpose, and it is an outage by choice. The condition is a registration the host can remove,
  where a storage row leaves the host no remedy. The boot names it before any request is served, and no card before
  the switch refuses a boot. R2 there would switch record sharing off on every object while the host kept serving.
  No package in this repository names the table on its own, and O8's census, recorded when the switch card is cut,
  says whether a host is in the class, by a registration of its own or by opting the table into record-view
  auditing.
- **For a host that opted the table into record-view auditing, removing the registration gives up that auditing of
  share rows.** The registration is the opt-in itself. That hook returns at once on a system read, and the grant read
  is one: the host pays this price although the hook records nothing on that read today. D4 keeps the registration
  in the class all the same, because the engine reads registrations and not handlers. The other answer exempts a
  registration that declares it skips system reads. Such a host then starts and keeps its auditing, and the price is
  one more contract: a declaration on hook registration, which the engine enforces by not dispatching that hook on a
  system read, and which the seam and the boot check read. Ruled with the host row: no exemption, and so no such
  declaration; such a host pays this price.
- **On a host with a registration that names no object and changes a system read of `sys_record_share`, D-0's same
  rows rest on the telling alone.** Under the recommended line nothing at run time refuses, reports or logs such a
  registration: the seam and the boot check read a registration by the object it names, and this one names none. A
  host that does not act on what plan steps 1 and 6 tell it can get an answer that differs from today's. The other
  line refuses at boot every host with a registration that names no object (the host row). Ruled with the host row:
  the recommended line, so this price is accepted.
- **It consults a driver declaration**, so ADR-0139 D3's "⛔ No `DriverCapabilities` bit returns" is revisited for
  this leaf as ADR-0147 D-d revisits it for its own, and ADR-0111 D7 gains an arm.
- **A later compile lifts R2 for that evaluator** with no amendment here: a `$lookup` form on MongoDB (O9), or a
  remote that can reach the grants.
- **The explainer's published `rowFilter` changes content.** Today it lists every granted id, up to the cap. Resolved
  at the record, the share arm is the judged record's id when a grant admits it and is left out otherwise, the two
  shapes today's filter has for a caller with one grant and with none. ⛔ It never publishes the leaf, which would
  cross the wire unbranded. The card that lands it declares that under its own Clause-②.

**Why not R1 alone.** The leaf is on every sharing-scoped operation, so R1 takes ownership scoping down together with
sharing on those evaluators. It is the simplest reading of the rule and needs no declaration, and that outage is its
price. Writing the leaf only for a caller who holds a grant would confine the outage to grantees, at the price of the
per-operation read this record removes, and a grantee would still lose every read of the object. Under the
recommendation R1 stays as the backstop: a leaf that reaches an evaluator that cannot run it is refused, never
dropped. The host row is the one row recommended as R1 itself, and its cost above says why.

**Why not L.** It is the slower path built only for parity. It keeps a second evaluation path in the engine (the
declaration, the substitution, its descent into composed scopes, a completion read per operation) for backends the
principle says not to be compatible with for compatibility's sake, and its bound is a cap again. Its merit is real and
is stated: L is the one answer under which nothing that works today stops working.

**Recommendation.** No list anywhere. The storage rows take **R2** with R1 behind it, the host row takes **R1** at
boot from the switch on, the analytics compilers compile or admit, and the explainer resolves at the record. The
maintainer may rule row by row.

**Ruled: the recommended column, row by row** (2026-11-17, ruling record
[`6942854600`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6942854600),
「Mongo 等库上共享授权停用并响亮拒收，不留 id 列表」). No capped id list is kept anywhere: L is not taken, and an
evaluator that cannot run the leaf refuses it.

- `driver-mongodb`, `driver-odata`, a driver this repository does not ship, and an object bound to another datasource
  than `sys_record_share`: **R2, with R1 behind it.**
- The host class (a registration made for `sys_record_share` by name, middleware or find hook): **R1 at boot** from the
  switch on, with the seam's refusal behind it, the class kept whole. There is **no** exemption for a registration
  that declares it skips system reads. A registration that names no object stays outside the class, and the host is
  told (D4's boundary).
- The analytics native-SQL compiler **compiles the leaf**, declining to the engine strategy where either of D4's two
  classes applies; the engine strategy's merge **admits the brand**, and the dry-run echo prints the subquery.
- The explainer's record pass **resolves the leaf at the record.**

`driver-memory` is not in this census; its row stands as [D5](#d5--the-evaluator-census) states it.

### Q3 — The leaf on a predicate update

**Today.** `buildWriteFilter` feeds the `where` of a predicate `update` with the same capped list, narrowed to the
write levels. ADR-0139 D1 admits a leaf on `find`, `findOne`, `count` and `aggregate` only, and the engine enforces it:
`packages/objectql/src/filter-comparand-shape.ts#collectComposableReadableIds` refuses a leaf in a write's predicate at
the executor's entry. `delete` has no share arm, and a by-id write reads one record, so the question is one verb on
one door.

**Option A — admit the write form on `update`. Recommended.** The engine's verb rule admits this brand's write form
in the `where` of a predicate `update`, and nothing else. ⛔ Not `ReadableIds`, not ADR-0147's leaf, and not `delete`,
where no producer writes a leaf and one that appears is refused as today. `driver-sql` compiles an update's `where`
with the compiler it reads with (`packages/drivers/driver-sql/src/sql-driver.ts#updateMany`), so the write is one
statement whose predicate holds the subquery, and the engine's prior-row read (`packages/objectql/src/engine-update.ts`)
carries the same predicate. ADR-0139 D1 states its read-verbs rule without a reason. This record reads it from what
`ReadableIds` denotes, the ids a caller may read: a read scope, which a write's predicate has no use for. This leaf's
write form denotes a write scope: the records shared with the caller at a write level. The cost is one more governed
sentence revisited: ADR-0139 D1's read-verbs sentence, for this leaf alone.

**Option B — keep the leaf read-only, and a list on the write side.** It has three forms. The first meets a seat
constraint, and the other two each meet a ruling already made:

- today's capped read, unchanged: the predicate-update half of #33787 stays, against the seat's constraint that
  "`buildWriteFilter` takes the same shape" (`6893239331` item 1);
- a complete list: the unbounded `$in` that ruling `6097072172` did not take, with the dialect's bind ceiling as the
  new cliff;
- a bounded list that refuses loudly past its bound: the cap kept and made loud, the interim shape 「只做根治」 ruled
  out, made permanent on the write side.

**Option C — derive the write scope from the candidate rows.** plugin-security already narrows an addressed predicate
write to the rows the read door returns, at most 10,000, so the write scope could read only the grants on those ids.
It is exact, and it is not recommended: it ties plugin-sharing's scope to another plugin's middleware order, a
composition without that plugin has no candidate list, and it binds up to 10,000 ids in a second read.

**Recommendation: A.** The code leaves a fork, and the seat's constraint and the standing rulings close all of it but
one branch: every form of B contradicts one of them. What remains is that A changes a governed sentence of ADR-0139,
and that is the maintainer's to change. The 10,000-row bound on an addressed predicate write stays where it is: this
leaf adds no bound and removes none.

**Ruled A** (2026-11-17, ruling record
[`6942854600`](https://github.com/objectstack-ai/objectstack/issues/33787#issuecomment-6942854600),
「只在 update 上放行这个叶子」): the engine's verb rule admits this brand's write form in the `where` of a predicate
`update`, and nowhere else. ADR-0139 D1's read-verbs sentence is revisited for this leaf alone; `ReadableIds`,
ADR-0147's leaf and `delete` keep it as written. B and C were not taken.

## Consequences

- **Positive.** Every grant counts on the SQL family, at any count. The cap and its silent cut are gone, not raised.
  A sharing-scoped operation issues no grant read of its own, its statement's parameters no longer grow with the
  grants, and a `controlled_by_parent` read no longer binds the list again inside the parent's subquery. The arm is
  part of one statement, so `find`, `count` and `aggregate` agree by construction. Each of these holds for a
  predicate update too, which carries the leaf's write form (③ ruled A).
- **Cost, named.** Spec gains one more branded comparand. The engine's door and seam and three evaluators gain its
  handling. Every sharing-scoped read carries an index-backed subquery, for a caller with no grant too, where today
  it carried one extra read and no arm. D6 pins that statement's plan and timing.
- **Failure surface.** Unchanged in direction. Today a failing grant read fails the operation before its statement;
  after the switch the same failure is the statement's. One refusal is new: the seam's recipient rule (D4). It
  answers a composition fault, and for this record's leaf, whose recipient is the reading context's user or its
  delegator, no flow read in this repository meets it. The flows that carry ADR-0147's anchor are read on the card
  that adds that leaf to the seam (plan step 2).
- **Freshness.** The arm is read at statement time (D2). With ③ ruled A, a predicate update's prior-row read and its
  write are two statements, and each evaluates the share arm for itself, as each already evaluates the owner match
  for itself. Today's list is read once, before both.
- **A public contract's answer changes kind.** `buildReadFilter` is a member of
  `packages/spec/src/contracts/sharing-service.ts#ISharingService`. Its answer now carries an engine-internal leaf, so
  it is handed to the engine in process, ⛔ never serialised and never matched by a generic matcher. The recipient
  rule also gives the security service's read filter a precondition. Its documented use hands the scope to an engine
  read (`packages/spec/src/contracts/security-service.ts#getReadFilter`), and that read must run under the context
  the scope was asked for, under one acting on behalf of that context's user, or under a system context. The spec
  card says both in the contracts' prose. Readers outside this repository were not read from this tree (O8).
- **The evaluators under ②** change as the maintainer ruled, on the recommended column. On `driver-mongodb`,
  `driver-odata`, a driver this repository does not ship and an object on another datasource, share grants stop
  counting at the switch and new ones are refused (R2), with a boot report and a changelog entry; owner, queue and
  approval access is unchanged. A host that registers a middleware or a find hook for `sys_record_share` by name does
  not boot from the switch on until it removes the registration (R1 at boot). The analytics compilers compile or
  admit the leaf, and the explainer resolves it at the record. The costs are stated under
  [Q2](#q2--an-evaluator-that-cannot-run-the-leaf).
- **Three governed sentences elsewhere move** (Revisits): ADR-0139 D1's read-verbs sentence for this leaf (③ A),
  ADR-0139 D3's "⛔ No `DriverCapabilities` bit returns" for this leaf's declaration (② R2), and ADR-0111 D7's list of
  inert grants, which gains R2's arm.
- **Each execution card declares its own Clause-②.**

## Alternatives considered

- **Generalise `ReadableIds`** with a projected column and a fixed system scope: rejected, as ADR-0147's alternatives
  rejected it. One brand carries one meaning, and every composer and driver would otherwise branch on a mode.
- **A subquery operator or a CEL function in the authorable vocabulary**: rejected. Authorable means
  request-spellable, and "the rows shared with user U" is a visibility primitive no request may spell.
- **`EXISTS`, a correlated subquery or a join**: rejected (D1). A join multiplies a record by its grant rows and
  changes the shape of every statement.
- **Read every grant and bind the full list** (the report's option B): not taken. It is the unbounded `$in` of ruling
  `6097072172`, its cliff is the dialect's bind ceiling, and it is the slower shape.
- **Keep the cap and refuse loudly past it** (the report's option C): ruled out with every interim by 「只做根治」.
- **A completion read up to a bind-safe bound, with an error-level log past it** (the independent review's interim,
  which the routing comment notes is also the fallback a leaf would need): ruled out as an interim by the same
  ruling. As a fallback it is answer L of ②.
- **Write the leaf only for a caller who holds a grant** (an existence probe per operation): rejected. It keeps the
  per-operation read the semi-join removes, and the filter's shape would again depend on the data.
- **The nested-relation lowering**: rejected. It materialises, it caps at 1,000, and `record_id` is not a relation.
- **The list as one array parameter, a temporary table or `json_each`**: rejected. Each still reads the grants into
  the application on every operation and is dialect-specific. The semi-join is the fastest shape.
- **A materialised "shared with" column on the record**: rejected, as ADR-0139's alternatives rejected a materialised
  accessible-ids column: it is stale the moment access changes. Every grant would also rewrite a business row.
- **The approval ids or the queue arm inside the subquery**: rejected (D3). Neither is a share row.
- **Group, position or unit recipients evaluated in the subquery**: out of scope. Only `user` rows are enforced
  (ADR-0111 D7), and rule materialisation already expands the others into per-user rows.
- **A tenant scope on the subquery**: that is ①'s option B, not taken (Q1 ruled A).

## Open items (not blocking acceptance; each becomes a reading on its card)

- **O1** — Names. `SharedRecordIds`, and the driver declaration's name (② as ruled consults one). The seat's
  call, fixed on the spec card, and shared with ADR-0147's O1 where the declaration is shared.
- **O2** — Key comparison. The subquery compares two columns where today a column meets bound strings. On the tables
  the platform manages both are strings. The driver card pins the comparison, type and collation, on every dialect
  `driver-sql` ships, and answers an outer key of another type with the same rows (D-0).
- **O3** — The index. `(object_name, recipient_type, recipient_id)` serves the predicate and does not carry
  `record_id`. Whether it should is measured on the driver card, with the R9 bench as the instrument.
- **O4** — The approval arm stays a list. Its size is the approvals service's, and its ceiling is not measured here.
- **O5** — `packages/plugins/plugin-sharing/src/sharing-service.ts#listShares` reads one record's grant rows at
  `limit: 500` with no notice. It serves the management listing and the explainer's share attribution, and no gate's
  verdict rests on it alone. It was noted on #33787 and is not filed, and it is not this record's.
- **O6** — ADR-0147's floor and the SQL-first rule point different ways. This record does not revisit that one. ② is
  ruled a refusal (R2 with R1 behind it), so the two leaves differ on evaluators that cannot compile, and D4's table
  already builds for it.
- **O7** — Pointer notes owed on acceptance, each dated and append-only: ADR-0139 D1 (one more leaf, and the
  read-verbs sentence: ③ ruled A); ADR-0139 O4 (answered); ADR-0139 D3 (② ruled R2, which consults a driver
  declaration); ADR-0111 D7 (② ruled R2); and a cross-reference from ADR-0147 D-a for the shared
  seam and what its recipient rule checks on that record's anchor (D4). They land with the governed edit that records
  the maintainer's rulings in this record's Status line. The first acceptance criterion already requires that edit,
  and the same rulings decide which notes are owed. When this record was first written (2026-11-15), its diff added
  only this record and its index row and carried none of the notes. **Landed** (2026-11-17): all five, dated and
  append-only, in the later edit that records the rulings in the Status line.
- **O8** — Readers of `buildReadFilter` and of the security service's read filter outside this repository (the cloud
  repository's packages) were not read from this tree, and neither was any host that registers an object-scoped
  middleware or a find hook for `sys_record_share` by name (D4), an opt-in of that table into record-view auditing
  among them, nor any registration that names no object and changes a system read of that table (D4's boundary).
  The census reads all three, and for each outside reader the context it runs its read under (Consequences).
  The seat that cuts the switch card produces the census, as a condition of cutting that card, and records it in
  the card's body: each tree it read, named by repository and commit, and what it found there. Under the host row's
  ruled answer (R1 at boot) that card carries the boot check, so it is the first card that can refuse a boot, and the
  census precedes it.
- **O9** — `driver-mongodb`: a `$lookup` form is unprototyped (shared with ADR-0139 O3 and ADR-0147 O2).

## Acceptance criteria

- The maintainer approves this record (`GOVERNED_APPROVERS`, Tier H) and rules ①, ② and ③. The rulings are recorded
  in this record, in its Status line and in the three question sections, each citing its ruling record, before any
  execution card is cut.
- O7's pointer notes land with that edit: the governed edit that records the rulings in this record's Status line.
- O8's census is produced by the seat that cuts the switch card and recorded in that card's body. The card is not
  cut without it.
- The switch meets [D6](#d6--what-the-switch-must-show).
- At every step D-0 holds on every evaluator that evaluates the leaf, and every other evaluator answers as ② ruled.

## Execution plan (after acceptance)

The seats cut the cards after acceptance, in this order. Each card declares its own Clause-② and runs its own gates.
The card sizes the whole program L, about 2.5–4k lines over 5–7 PRs, and ②'s rows, as ruled, add the cards step 5
names.

1. **Spec: the leaf.** The brand, its factory and guard beside `ReadableIds`; the comparand door's option; the fixed
   inner read's description; the conformance case-set; the `ISharingService` and `ISecurityService` prose. The
   `ISharingService` prose tells a host that a narrowing of reads of `sys_record_share` registered for that table by
   name is never read around and gets the second class's answer as ② is ruled (R1 at boot, with the seam's refusal
   behind it), and that a narrowing which names no object is not run on the share arm from the switch on (D4's
   boundary). The shared pieces take the two-leaf shape
   (D4).
2. **Engine: the seam.** Door admission, pass-through, the position rule, the verb rule (③ ruled A: the write form
   admitted in the `where` of a predicate `update`, nowhere else) and the recipient rule, the two recognised classes
   (② as ruled: R2 with R1 behind it for an object on another datasource, R1 for the host class), the descent into
   composed scopes, the refusal, and the consult of the driver declaration that R2 reads (② as ruled).
   The recipient rule is pinned on its four cases: the context's user, its delegator, a system context, and any
   other recipient, which is refused. The cases of ADR-0147's anchor are pinned on the card that adds that leaf to
   the seam: the reading context's own anchor; ADR-0147 D-c's context, the
   delegator's rebuilt one, reading under the anchor it carries; a system context; and an anchor that differs in its
   caller or in its organization, or a context that carries none, each refused.
3. **`driver-sql` and the Turso remote transport: the compile.** The subquery with no tenant scope (① ruled A), the
   update path (③ ruled A), the pins per dialect, O2, O3, and D6's reading for a caller with no grant. With ③ ruled
   A this card pins the rows each of a predicate update's two statements answers, the prior-row read and the
   write, each evaluating the share arm for itself (Consequences, Freshness).
4. **`driver-memory`: the in-process evaluation**, on reads and on the update path (③ ruled A).
5. **The rest of the census, as ② is ruled**: the storage rows' refusal for this brand (R1, behind R2), the analytics
   compilers (the native compiler compiles the leaf; the engine strategy's merge admits the brand), the explainer's
   record pass (resolved at the record). The native compiler's card carries the recognition of D4's two classes and
   the decline to the engine strategy. ⛔ No card up to here refuses a boot.
6. **plugin-sharing: the switch.** The seat that cuts this card first produces O8's census and records it in the
   card's body; without the census the card is not cut. `buildReadFilter` and `buildWriteFilter` write the leaf, and
   the approval ids become a disjunct of their own. Each tightening lands here, at the moment it takes effect: R2's
   inert arm and its report (② ruled R2 on the storage rows), when those grants stop counting, and the host row's
   boot check (② ruled R1 at boot), when a producer first writes the leaf. Its changeset tells a host what plan step
   1's prose tells it: a narrowing of reads of `sys_record_share` registered for that table by name is never read
   around and gets the second class's answer as ② is ruled (R1 at boot), and one which names no object is not run on
   the share arm (D4's boundary).
   The middleware also mirrors its scope under the AST's `filter` key, which the executor seam does not walk and no
   driver in this repository reads; the card stops mirroring the leaf there or pins that the key stays unread. The
   card carries D6's pins and the narrow figure, and #33787 ends with it. ⛔ It lands last: landed earlier, it hands
   the leaf to an evaluator that has no answer for it yet.
