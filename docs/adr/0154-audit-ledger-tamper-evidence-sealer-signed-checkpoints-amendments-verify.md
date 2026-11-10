# ADR-0154: The audit ledger is tamper-evident — an asynchronous sealer signs per-organization checkpoints, redaction and expiry write signed amendments, and `os audit verify` checks it

**Status**: Proposed (2026-11-10) — draft. **This record declares; it implements nothing.** The build is [#31908](https://github.com/objectstack-ai/objectstack/issues/31908), serial after this record. `docs/adr/**` is a Tier H governed surface (Prime Directive #14): the maintainer's merge adopts this record, and until then every decision below is a proposal.
- **Date**: 2026-11-10
- **Card**: [#31907](https://github.com/objectstack-ai/objectstack/issues/31907) (p2, `domain:server`), stage 1 of [objectstack-ai/cloud#4016](https://github.com/objectstack-ai/cloud/issues/4016). The card restates the ruling as seven points; where the two differ in words, the ruling binds.
- **Decided by**: the maintainer, 2026-11-09 11:30Z, on cloud#4016, option **(c)** of the decision card, whose label the card quotes verbatim: 「(c) 封存链+检查点出主机」 — build tamper evidence in two stages, exactly as cloud `docs/design/audit-tamper-evidence.md` §5 says (merged as cloud PR #4025). Stage 1, this record, is in the framework; stage 2, taking checkpoints off the host, is Enterprise's.
- **Builds on**: [ADR-0052](./0052-audit-is-not-the-activity-feed.md) (`sys_audit_log` is the immutable, append-only ledger — this record makes a change to it *detectable*, which is the half of "immutable" that access control cannot give), [ADR-0057](./0057-system-data-lifecycle-and-retention.md) (the one platform sweeper, its Archiver and the rule that a ledger is never hot-deleted unarchived — the expiry amendments ride on it), [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) D7 (the ledger is deployment-level: `tenant_id` is attribution and NULL is a deployment-level row), [ADR-0128](./0128-producer-discriminated-aad-for-cryptocontext.md) (every sealed secret below is bound to its producer's context), [ADR-0049](./0049-no-unenforced-security-properties.md) (the opt-in key below lands with its reader, or not at all).
- **Amends**: none. No recorded decision is reversed; the three redaction migrations and the Archiver keep their behaviour and gain a record of it.
- **Leaves unchanged**: the insert path of every ledger writer; what `sys_audit_log` stores and how it is read (`get` / `list`, the `sys_audit_log_org` row scope, the field redaction on read); the Archiver's safety rule; the dry-run default of the three `os migrate audit-*` commands; the maintainer-authorised rewrite exception of the stored-metadata-body family (ruling record 5950183039 on #21207), which this record makes visible and does not widen.
- **Consumers**: `@objectstack/plugin-audit` (the sealer, the two new objects, the amendment writer, the three migrations), `@objectstack/objectql` (the LifecycleService's window-aligned expiry), `@objectstack/spec` (the `lifecycle.seal` key and the two seam contracts, added by the build card, not here), `@objectstack/cli` (`os audit verify`), and in `objectstack-ai/cloud` stage 2 (cloud#4016's stage-2 card, cloud#4128) and Enterprise's `sys_ai_audit_log`.

---

## Provenance

- **The ruling** was taken on cloud#4016 and is the cloud record of the requirement: a security review asks for proof that the audit log was not changed or deleted, and today nothing can give one. Its mechanism half governs open code, so the mechanism is decided here (Prime Directive #13); the commercial half — stage 2's off-host anchors (WORM, SIEM, KMS-held signing) — stays in cloud.
- **The input** is cloud `docs/design/audit-tamper-evidence.md` (cloud PR #4025): §2 (measurements — who can change a row today, the archive move, replicas, write cost), §3 (a) and §5 stage 1. ⚠ **This record was drafted without a verbatim reading of that document**: no session of this repository can read `objectstack-ai/cloud`. Every point below is built from the card's seven points (#31907) and from this repository's code. Where the design document might already answer a question this record answers, the record decides it on its own reasoning and says so; the PR that lands this record lists those points for the cloud lane to check against the document.
- **The names** this record fixes (objects, the spec key, the CLI command and its flags, the seams, the lock key, the vocabularies) were nominated in the card's step 0 and ruled by the owning seat (`domain:server#4`) on 2026-11-10.
- **Readings**: every code citation is a symbol anchor (`path#symbol`) read on `objectstack-ai/objectstack` at `60f8149e` (2026-11-10). Nothing below was run; the readings are of code.

---

## Context

### Who can change a ledger row today

- **Not a user.** `packages/plugins/plugin-audit/src/objects/sys-audit-log.object.ts#SysAuditLog` is `managedBy: 'append-only'`, every field is `readonly`, and the data API serves `get` and `list` only. Its own docblock states the rest: platform code running in a system context — the retention archive-then-delete and the redaction migrations — "can still change or delete them, and nothing records that it did."
- **The platform, in three rewrites.** Each is an operator-run, dry-run-by-default migration that rewrites value columns of rows already written, in the hot store and in the archive datasource:
  `packages/plugins/plugin-audit/src/stored-metadata-body-migration.ts#migrateStoredMetadataBodyCopies` (`os migrate audit-metadata-bodies`),
  `packages/plugins/plugin-audit/src/mail-log-body-migration.ts#migrateMailLogBodyCopies`, `#migrateArchivedMailLogBodyCopies` (`os migrate audit-mail-bodies`, over `#runLedgerCopyRewrite`),
  `packages/plugins/plugin-audit/src/key-material-copy-migration.ts#migrateKeyMaterialCopies`, `#migrateArchivedKeyMaterialCopies` (`os migrate audit-key-material`).
- **The platform, in two moves.** `packages/objectql/src/lifecycle/lifecycle-service.ts#archiveObject` copies rows past `archive.after` (90 days) to the `archive` datasource and deletes them hot only after the copy succeeded; it then deletes rows past `archive.keep` (7 years) from the archive with one `created_at` cutoff — a row-granular cut that falls wherever the clock says.
- **Anyone with the database or the host.** Nothing in the row, beside it, or anywhere else lets anyone tell afterwards that a row was edited, inserted with a back-dated `created_at`, or deleted.

### What a proof must not leak

A content hash of a value-bearing column is an offline guess-verifier: whoever holds the hash and a candidate value can confirm the guess without the database. That is the lesson of #21207 (ruling records 5942670275 and 5950183039): "copies never carry the hash", and a keyed copy that dies on key rotation was refused as the fix. `old_value`, `new_value` and `metadata` carry whole record bodies, so a proof that hashes them in clear would reopen exactly that exit — and would hand it to whoever receives a checkpoint off-host in stage 2.

### The primitives that exist

- **One-at-a-time work across replicas:** `packages/spec/src/contracts/cluster-service.ts#ILock` (lease with `ttlMs`, `renew`) and `#LockHandle` (a monotonic `fencingToken` per acquisition), reached as `#IClusterService` `.lock`. Precedent for a singleton background worker: `packages/services/service-messaging/src/dispatcher.ts#NotificationDispatcher`.
- **Secret custody:** `packages/spec/src/contracts/crypto-provider.ts#ICryptoProvider` — `encrypt` / `decrypt` / `rotateKey` over a `#CryptoHandle` persisted as a `sys_secret` row (rotation re-wraps and keeps the handle id), and `keyedDigest` (an HMAC whose every output changes when the key is replaced). The contract has no signing member.
- **Ed25519 in this tree:** `packages/runtime/src/plugin-trusted-keys.ts#readPublisherPublicKey` (plugin publisher signatures, `node:crypto`).
- **The lifecycle seam:** `packages/objectql/src/lifecycle/lifecycle-service.ts#LifecycleService` and its per-object `registerReapGuard`, through which a plugin already has its say over what the sweeper deletes.
- **The opt-in home:** `packages/spec/src/data/object.zod.ts#LifecycleSchema`, the strict per-object `lifecycle` block whose `class: 'audit'` already names "compliance ledger".

---

## Decision

Terms. A **sealed object** is an object that declares `lifecycle.seal` ([D10](#d10--opt-in-lifecyclesealvaluefields-on-an-audit-class-object)). A **chain** is one sealed object × one organization, or × the deployment ([D5](#d5--rows-about-no-organization-seal-into-a-deployment-chain)). A **window** is a fixed, UTC-aligned interval of `created_at`. A **checkpoint** seals one chain's rows of one window.

### D1 — Canonical form: each row is one leaf; value columns enter as salted commitments

- **The leaf input** of a row is a JSON object of the sealed object's columns, in clear except the declared value fields ([D10](#d10--opt-in-lifecyclesealvaluefields-on-an-audit-class-object)), which enter as commitments. For `sys_audit_log`: `id`, `created_at`, `action`, `user_id`, `actor`, `object_name`, `record_id`, `ip_address`, `user_agent`, `tenant_id` in clear; `old_value`, `new_value`, `metadata` as commitments. An absent value is `null` and is committed too, so a value appearing where there was none is a change.
- **The column set is recorded in the checkpoint**, not read off the live definition. A field added to the object later does not change any sealed leaf; it joins leaves from the first checkpoint that lists it.
- **Serialization** is RFC 8785 (JSON Canonicalization Scheme) over that object, with a datetime written as UTC ISO-8601 to the millisecond (`YYYY-MM-DDTHH:mm:ss.sssZ`) whatever the driver returned. The archive datasource may hand a column back in another type than the hot store did; the canonical form is what makes a moved row hash the same in both. A `canon` version number travels in every checkpoint, so a future form is a new version, never a silent change.
- **Commitment** of value `v` in column `c` of row `id`: `SHA-256(salt ‖ JCS(v))`, with `salt` from [D2](#d2--salts-come-from-one-sealed-seed-per-checkpoint).
- **Tree.** Leaf hash `SHA-256(0x00 ‖ JCS(leaf input))`, node hash `SHA-256(0x01 ‖ left ‖ right)` (the domain separation of RFC 6962), leaves ordered by `(created_at, id)`, an odd last node promoted unchanged. The root is the checkpoint's root.
- **Why.** Salted commitments keep the proof from becoming the offline guess-verifier #21207 closed, while a later redaction can still be shown to be the only change ([D7](#d7--redaction-writes-a-signed-amendment-before-the-rewrite)). Committing per column, rather than salting the whole row, is what lets a redaction touch one column and leave the others checkable.

### D2 — Salts come from one sealed seed per checkpoint

- **Each checkpoint draws a 32-byte random seed.** The salt of column `c` of row `id` is `HMAC-SHA-256(seed, object ‖ 0x00 ‖ id ‖ 0x00 ‖ c)`.
- **The seed is stored only sealed**: `ICryptoProvider.encrypt` under the sealer's own producer context (ADR-0128), persisted as the `sys_secret` row the contract prescribes; the checkpoint carries the handle id. The seed never leaves the deployment: not in a checkpoint's body, not in an export ([D11](#d11--two-export-seams-named-here-built-in-stage-2)), not in a proof bundle ([D9](#d9--os-audit-verify)).
- **Why a sealed seed, not `keyedDigest`.** `keyedDigest` changes every output when the key is replaced, so salts derived from it would make every sealed window unverifiable at the first key rotation — the "keyed copies that die on key rotation" option #21207 refused. An `encrypt` handle survives rotation (`rotateKey` re-wraps it under the same id). One seed per checkpoint, rather than one per row, keeps the secret count to the checkpoint count; rather than one per deployment, it bounds what one disclosed seed exposes to one window of one chain.
- **Cost, accepted.** One `sys_secret` row per checkpoint. An expiry deletes the seeds of the windows it removes ([D8](#d8--expiry-is-window-aligned-and-writes-a-signed-amendment)).

### D3 — The sealer: asynchronous, after a settle lag, one at a time under the cluster lock

- **Nothing changes on the insert path.** Every writer goes on inserting exactly as `packages/plugins/plugin-audit/src/audit-writers.ts#installAuditWriters` and its siblings do today; the ledger table is never written by the sealer.
- **Where it runs.** In `@objectstack/plugin-audit`, the plugin that owns the ledger, started at `kernel:ready` on an interval. It is not part of the LifecycleService: sealing and retention have different cadences, and the sweeper reaches the sealer only through the expiry seam of [D8](#d8--expiry-is-window-aligned-and-writes-a-signed-amendment).
- **One sealer at a time.** Each pass holds the cluster lock `audit.sealer` (with a TTL, renewed while it works). A checkpoint extends its chain only if the chain's head is still the one the sealer read: the build makes `(chain, sequence)` unique, so a sealer whose lease lapsed mid-pass cannot write a second checkpoint at a sequence another already took, and the lock's fencing token is recorded on the checkpoint it wrote.
- **Windows and settle lag.** A window is sealed once `now ≥ window end + settle lag`. This record fixes the defaults: a **1-hour** window and a **10-minute** settle lag. The lag absorbs clock skew between replicas and writers still in flight; whether an operator may change either number is the build card's to propose, never a tenant's.
- **Late rows are sealed as late, never ignored.** A checkpoint records the ids of the rows it sealed. On every pass the sealer re-counts the sealed windows of the last **7 days** (the late horizon) and seals any row of a sealed window that no checkpoint lists into a checkpoint of kind `late`, chained like any other, covering the same window. A row back-dated beyond the horizon is not sealed by the sealer; `os audit verify` reports it ([D9](#d9--os-audit-verify)).
- **Backlog.** When sealing first runs on an object, the sealer seals the existing rows window by window from the oldest. Such a checkpoint proves the rows have not changed **since it was sealed**, which is what its `sealed at` says, and no earlier.
- **An empty window writes no checkpoint.** The chain links of [D4](#d4--checkpoints-one-merkle-root-per-chain-per-window-chained-and-signed) already make a deleted checkpoint visible, so an empty window needs no row to prove it was empty.
- **When it cannot seal it says so, once, at `error`.** A deployment with a sealed object but no crypto provider or no signer has declared tamper evidence it does not deliver while everything looks healthy — the durability class of AGENTS.md's degradation rule. The first line names the consequence (rows of the sealed object are not being sealed) and the fix (wire a crypto provider, or remove `lifecycle.seal`).

### D4 — Checkpoints: one Merkle root per chain per window, chained and signed

- **Checkpoints are rows of their own object, `sys_audit_checkpoint`**, platform-written (`managedBy: 'append-only'`), private by default (`access: { default: 'private' }`, as `sys_jwks`), read through `get` / `list` by platform administrators and by `os audit verify`. The object is excluded from the audit writer (no ledger row about a checkpoint) and is not itself a sealed object: its integrity is its chain and its signatures.
- **A checkpoint carries**: the sealed object and the chain (organization id, or NULL for the deployment chain), its sequence in the chain, its kind (`window` or `late`), the window's start and end, the leaf count and the sealed row ids, the root, the digest of the chain's previous checkpoint (NULL for the first), the column set and the `canon` version, the seed's handle id, the sealer's fencing token, when it was sealed, the id of the signing key, and the signature. Column names are the build card's.
- **The signature** is Ed25519 over the JCS form of every field above except the signature itself ([D6](#d6--one-deployment-ed25519-signing-key-whose-private-half-is-stored-only-wrapped)).
- **Chaining.** The previous-checkpoint digest is `SHA-256` of the previous checkpoint's signed body. Deleting, replacing or reordering a checkpoint breaks the link of the one after it.

### D5 — Rows about no organization seal into a deployment chain

- **A row whose `tenant_id` is NULL** — a deployment-level action under ADR-0131 D7 (`config_change` on the settings global rung, `platform_admin_standing_change`, plugin-auth's run-level `import`) — seals into the sealed object's **deployment chain**, whose checkpoints carry a NULL organization id. Every other row seals into the chain of the organization its `tenant_id` names.
- **Why not leave them out.** The rows about no organization are the platform-administrator acts: who held standing, which global setting changed. A proof that skipped them would skip the rows a security review asks about first.
- **Why not one deployment-wide chain for everything.** A per-organization chain is what lets an organization be verified, exported and expired on its own, and what stage 2 hands to one customer without the others' roots. An organization that is deleted keeps its ledger rows (the delete leaves every `append-only` object's rows naming it) and so keeps its chain.

### D6 — One deployment Ed25519 signing key, whose private half is stored only wrapped

- **One active key per deployment** signs every checkpoint and amendment of every chain. Its public half, with its id (a fingerprint of the public key), its status (`active` / `retired`) and when it was created and retired, is a row of **`sys_audit_signing_key`**. A retired key's row is kept for as long as any checkpoint or amendment it signed is.
- **The private half is persisted only as an `ICryptoProvider.encrypt` handle** (a `sys_secret` row, bound to the sealer's producer context under ADR-0128); its plaintext never leaves the process that decrypts it to sign, and is never written, logged or exported.
- **Rotation** writes a new key, retires the old one and signs from then on with the new one; nothing already signed is re-signed.
- **The signer is a seam.** The local key is the default implementation of `IAuditCheckpointSigner` ([D11](#d11--two-export-seams-named-here-built-in-stage-2)); stage 2 replaces it with a KMS-held key, and then no private half is stored at all.
- **Why one deployment key, not one per organization.** A key per organization multiplies custody and rotation by the organization count and adds nothing on the host: whoever can read one organization's sealed key from the database can read them all. Per-organization separation is real only off the host, which is stage 2's.

### D7 — Redaction writes a signed amendment before the rewrite

- **Every rewrite of a sealed row's value column writes an amendment first**, a row of **`sys_audit_amendment`** of kind **`redaction`**: the sealed object, the chain, the checkpoint that sealed the row, the row id, the column, the commitment the checkpoint sealed, the commitment of the rewritten value (computed with the same salt), the migration that rewrote it, when, the signing key id and the signature over the rest.
- **The three rewrites of today** — the stored-metadata-body, mail-body and key-material migrations named in [Context](#who-can-change-a-ledger-row-today), hot store and archive datasource alike — are the writers. Any later rewrite of a sealed object's rows goes through the same amendment writer; a rewrite path that does not is a defect against this record.
- **Order and refusal.** The amendment is written before the row is rewritten. A row in a sealed window whose amendment cannot be written (no crypto provider, no signer) is **not** rewritten, and the migration reports it as refused; a rewrite with no record of itself is exactly what this record closes. A row not yet sealed needs no amendment: the sealer seals the rewritten value. The migrations' dry-run default and their reports are unchanged.
- **What verification reads.** If a row's current commitment equals the amendment's rewritten commitment, the leaf is rebuilt with the sealed commitment, matches the root, and the row is `redacted`. If the rewrite never landed after the amendment was written, the current commitment still equals the sealed one and the row is `unmodified`, with the dangling amendment listed.
- **Amendments are signed, not chained.** Deleting an amendment turns its row from `redacted` into `modified` — loud, not silent — so a chain over amendments adds no detection.

### D8 — Expiry is window-aligned and writes a signed amendment

- **The 7-year prune deletes whole windows.** For a sealed object, the cutoff of `archive.keep` (and of `retention.maxAge` or `ttl` on a sealed object that declares no archive) is rounded down to the end of the last window wholly past it. The sweep deletes that range's rows, their checkpoints and the checkpoints' seeds, and writes one amendment per chain of kind **`expiry`**: the sealed object, the chain, the range of sequences and windows removed, the digest of the last removed checkpoint (so the first remaining checkpoint's link still verifies), the policy that expired it (`archive.keep` and its value), when, and the signature.
- **The seam.** The LifecycleService runs the delete; the audit plugin supplies the alignment and writes the amendment, through a seam the build card adds beside `registerReapGuard`. A failure to write the amendment keeps the rows for the next sweep, as a vetoing reap guard does today.
- **The archive move is not an amendment.** A row moved from the hot store to the archive datasource is unchanged; verification reads both stores.
- **Why window-aligned.** A row-granular cutoff cuts a window in half: the remaining half no longer hashes to the root, and an honest expiry would read as `missing`. Aligning costs at most one window of extra retention, and it lets verification read an expired range as `expired` by policy, never as `missing`.

### D9 — `os audit verify`

- **Live check (the default).** Boots the stack the way the `os migrate audit-*` commands do (system context, hot store and archive datasource), reads every chain of every sealed object, recomputes each leaf with its seed, checks every root, link and signature, applies the amendments, and reports every row as one of **`unmodified`**, **`modified`**, **`missing`**, **`late`**, **`redacted`** or **`expired`**, with counts per chain and the id of every row that is not `unmodified`.
- **Rows no checkpoint holds.** A row in a sealed window that no checkpoint lists — a back-dated insert past the late horizon — is reported `late` and flagged unsealed; it fails the run, because on the host alone it cannot be told from a forged insert.
- **`--out FILE`** writes the **proof bundle** of the live check it just ran: the public keys, the checkpoints and amendments, and for each row its leaf input with the value columns as commitments only. A bundle holds no value, no salt and no seed, so it can be handed to an auditor without handing over a record body or a guess-verifier for one.
- **`--bundle FILE`** checks an existing bundle **offline**, without booting anything: it proves the bundle is internally consistent (leaves hash to roots, links hold, signatures verify against the bundle's keys). It cannot re-read the rows; that is what the live run that wrote the bundle did. `--bundle` is mutually exclusive with `--out` and with booting; together they are refused as a usage error.
- **Scope.** `--org ID` (repeatable) limits the check to those organizations' chains; with no `--org`, every chain, the deployment chain included. `--from` / `--to` (ISO-8601) limit it to the windows they overlap. `--json` prints the machine-readable report.
- **Exit codes.** `0` when every chain, link and signature verifies and every row is `unmodified`, `late` (sealed), `redacted` or `expired`; `1` when any row is `modified`, `missing` or `late` unsealed, or any link or signature fails; `2` for a usage error or a stack that would not boot.
- **No REST door is decided here.** A Setup screen or a route serving verification is a later decision.

### D10 — Opt-in: `lifecycle.seal.valueFields` on an audit-class object

- **An object opts in by declaring `lifecycle.seal = { valueFields: string[] }`** in its ADR-0057 `lifecycle` block. The key's presence seals the object; `valueFields` names the columns that enter as salted commitments ([D1](#d1--canonical-form-each-row-is-one-leaf-value-columns-enter-as-salted-commitments)), and every other declared column enters in clear.
- **Only `lifecycle.class: 'audit'` may declare it**, and every name in `valueFields` must be a declared field; anything else is refused at authoring. The sealer's expiry rides on the same block's `archive.keep`, and the class that needs a proof is the one that block already calls the compliance ledger.
- **`sys_audit_log` opts in by default** with `valueFields: ['old_value', 'new_value', 'metadata']`. Enterprise's `sys_ai_audit_log` opts in from cloud.
- **This record names the key; it does not add it.** The build card adds it to `packages/spec` together with its reader, as an ADR-0049 pair, declaring `Metadata-protocol: added`. Until then nothing is sealed.
- **Not taken:** `enable.tamperEvidence` (a flag cannot say which columns are value-bearing, and `enable` gates UI and API capabilities, not persistence); a new top-level `ledger` block (a top-level key for one feature of one class).

### D11 — Two export seams, named here, built in stage 2

- **`IAuditCheckpointSink`**, in the service slot **`audit.checkpointSink`**: handed every checkpoint and amendment once it is signed, to take it off the host (WORM storage, a SIEM). The open build ships no sink; with none registered, checkpoints stay on the host.
- **`IAuditCheckpointSigner`**, in the service slot **`audit.checkpointSigner`**: names its key id and signs bytes. The open build ships the local signer of [D6](#d6--one-deployment-ed25519-signing-key-whose-private-half-is-stored-only-wrapped); stage 2 registers a KMS-held one.
- **Why two seams.** Signing has to happen before export and on every checkpoint; export may be batched, retried or absent. A KMS signer on the export path would make an unavailable sink stop sealing.
- **This record names the interfaces and their slots only.** Their method shapes are the build card's, and their implementations beyond the local signer are stage 2's.

---

## Names this record fixes

| What | Name |
|:--|:--|
| Opt-in key | `lifecycle.seal` = `{ valueFields: string[] }`, `lifecycle.class: 'audit'` only |
| Checkpoint object | `sys_audit_checkpoint` |
| Amendment object | `sys_audit_amendment` |
| Signing public-key object | `sys_audit_signing_key` |
| Command | `os audit verify` — `--org`, `--from`, `--to`, `--out`, `--bundle`, `--json` |
| Seams and slots | `IAuditCheckpointSink` (`audit.checkpointSink`), `IAuditCheckpointSigner` (`audit.checkpointSigner`) |
| Cluster lock key | `audit.sealer` |
| Row verdicts | `unmodified`, `modified`, `missing`, `late`, `redacted`, `expired` |
| Amendment kinds | `redaction`, `expiry` |
| Checkpoint kinds | `window`, `late` |

---

## What this record does not decide, and what stage 1 cannot do

- **Whoever holds both the database and the signing key can re-sign.** Stage 1 detects a change, insert or delete made by anyone who lacks the signing key — through the database, a backup restore, a direct driver call, a rewrite that skipped its amendment. Someone who holds the database **and** can decrypt the signing key (the crypto provider's key, which on a self-hosted deployment is the operator's `OS_SECRET_KEY`) can rewrite rows, recompute roots and re-sign the chain. Only taking checkpoints off the host as they are signed — stage 2's sink and KMS signer — closes that.
- **Truncating a chain's head is not detectable on the host.** Deleting the newest checkpoints together with their rows leaves a shorter chain that still verifies. The off-host copy of stage 2 is what remembers the head.
- **Between insert and seal a row is unprotected** — up to one window plus the settle lag (70 minutes at the defaults).
- **A backlog checkpoint proves "unchanged since sealed", not "unchanged since written".**
- **Not decided here:** column names of the two new objects; whether window, lag or late horizon become configurable; the seams' method shapes; any REST or Setup surface for verification; which other platform ledgers (`sys_activity`, `sys_metadata_audit`, …) opt in — each is its own decision through `lifecycle.seal`.

---

## Consequences

- **Positive.** The ledger's "cannot be modified or deleted" becomes "cannot be modified or deleted without it showing", which is the claim a security review can check; the three sanctioned rewrites and the 7-year expiry stop being indistinguishable from tampering.
- **Cost.** One checkpoint row and one `sys_secret` row per active chain per window (at most 24 per organization per day), a signing key, and a background pass per hour. The insert path pays nothing.
- **Operational.** A deployment with no crypto provider cannot seal, and says so at `error` ([D3](#d3--the-sealer-asynchronous-after-a-settle-lag-one-at-a-time-under-the-cluster-lock)); a redaction migration refuses to rewrite a sealed row it cannot amend ([D7](#d7--redaction-writes-a-signed-amendment-before-the-rewrite)).
- **What builds on this.** [#31908](https://github.com/objectstack-ai/objectstack/issues/31908) builds D1–D11 in this repository; cloud#4016's stage 2 (cloud#4128) implements the two seams off the host.

## References

- Card [#31907](https://github.com/objectstack-ai/objectstack/issues/31907); build [#31908](https://github.com/objectstack-ai/objectstack/issues/31908); cloud#4016 (ruling (c), 2026-11-09), cloud PR #4025 (`docs/design/audit-tamper-evidence.md`), cloud#4128 (stage 2).
- [#21207](https://github.com/objectstack-ai/objectstack/issues/21207) — rulings 5942670275 and 5950183039 ("copies never carry the hash").
- RFC 8785 (JSON Canonicalization Scheme); RFC 6962 §2.1 (Merkle tree hashing and its leaf/node prefixes); RFC 8032 (Ed25519).
