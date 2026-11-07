# ADR-0148: The recycle bin is a separate store — one entry per delete operation, restore under the original ids, retention in days through a host hook

**Status**: Accepted — 2026-11-05, recording the maintainer's ruling of 2026-11-04 on [#3146](https://github.com/objectstack-ai/objectstack/issues/3146) (ruling record [`6629858351`](https://github.com/objectstack-ai/objectstack/issues/3146#issuecomment-6629858351), verbatim: 「同意，企业版功能在 cloud 中立卡后续开发」). **This record declares; it implements nothing.** Nothing below ships on `main` today: every delete is a physical delete, and each mechanism here is cut as a child of #3146 that triage filed ([`6648418282`](https://github.com/objectstack-ai/objectstack/issues/3146#issuecomment-6648418282)) — [#30235](https://github.com/objectstack-ai/objectstack/issues/30235) (spec), [#30237](https://github.com/objectstack-ai/objectstack/issues/30237) (engine), [#30239](https://github.com/objectstack-ai/objectstack/issues/30239) (Console) — each landing after this record and citing it. `docs/adr/` is Tier H (Prime Directive #14): the record lands by the maintainer's hand (merge or enqueue), and that act is its acceptance.
- **Date**: 2026-11-05
- **Card**: [#30234](https://github.com/objectstack-ai/objectstack/issues/30234) (#3146 slice 1), the first of the
  four children. The card restates the ruling; where the two differ in words, the ruling binds.
- **Decided by**: the maintainer, 2026-11-04, in the cloud coordinator session, verbatim and untranslated —
  「记录删除回收站的功能还没有开发」, 「其他主流类似系统是怎么处理的」, 「保留期按『Free 7 天 / 团队版及以上 30
  天』开源项目怎么办呢？这个功能可以放在企业版吗？建议放在企业版吗？」, and on the proposal the coordinator put back,
  「同意，企业版功能在 cloud 中立卡后续开发」. The proposal's text is the ruling record; [Decision](#decision) restates
  each of its items in the ruling's own terms. Where the record fixes something the ruling offered as an example or
  left open, it says so at the point it does it and lists it once in
  [D7](#d7--what-this-record-fixes-that-the-ruling-left-open); those are the record's choices, not the ruling's.
- **Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — the gate that removed
  the old keys and the gate every new key below passes, with its reader in the same change),
  [ADR-0057-system-data-lifecycle-and-retention](./0057-system-data-lifecycle-and-retention.md) (the one platform
  sweeper the bin's purge runs on), [ADR-0055](./0055-master-detail-controlled-by-parent.md) (master-detail — the
  cascade a delete removes and a restore brings back together),
  [ADR-0132](./0132-multi-organization-runtime-is-open-core.md) D2 (mechanism open, entitlement commercial),
  [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the envelope every restore refusal answers in),
  [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (the retired keys' tombstones stand, and their kits age out
  on its schedule — [D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired) says which kit this major
  still carries; the new keys arrive as a protocol addition), [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) (why the
  shape frees a unique value at delete, and why a restore can find it taken),
  [ADR-0100](./0100-credential-field-channels.md) (the `secret` channel the snapshot keeps out),
  [ADR-0041](./0041-flow-trigger-family.md) (record triggers — why a restore is its own event, never a create).
- **Amends**: [ADR-0049](./0049-no-unenforced-security-properties.md) — its `**Status**:` line gains one dated note
  pointing here; its decision text is unchanged. The note says the keys that gate removed stay removed
  ([D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired)).
- **Leaves unchanged**: every read path (query, aggregate, REST, the analytics engine's SQL, rollups, lookup pickers,
  search, AI tools, MCP and export); the physical delete the engine performs today and its cascade order; the
  tombstones of `enable.trash`, `softDelete`, `allowRestore` and `allowPurge`, and the one ADR-0087 kit `main` still
  carries for them (`allowRestore` / `allowPurge`, carried at 18, gone at 19); the `sys_file` tombstone and its reap; the release of
  `sys_secret` handles on a committed delete.
- **Consumers**: `@objectstack/spec` (what #30235's body lists — the recycle-bin object, the retention hook's contract,
  the refusal codes — and what this record adds to that card, the `restored` event's name and the two grant keys, both
  spec surfaces; see [D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired)), `@objectstack/objectql`
  (snapshot, restore, purge, empty, the TTL reap on the LifecycleService, the operation vocabulary pin — #30237),
  `@objectstack/plugin-security` (the restore and bin-admin grants enforced, the fail-closed destructive backstop
  mapped — #30237), `@objectstack/rest` (the doors the Console calls — #30237), the Console under `ui/` (the admin page
  and the toast — #30239), and `objectstack-ai/cloud` as the one caller of the retention hook (its own card, per the
  ruling).

---

## Provenance

- The ruling was taken on this repository's card #3146 and is recorded there (ruling record 6629858351,
  2026-11-04T11:50Z). It governs open code, so the record lives here (Prime Directive #13).
- **The commercial half is cloud's.** Per-plan retention (Free 7 days, Team and above 30 days), per-object retention,
  legal hold, longer retention, delete and restore audit reports, bulk restore and erasure proof are a cloud card by the
  same ruling (「企业版功能在 cloud 中立卡后续开发」). They are not restated here, and this record does not number that
  card. Where this record and the cloud record disagree about what the commercial boundary is, the cloud record
  decides; what this record decides, and cloud does not, is the open mechanism and the hook the commercial layer calls.
- **Why now.** cloud#3565 rules that the AI chat may write records after a confirm card, and its step 3 — deleting
  from chat — waits on deletes being recoverable. The Console's delete is permanent today. (A cloud record is not
  readable from this repository's sessions; the ruling's summary of cloud#3565 is what this record reads.)
- The ruling says the framework knows 「days, never plans (ADR-0012)」. This repository's ADR-0012 is the messaging
  platform (superseded by ADR-0030) and says nothing about plans; the citation resolves to **cloud ADR-0012**, which
  the open seam's own docblock names. See [Where "days, never plans" is written down](#where-days-never-plans-is-written-down).

---

## TL;DR

Every delete on `main` is a physical delete at the driver, and nothing the spec ever declared about soft delete had a
reader: `enable.trash` and `softDelete` were removed in the 16.x line and `allowRestore` / `allowPurge` with #12497,
all under ADR-0049, because nothing read them. The maintainer ruled the shape the recycle bin takes when it is built:

1. **A separate store, not a column.** On delete the engine snapshots the rows the delete removes — the cascade set —
   into one system object, `sys_recycle_bin`, as **one entry per delete operation**, and then deletes physically as
   today. Restore writes the rows back **under their original ids**. Purge removes the entry. No read path changes.
2. **Open source owns the mechanism**: snapshot, restore, empty, permanent delete, TTL purge and permissions.
   **Retention is a number of days, default 30**, read from `OS_RECYCLE_BIN_RETENTION_DAYS`; a host may inject it
   through a resolver hook on the pattern of `resolveFeatures`. The framework knows days, never plans.
3. **Cloud sets per-plan retention through that hook**, and the enterprise value layer is cloud's own card.

Nothing here is shipped. For every new surface the record names the reader that will enforce it and the card that
lands it, so the ADR-0049 gate the old keys failed is the gate the new ones pass.

---

## Context — what `main` ships today, and why the old keys went

**The delete path.** `ObjectQL.delete` collects the rows a delete removes before it removes any
(`packages/objectql/src/engine-delete-cascade.ts#collectCascadeDeleteSet`), refuses a `restrict` relation inside its own
cascade with `409 DELETE_RESTRICTED` (`packages/objectql/src/engine-delete-cascade.ts#refuseRestrictsInsideOwnCascade`),
clears the `set_null` lookups that pointed at the removed rows (a reference field's `deleteBehavior` in
`packages/spec/src/data/field.zod.ts`: `set_null` / `cascade` / `restrict`), and removes the rows at the driver. A
committed delete then releases the `sys_secret` handles the removed rows held
(`packages/objectql/src/engine-secret-internal-fields.ts#releaseSecretHandles`, #27581). Nothing is kept: the rows
are gone, their unique values are free, and their ids are not reused.

**The one platform sweeper.** `packages/objectql/src/lifecycle/lifecycle-service.ts#LifecycleService` is the single
enforcer of ADR-0057 `lifecycle` declarations: it reaps rows past `retention.maxAge` or past
`ttl.field + ttl.expireAfter`, in bounded batches, under a system context, with a per-object reap guard that can veto
or finish a row's removal. ADR-0057 §3.3 forbids a second sweeper.

**The precedent the ruling names.** `sys_file` already dies in two steps.
`packages/services/service-storage/src/attachment-lifecycle.ts` tombstones an orphaned attachments-scope file
(`status='deleted'` + `deleted_at=now`) when its last join row goes away, un-tombstones it on re-attach inside the
grace window, and registers a reap guard that re-verifies zero references at sweep time and reclaims the bytes; the
`lifecycle` declaration on `packages/services/service-storage/src/objects/system-file.object.ts` has the
LifecycleService reap the tombstone 30 days after `deleted_at`. Detection and scheduling stay inside the one sweep.

**The keys ADR-0049 removed, and why.** The June 2026 property liveness audits (#1878, under `docs/audits/`; the
ObjectSchema sheet as #3146 quotes it) found `enable.trash` (default `true`, "enable soft-delete with restore
capability") and `softDelete` (`enabled` / `field: 'deleted_at'` / `cascadeDelete`) with **zero behaviour-changing
readers**, duplicated and both dead. A default-true flag promising a recycle bin was a false
affordance: authors wrote `trash: false` believing they were opting out of a soft delete that never ran. Both were
removed in the 16.x line (#2377) and tombstoned — `enable.trash` in
`packages/spec/src/data/object.zod.ts#CAPABILITIES_RETIRED_KEY_GUIDANCE`, `softDelete` in the same file's top-level
unknown-key guidance, whose text is the standing fact: 「there is no soft-delete/recycle-bin runtime … Deletes are hard
deletes」. What `main` carries for them is set by ADR-0087's kit rule (its addendum of 2026-10-26: a retired key's
tombstone and conversion — the kit — live one major past the one they retired in): the `enable.trash` kit's conversion,
`object-enable-trash-mru-removed` (retired at 16.x), was removed when 18 was cut, so no entry file remains and the
tombstone that stays tells an author to apply the edit by hand or run the tool on a release that still carries it; the
`allowRestore` / `allowPurge` kit (`packages/spec/src/conversions/entries/18/permission-allow-restore-purge-removed.ts`,
retired after 17.2.0) is carried at 18 and ages out at 19. Neither conversion replays at load: both are
`retiredFromLoadPath`, listed as such in `packages/spec/src/conversions/retired-after.census.json`, and the permission
one runs under `os migrate meta` only. `softDelete` never had a conversion entry, only the tombstone. The
permission lifecycle bits `allowRestore` / `allowPurge` claimed to gate `restore` / `purge` operations
that never entered the engine's dispatch vocabulary (pinned by
`packages/objectql/src/engine-middleware-operation-vocabulary.test.ts`); they were removed with #12497 (the maintainer
accepting #1883's recommendation B, 2026-08-26), conversion
`packages/spec/src/conversions/entries/18/permission-allow-restore-purge-removed.ts`, and the evaluator's
`packages/plugins/plugin-security/src/permission-evaluator.ts#DESTRUCTIVE_OPERATIONS` backstop denies a dispatched
`restore` or `purge` fail-closed. The tombstone in `packages/spec/src/security/permission.zod.ts` says the bits
「return with the M2 lifecycle initiative alongside the operation it gates」. [D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired)
says how: as **new** keys, with their readers, never as the tombstoned spellings.

**Not this surface.** ADR-0045's "trash-can discard" is the teardown of an unpublished build (a package renamed into a
trash namespace and collected after seven days). It is a different object at a different layer and is untouched here.

**What the mainstream does**, read for the ruling and adopted rather than reinvented: Dataverse keeps deleted rows in a
"bin" data source and restores them with the same record id; ServiceNow records deletes in `sys_audit_delete`;
Salesforce marks rows `IsDeleted` and filters every query — the other shape, and the one not chosen; HubSpot keeps a
permanent delete for privacy erasure and does not restore workflow enrollments; ServiceNow's script restore is the
pitfall that loses `created_by` / `created_at`.

---

## Decision

### D1 — Shape: a separate recycle-bin store, one entry per delete operation, the delete stays physical

On delete, the engine **snapshots the rows the delete removes** — the cascade set
`packages/objectql/src/engine-delete-cascade.ts#collectCascadeDeleteSet` already computes, master and details in cascade
order — into **one system object, `sys_recycle_bin`**, as **one entry per delete operation**, and then **deletes
physically as today**. The ruling offered `sys_recycle_bin` as an example (「for example `sys_recycle_bin`」); this record
fixes it as the name. An entry records what was removed (the objects and ids, the rows as they stood), who deleted and
when, and **the purge deadline, stamped on the entry at delete time** from the days the retention resolver answers
([D3](#d3--retention-in-days-default-30-through-a-host-resolver-hook-open-source-owns-the-mechanism) says why stamping,
and that it is the record's choice). Restore writes the rows back under their original ids
([D2](#d2--restore-under-the-original-ids-with-reasons-for-refusal)); purge removes the entry; empty purges every entry
and is an admin's verb ([D2](#d2--restore-under-the-original-ids-with-reasons-for-refusal), Permissions).

**Chosen over an `IsDeleted` / `deleted_at` column, for the reasons the ruling gives:**

- **Every read path stays untouched** — query, aggregate, REST, the analytics engine's SQL, rollups, lookup pickers,
  search, AI tools, MCP and export. A column would have to be filtered on every one of them, and the first path that
  forgets shows deleted rows.
- **Unique keys free immediately.** A deleted row occupies no unique value, so the next insert of the same value is
  ordinary (ADR-0120 scopes stay as they are). The cost moves to restore, which may find the value taken and refuses.
- **The per-tenant schema change is one table**, not a column on every object.
- **It is the mainstream shape** for a platform that restores under the same id (Dataverse's bin data source,
  ServiceNow's `sys_audit_delete`). Salesforce's `IsDeleted` column is the other shape, and it is not chosen.

The entry is a row of a system object, so it is organization-owned like every other row (ADR-0131) and counted toward
storage — [D4](#d4--v1-scope-forward-only-later-items-and-the-privacy-rules) says it is shown separately. The record
fixes, and nothing ruled, that it is stored by the default datasource, as every `sys_*` object is. The object's name,
the one-entry-per-operation rule and the stamped deadline are decided here; the rest of the field list is #30235's to
declare.

### D2 — Restore under the original ids, with reasons for refusal

A restore **writes the snapshotted rows back under their original ids**, master and details together, and **keeps
`created_by` and `created_at`** as they were (the ServiceNow script-restore pitfall, closed by rule). It **emits its
own `restored` event, never a create**: a flow triggered on record creation (ADR-0041) does not fire for a restore,
flow enrollments are not restored (HubSpot), audit records a restore as a restore, and rollups recompute from the
rows that are back.

**A cascaded child is not restored alone** (Dataverse): the entry is the unit of restore, and a detail that went with
its master comes back with its master.

**A restore refuses with a reason and never forces a write** when:

- a **unique value has since been taken** by a live row;
- the **parent was purged** — the row's master-detail parent is no longer in the bin and no longer live;
- the **object's package was uninstalled** — the object no longer exists in the registry;
- the **parent is in the bin** — the row's master-detail parent is not live but is the record of another entry; the
  refusal names that entry, and restoring it first lets this one through (added 2026-11-07 by the maintainer's ruling
  on #30237, record [`6710220841`](https://github.com/objectstack-ai/objectstack/issues/30237#issuecomment-6710220841)).

Each refusal is a named code in the ADR-0112 envelope (#30235 names them; #30237 answers them and pins one test per
refusal), so the Console and an AI caller read the reason, not a generic failure.

**Lookups.** A reference that `set_null` cleared at delete is **re-linked on restore only if nothing has changed it
since** (Salesforce: 「only restores lookup relationships that have not been replaced」). A reference somebody has since
pointed elsewhere stays where they pointed it; the restore does not overwrite a live write.

**Permissions.** **A person restores what they deleted; an admin sees all** — lists every entry, restores any, and
empties the bin. The grants are new permission keys ([D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired)),
not the tombstoned `allowRestore` / `allowPurge`. The `restore` and `purge` verbs are already in the evaluator's
fail-closed destructive class, so until the new grants map them, a dispatched restore is denied — the ADR-0049 posture
this record keeps.

### D3 — Retention in days, default 30, through a host resolver hook; open source owns the mechanism

**Open source owns the mechanism**: snapshot, restore, empty, permanent delete, TTL purge, and the permissions above.

**Retention is a number of days.** The default is **30**, read from **`OS_RECYCLE_BIN_RETENTION_DAYS`** — the ruling
offered that name as an example (「for example `OS_RECYCLE_BIN_RETENTION_DAYS`」); this record fixes it, under the
`OS_{DOMAIN}_{NAME}` rule of Prime Directive #9. **A host may inject retention through a resolver hook, the same pattern
as `resolveFeatures`**, and the framework **knows days, never plans**: no plan name, no catalog, no entitlement appears
in this repository. That much is the ruling. The hook's shape is this record's choice, made so that #30235 has a
contract to declare: it receives the same opaque token `resolveFeatures` receives (the cloud distribution passes its
plan string), it answers a number of days or nothing, nothing keeps the default, and a day count is a positive whole
number — zero and anything that is not such a number are refused as a configuration defect and never read as "now" or
"forever". #30235 spells the signature and the refusal.

**When the days become a deadline — stamped at delete time.** The ruling decided days-through-a-hook and no more; this
record decides that the resolver is asked once, at delete, and its answer is written on the entry as the purge
deadline. Reasons: the toast and the admin page show the person a date, and a later change of the host's answer (a plan
change, a new default) must not shorten a window a person was already shown. The alternative the record rejects is
the one the LifecycleService already runs: resolving an object's window at sweep time from the `lifecycle` settings
namespace, globally and per tenant (ADR-0057 §3.2, `packages/objectql/src/lifecycle/lifecycle-service.ts`), as the
`sys_file` reap does with `deleted_at` plus a static `ttl.expireAfter` — a window resolved at sweep can move after the
person was shown it, and a host's days are not a per-object setting. With the deadline stamped, the sweep reads one
stored column and asks no resolver; how the reap is declared on that column (a `ttl` on the deadline with no added
window, or a reap guard) is #30237's. The consequence is accepted: a longer window applies to deletes made after the
change, not before. No entry is purged before its stamped deadline.

**The TTL purge runs on the existing LifecycleService** (ADR-0057 §3.3: one sweeper, never a bespoke one), following
the `sys_file` tombstone pattern: an entry is purged once its stamped deadline has passed, by the platform sweep, under
the system context, in bounded batches, with a reap guard where the engine needs one. **Permanent delete stays
available for privacy erasure and never enters the bin** (HubSpot).

**Cloud sets per-plan retention through that hook — Free 7 days, Team and above 30 days** — and the enterprise value
layer (per-object retention, legal hold, longer retention, delete and restore audit reports, bulk restore, erasure
proof) is a cloud card. It is not in this record, not in open source, and it reaches the open code only as the hook's
caller.

### D4 — v1 scope, forward-only, later items, and the privacy rules

**In v1**, adopting mainstream rules rather than inventing new ones:

- business objects — not `sys_*` objects;
- a single delete and its master-detail cascade, snapshotted as one entry and restored together; a cascaded child
  cannot be restored on its own;
- an admin recycle-bin page: list, restore, empty;
- the TTL purge on the LifecycleService, as D3;
- a 「已删除 · 撤销」 toast after a delete, which restores through the engine's door;
- restore keeps `created_by` / `created_at`;
- permanent delete stays available for privacy erasure and never enters the bin.

**Forward-only.** Deletes made before the bin existed are not recoverable (Dataverse). The release notes of the engine
slice say so.

**Later** — named so they are not mistaken for v1, each filed as its own card when it is due:

- bulk delete into the bin, with a size cap;
- holding attachments and `sys_secret` rows until purge — today a committed delete releases the `sys_secret` handles
  the rows held (#27581), and v1 leaves that as it is;
- a member-facing 「我删除的」 page.

**The privacy rules**, which bind v1 and everything after it (the ruling lists them among the risks to plan for;
making them standing rules is the record's choice, [D7](#d7--what-this-record-fixes-that-the-ruling-left-open)):

- **FLS applies when listing.** A snapshot holds every field; the bin shows a caller a field only where the caller may
  read it on the live object.
- **Secret fields stay out of the snapshot, or are encrypted.** The ruling allows either; this record chooses **out**
  for v1. Under ADR-0100 a business row carries only the opaque `secret:<id>` ref and the value lives in `sys_secret`;
  the committed delete releases those refs in v1 (#27581 — holding `sys_secret` rows until purge is the later item), so
  a snapshot of the row would hold a ref that dangles, and encrypting the value into the entry would open a second
  store for a secret outside `sys_secret`. So the `secret` channel's refs are not written into the entry, and a restored
  record's secret fields come back empty, to be re-entered. The later item may revisit this choice.
- **Purge on organization or environment deletion.** An organization's or environment's entries go with it.
- **Bin storage counts toward quota and is shown separately.**

**Risks the ruling plans for**, carried into the cards: restore fidelity (references, cascades, files, approvals
pending on the record) — the mitigation is a narrow v1 that refuses the rest, with a test per refusal; delete latency —
one extra read and one extra write per delete, which hosted Turso shows — the mitigation is one snapshot write per
operation and a cap on bulk.

### D5 — The readers that will exist, and the keys that stay retired

ADR-0049 removed the old keys because nothing read them. The new surface ships **with its readers**, each named here
with the card that lands it. Every row below is new; none is a tombstoned spelling returning.

| New surface | The reader that enforces it | Card |
|---|---|---|
| `sys_recycle_bin` — one entry per delete operation; the cascade set snapshotted; who, when, and the purge deadline stamped at delete time | written by the engine's delete path, which asks the retention resolver once and stamps the deadline; read by restore, purge, empty and the TTL reap; listed by the admin page under FLS | #30235 declares (its body lists the object); #30237 writes and reads; #30239 lists |
| `OS_RECYCLE_BIN_RETENTION_DAYS` (default 30) | the retention resolver's default, when the host hook answers nothing | #30237 |
| the host retention resolver hook — answers days, never a plan | the engine's delete path, which stamps the deadline from the answer; the cloud distribution is its caller | #30235 (contract; its body lists the hook); #30237 (reader); the cloud card (caller) |
| the `restore`, `purge` and `empty` operations and the REST doors the Console calls | the engine; `packages/plugins/plugin-security/src/permission-evaluator.ts#DESTRUCTIVE_OPERATIONS` already lists `restore` and `purge`, and `packages/plugins/plugin-security/src/permission-evaluator.ts#OPERATION_TO_PERMISSION` must map them to the new grants, or the fail-closed backstop denies them; the operation vocabulary pin (an objectql test) gains the verbs | #30237 (engine, doors, mapping, the vocabulary pin) |
| the restore and bin-admin grants — new permission keys: a person restores what they deleted, an admin sees all | the permission evaluator in `@objectstack/plugin-security` | #30235 declares — this record adds the grant keys to that card, whose body does not list them, because the permission shape is a spec surface; #30237 enforces |
| the restore refusal codes — unique value taken, parent purged, package uninstalled | the engine answers them in the ADR-0112 envelope; the Console reads them in its language | #30235 names (its body lists the codes); #30237 answers; #30239 shows |
| the `restored` event | automation (a record-created trigger does not fire; enrollments are not restored), audit, rollups | #30235 names — this record adds the event's name to that card, whose body does not list it, because the event vocabulary is a spec surface; #30237 emits |
| the admin recycle-bin page and the 「已删除 · 撤销」 toast | the Console | #30239 |

**The old keys stay retired.** `enable.trash`, `softDelete`, `allowRestore` and `allowPurge` are tombstones and none of
them returns: an author who writes one is refused with the prescription the tombstone carries. What `main` carries for
them is what ADR-0087's kit rule leaves at this major: the `allowRestore` / `allowPurge` kit
(`packages/spec/src/conversions/entries/18/permission-allow-restore-purge-removed.ts`, retired after 17.2.0) is carried
at 18 and ages out at 19; the `enable.trash` kit's conversion (`object-enable-trash-mru-removed`, 16.x) was removed when
18 was cut and only its tombstone remains, so a 15.x artifact that still writes `enable.trash` is refused by the
tombstone and migrated by hand or on a release that still carries it; neither conversion replays at load (both are
`retiredFromLoadPath` in `packages/spec/src/conversions/retired-after.census.json`); `softDelete` never had a
conversion. This record changes none of that. The new surface uses new spellings on purpose, so that a key which
once meant "nothing happens" never comes to mean "a snapshot is kept". The retired `apiMethods` values `restore` and
`purge` (`packages/spec/src/data/api-derivation.ts`) are likewise unchanged. ADR-0049's Status line carries the dated
note.

**No object-level authoring key is named by this record.** v1 applies to every business object and to no `sys_*`
object by rule, not by a flag — the ruling said only "business objects, not `sys_*`", and that no key carries it is the
record's choice ([D7](#d7--what-this-record-fixes-that-the-ruling-left-open)). Per-object retention is enterprise and lives in cloud; if an open per-object key is
ever ruled, it arrives with its reader in the same change, as ADR-0049 requires.

### D6 — What this record does not decide

- **The spellings**: the entry's remaining fields (beyond the deleting principal, the delete time, the stamped
  deadline and the snapshot), the hook's signature and its refusal text, the refusal code names, the `restored`
  event's name and the two grant keys' names. #30235 fixes them, citing this record, under the rules already in force
  (snake_case machine names, the ADR-0112 ledger, ADR-0049's reader-in-the-same-change). The event name and the grant
  keys are this record's addition to #30235's scope ([D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired)).
- **The bulk cap's number**, the Console's wording, and the cloud card's shape.

### D7 — What this record fixes that the ruling left open

Each of these is the record's choice, not the ruling's, and is marked as such where it is made:

- the object's name `sys_recycle_bin` and the variable's name `OS_RECYCLE_BIN_RETENTION_DAYS` — the ruling's examples,
  fixed here ([D1](#d1--shape-a-separate-recycle-bin-store-one-entry-per-delete-operation-the-delete-stays-physical),
  [D3](#d3--retention-in-days-default-30-through-a-host-resolver-hook-open-source-owns-the-mechanism));
- the hook's input, output and validation — the `resolveFeatures` token in, days or nothing out, a positive whole number
  or a refused configuration defect ([D3](#d3--retention-in-days-default-30-through-a-host-resolver-hook-open-source-owns-the-mechanism));
- the purge deadline stamped on the entry at delete time, not resolved by the sweep
  ([D1](#d1--shape-a-separate-recycle-bin-store-one-entry-per-delete-operation-the-delete-stays-physical),
  [D3](#d3--retention-in-days-default-30-through-a-host-resolver-hook-open-source-owns-the-mechanism));
- the entry stored by the default datasource ([D1](#d1--shape-a-separate-recycle-bin-store-one-entry-per-delete-operation-the-delete-stays-physical));
- secret fields kept out of the snapshot in v1, of the two the ruling allowed
  ([D4](#d4--v1-scope-forward-only-later-items-and-the-privacy-rules));
- the `restored` event's name and the grant keys declared by #30235, whose body lists neither
  ([D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired));
- no object-level authoring key — v1 reaches every business object and no `sys_*` object by rule, not by a flag; the
  ruling said only "business objects, not `sys_*`", and #30235's body expects any object-level key the record names,
  so "none" is the record's answer ([D5](#d5--the-readers-that-will-exist-and-the-keys-that-stay-retired));
- the privacy rules as standing rules that bind v1 and everything after it — the ruling listed them among the risks
  to plan for ([D4](#d4--v1-scope-forward-only-later-items-and-the-privacy-rules)).

The ruling itself gives a person the restore of what they deleted and gives an admin everything (list, restore, empty);
this record adds no permission beyond that.

---

## Where "days, never plans" is written down

Measured at `main` for this record, because the ruling cites "ADR-0012" and the citation does not resolve in this
registry:

- **No ADR under `docs/adr/` states the principle.** This repository's ADR-0012 is the messaging platform, superseded
  by ADR-0030; neither mentions plans. A grep of every record for `resolveFeatures`, "plan-agnostic" and "plan name"
  finds nothing.
- **The seam states it, and cites cloud ADR-0012.** The docblock of
  `packages/cloud-connection/src/runtime-config-plugin.ts` heads its feature seam "open-core boundary — cloud
  ADR-0012": the open package owns the **mechanism** (serve a per-request `features` map); which feature keys exist and
  **which billing plan unlocks them** is a distribution concern that must never be enumerated in the open framework.
  Hosts inject policy through `resolveFeatures`, which receives an opaque token — the cloud distribution passes the
  plan string — and returns an open-ended map merged verbatim. The framework neither names nor knows the keys. The
  package's 9.5.0 changelog entry introduced `resolveFeatures` as "plan-agnostic" and deprecated the billing-vocabulary
  `resolvePlanFeatures`.
- **The nearest ADR here is ADR-0132 D2**, which draws the same line for the organization wall: the mechanism is open
  and carries no licence check of any kind; only the entitlement stays commercial.

So the ruling's "ADR-0012" is **cloud ADR-0012**, cited as Prime Directive #13 requires (never as a bare number, which
resolves against this registry), and this record applies the seam's rule to retention: the framework carries a number
of days and a default; the plan that maps to those days lives in the host that calls the hook.

---

## Consequences

**Positive.**

- A delete becomes recoverable without a single read path learning about deletion. The defect class ADR-0049 closed —
  a promise with no reader — cannot reopen, because every key above is listed with the code that reads it.
- The AI chat's delete step (cloud#3565) has the door it was waiting for, in the open runtime.
- The open/commercial line is the one the runtime already draws for features: open code knows days, the host knows
  plans. Nothing in this repository changes when cloud changes a plan's retention.

**Negative / cost.**

- **One extra read and one extra write per delete** (the snapshot), visible on hosted Turso. Bounded by one snapshot
  write per operation; bulk delete is a later item with its own cap.
- **Bin storage** is real storage until purge, counted and shown separately.
- **Restore is best-effort by design**: the three refusals are permanent for that entry (a taken unique value, a
  purged parent, an uninstalled package) and the person is told why rather than given a forced write. The fourth, a
  parent that is in the bin, is not: it names the parent's entry, and restoring that entry first clears it.
- **Forward-only**: nothing deleted before the engine slice lands is in the bin.
- A restore brings a record back without its secret-channel values until the later item holds them.

---

## Non-goals

- The enterprise layer (per-plan and per-object retention, legal hold, audit reports, bulk restore, erasure proof) —
  cloud's card, reached only through the hook.
- An `IsDeleted` / `deleted_at` column on business objects, or any filter on a read path.
- A bin for `sys_*` objects, or for the unpublished-build discard of ADR-0045.
- Bulk delete into the bin, holding attachments and `sys_secret` rows until purge, and the member-facing page — the
  "later" items above, each its own card when due.
- Reviving `enable.trash`, `softDelete`, `allowRestore` or `allowPurge` under their old spellings.

---

## Rollout — the cards, in order

1. **This record** (#30234, Tier H) lands by the maintainer's hand. The ADR-0049 Status note lands with it.
2. **#30235 — spec**: what its body lists — `sys_recycle_bin`, the retention hook's contract (days only), the refusal
   codes — plus what this record adds to it, the `restored` event's name and the two grant keys; each with its liveness
   row naming the reader in #30237 or #30239. A protocol addition (`Metadata-protocol: added`).
3. **#30237 — engine**: snapshot on delete with the deadline stamped from the resolver's answer, restore under the
   original ids with the refusals, purge and empty, the TTL reap on the LifecycleService, the permission mapping and
   the operation vocabulary pin, the REST doors, a test per refusal, and release notes that say the bin is
   forward-only.
4. **#30239 — Console**: the admin recycle-bin page (list, restore, empty) and the 「已删除 · 撤销」 toast, reading the
   refusals in the Console's language.
5. **The cloud card**: per-plan retention through the hook, and the enterprise layer. Not tracked here.

#3146 is the tracking parent and closes when its children land.
