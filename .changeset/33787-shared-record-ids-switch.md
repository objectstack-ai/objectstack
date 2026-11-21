---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-security': patch
---

fix(plugin-sharing)!: every share grant counts; the sharing scopes carry the share-grant leaf instead of a list capped at 5,000 grants (ADR-0155 plan step 6)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row, registry key or authored value changes. What moves is how the sharing scopes count share grants (every grant, through a subquery, where a read of at most 5,000 used to stand), that grants stop counting on objects whose storage cannot evaluate that subquery, and that a host registering a narrowing of sys_record_share reads by name no longer boots. There is nothing for a migration to rewrite and no tombstone; each host-side remedy is one line, below. -->

**What was wrong.** The read scope of a sharing-scoped object read the caller's share grants into an id list first, at most 5,000 of them, and dropped the rest without a word: a member holding 6,000 grants on one object saw 6,000 rows of 7,000 (1,000 owned plus 5,000 of the 6,000 shared), and a GET of an unread grant answered 404. The predicate-update scope had the same cap on edit-level grants.

**Now.** `buildReadFilter` and `buildWriteFilter` carry the share arm as the share-grant leaf, `{ id: { $in: SharedRecordIds.read(object, user) } }` (the update scope carries `.write(object, user, ['edit', 'full'])`), which the SQL driver compiles as a subquery over `sys_record_share` inside the same statement. Every grant counts, at any number; no grant is read into memory and nothing binds one parameter per grant. The pending-approval ids stand as a disjunct of their own. `delete` scopes to the owner match alone, as before.

**BREAKING**, in three places, each a tightening that lands here, where it takes effect:

- **Share grants stop counting on objects whose storage cannot evaluate them** (ADR-0155 R2). An object stored on another datasource than `sys_record_share`, or by a driver that does not evaluate the leaf (`supports.fixedReadLeaves` without `SharedRecordIds`: today the MongoDB, in-memory and OData drivers), keeps its owner, queue and pending-approval access unchanged, but its share rows are no longer consulted: no scope carries the share arm, the edit gate reads no grant, and a new grant or a new sharing rule on it is refused `SHARING_NOT_ENABLED` (422 at the REST doors). The boot names, once at `warn`, every such object that holds `sys_record_share` rows, with the reason. `security/explain` reports each share on such a record as evaluated and not granting, and says why.
  The fix for a host: to share such an object's records again, store it on the datasource of `sys_record_share`, on a driver that evaluates share grants (the SQL drivers do).
- **A narrowing of `sys_record_share` reads registered BY NAME refuses the boot** (ADR-0155 R1 at boot, D4). A host that registers an object-scoped middleware, or a `beforeFind` / `afterFind` hook, for `sys_record_share` (an opt-in of that table into plugin-audit's record-view auditing included) no longer starts: the boot fails at `kernel:bootstrapped`, before any request is served, with `INTERNAL_ERROR` / 500 naming the registration. No registration is exempt, one whose handler skips system reads included. A registration made after boot is refused at read by the engine, with the same envelope.
  The fix for a host: remove that registration for `sys_record_share`. A host that opted the table into record-view auditing gives up that auditing of share rows.
- **A narrowing that names NO object is not run on the share arm.** A middleware or a find hook registered for no object, or for `'*'`, ran on today's grant read, which went through the engine as a system read. The share arm now makes no engine read of `sys_record_share`, so such a registration does not run on it, and nothing refuses, reports or logs that. On a host where such a registration changes a system read of `sys_record_share`, the share arm's rows can differ from what they were. This paragraph is the telling (ADR-0155 D4's boundary; `ISharingService`'s contract says the same). The repository's own registrations of that kind were read before this change, and none changes that read.

**Preconditions this step inherits from the PostgreSQL key-type change** (ADR-0155 O2):

1. On PostgreSQL, a statement holding the leaf whose catalog read fails, or finds no such relation, answers `INTERNAL_ERROR` / 500, where an uncast statement would have run.
2. Each transaction pays one savepoint and one catalog read per table it compares a leaf against, when the table has no pooled reading.
3. A failed catalog read inside that savepoint rolls back the caller's concurrent statements on the same transaction. The sharing plugin issues no statement of its own that carries the leaf, and none of its reads runs inside a caller's transaction or concurrently with another on one: its own reads are sequential system reads.

**What it costs, quoted no wider than ADR-0155 quotes it.** For the scope statements alone (an account page, its total and the two grant reads), at 1M rows and 5,000 grants, the id-list scope against the subquery scope read PostgreSQL 21.6 → 7.0 ms and SQLite 18.3 → 12.1 ms. It is not a whole-request figure. For a caller holding no grant, whose scope was the bare owner match and is now an `$or` with the subquery, SQLite still serves the page and its total from the owner index; PostgreSQL 16 serves the page as before but plans the total as a sequential scan, which grows with the table: measured, that caller's total went from 1.46 to 7.29 ms at 100k rows and from 7.88 to 42.21 ms at 1M, the page flat at both. SQLite keeps the owner index. Follow-up #36034 measures `id = ANY(ARRAY(SELECT …))` against the subquery for that caller on PostgreSQL.
