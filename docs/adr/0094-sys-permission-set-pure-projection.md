# ADR-0094: Permission-Set Definitions Have One Authoritative Store — `sys_permission_set` Becomes a Pure Projection

**Status**: Accepted (2026-07-14)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (overlay store), [ADR-0056](./0056-permission-model-landing-verification.md) (landing verification), [ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md) (two doors / provenance)
**Closes**: framework#2875 (root cause behind the #2857 display-freshness class)
**Consumers**: `@objectstack/plugin-security`, `@objectstack/metadata-protocol`, Setup/Studio surfaces

---

## TL;DR

A permission-set **definition** (label, description, the six facet groups, `adminScope`,
`active`) now has exactly **one authoritative store: the metadata layer** — packaged
declarations plus the `sys_metadata` overlay, merged overlay-wins by the protocol's
layered read. The queryable `sys_permission_set` data record is a **derived read-model
(projection)**, never independently authoritative. This is enforced **structurally**,
not by a subscriber a new write path might forget to trigger:

1. **Write-through at the engine choke point.** Every non-system data-plane write to
   `sys_permission_set` (the Setup UI's generic CRUD, bulk imports, any future API that
   goes through ObjectQL) is intercepted by an engine middleware and **redirected into a
   metadata write** (`saveMetaItem` / `deleteMetaItem`). The driver write never executes,
   so no data-door path can produce a record the metadata doesn't back.
2. **Awaited projection.** The metadata protocol gains a per-type **mutation projector**
   (`registerMutationProjector`) that is **awaited inside** `saveMetaItem` /
   `publishMetaItem` / `deleteMetaItem`, after persistence and before the write returns.
   The projector is the **only writer** of the record. A Studio save therefore returns
   only after the record already reflects it — no projection race (the #2867 subscriber
   was fire-and-forget).
3. **Boot reconciliation + one-time backfill.** At `kernel:ready` the projection is
   re-derived from metadata (metadata wins), and legacy records that exist **only** in
   the data plane are migrated into the metadata store once.

Package-owned records (`managed_by:'package'`) keep the shipped declaration as their
BASELINE (boot seeding / publish materialization), and — per the revised D5 — the
environment customizes them through the standard ADR-0005 overlay: the record projects
the effective (overlay-wins) body with its package provenance preserved, and removing
the overlay resets it to the declaration. Forging package provenance through the data
door stays impossible.

---

## Context

`sys_permission_set` had **two writable stores** that were only loosely synchronized:

- **The metadata layer** — declarations registered by packages, plus env-scope edits
  written to the `sys_metadata` overlay by Studio (`saveMetaItem`). This is what the
  layered read shows and (mostly — see below) what enforcement resolves.
- **The data record** — snake_case JSON-string columns that Setup reads for lists and
  user assignment, and *wrote* through the generic data CRUD endpoint.

They were synced at boot and on publish (ADR-0086 D5/P2), and — after #2867 — by an
`onMetadataMutation` subscriber projecting env-scope metadata saves onto the record.
That subscriber is eventually-consistent glue: any write path that bypasses it (a bulk
import, a migration, a future API) desyncs the two stores with no single winner.

The audit for this ADR found the split-brain is worse than a stale display:

- **Enforcement is metadata-first.** `PermissionEvaluator.resolvePermissionSets`
  resolves names from `metadata.list('permission')` first, the DB record last. A Setup
  edit of a *declared* set (e.g. `member_default`) therefore updated the record — and
  was **silently enforcement-inert**: the evaluator kept using the declared body. The
  record lied in *both* directions.
- **The manager's `list()` is registry-first**, while the protocol's layered read is
  overlay-wins. An env-scope Studio edit of a declared set displayed (layered read,
  and — after #2867 — the record) but the evaluator still resolved the *declared* body
  from the in-memory registry. Display and enforcement disagreed with no error anywhere.
- **Studio-created env sets never appeared in Setup** (the #2867 projection declined to
  create records), and Setup-created sets never existed in metadata at all — the record
  was their *only* store, resolvable solely through the evaluator's DB fallback loader.

## Decision

### D1 — The metadata layer is the only authoritative store for definitions

The authoritative body of a permission set named `X` is the protocol's **layered
effective read** for `permission/X` (env-scope overlay wins over packaged declaration).
The `sys_permission_set` record for `X` is a projection of exactly that body, keyed by
`name`. Row `id`s are stable (junction tables `sys_user_permission_set` /
`sys_position_permission_set` reference them); the projector updates in place and never
recreates ids.

**Assignments and bindings stay data-plane.** Which users/positions hold a set is
environment *state*, not part of the definition; those tables are unchanged.

### D2 — The record is written only by the projector, awaited by the protocol

`@objectstack/metadata-protocol` gains `registerMutationProjector(type, fn)`: an
awaited, best-effort per-type hook invoked after persistence inside `saveMetaItem`
(active saves), `publishMetaItem`, and `deleteMetaItem`, receiving
`{ type, name, state, organizationId, body? }`. A projector failure is surfaced on the
write's response (`projectionApplied: { success:false, error }`) and logged — never
thrown, the metadata write itself succeeded and boot reconciliation heals on next start.

`plugin-security` registers the `permission` projector. It re-reads the **fresh layered
effective body** and:

- upserts the record (creates it if missing, `managed_by:'user'` — Studio-created
  sets now appear in Setup); a PACKAGE-OWNED record's facets follow the effective
  body too, with its `managed_by:'package'` + `package_id` provenance preserved
  (see D5 — an env overlay is the standard customization of a packaged set);
- syncs the **metadata manager's in-memory `permission` entry**
  (`registerInMemory`) so the evaluator's registry-first `list('permission')`
  resolution sees the same effective body it projects — closing the
  display-vs-enforcement divergence described above;
- on a mutation whose layered read yields **no body at all** (a runtime-only definition
  was deleted), retires the record (engine delete; trash semantics apply) and drops the
  in-memory entry.

The existing `onMetadataMutation` subscription remains only as a compatibility fallback
when the protocol predates `registerMutationProjector`.

### D3 — Data-door writes are redirected into metadata (write-through)

An engine middleware (registered by `plugin-security`, object-filtered to
`sys_permission_set`, running **inside** the security middleware so all existing
authorization — the ADR-0086 two-doors gate, the ADR-0090 D12 delegated-admin gate,
CRUD/FLS checks — applies first) translates every **non-system** write:

| Data-door operation | Redirected to |
| :-- | :-- |
| `insert` (Setup "New" / clone) | `saveMetaItem('permission', name, body)` → projector creates the record |
| `update` (facet/label/active edits) | merge patch into the layered effective body → `saveMetaItem` → projector updates the record |
| `delete` of a **runtime-only** set | `deleteMetaItem` (hard delete) → projector retires the record (trash applies) |
| `delete` of an **artifact-backed** set | `deleteMetaItem` (overlay tombstone = reset, ADR-0005) → projector re-projects the **declared** body; the record resets instead of vanishing |
| `restore` (un-trash) | record restore proceeds, then the definition is re-authored into metadata from the restored row |

The driver write for insert/update/delete never executes; `opCtx.result` is the
projected record. Renaming a set through the data door is rejected (the name is the
metadata identity; clone-then-delete is the supported flow). System-context writes
(`isSystem`) pass through untouched — they *are* the projector/seeder channel.

Kernels without a metadata protocol capable of `saveMetaItem` /`getMetaItemLayered`
(minimal embeddings, unit-test stubs) fall back to the direct write: with a single
store there is no split brain to prevent.

### D4 — Boot reconciliation and the migration/backfill path

At `kernel:ready`, after the ADR-0086 D5 package seeding, `plugin-security` runs a
convergence pass:

1. **Overlays → records.** Every active env-scope `permission` overlay is projected
   (creating missing records). Metadata wins.
2. **Backfill (one-time migration).** An env-authored record (`managed_by` ≠
   `'package'`) whose name has **no metadata presence** (no declaration, no overlay) is
   a legacy data-door creation — its body is written into the metadata store via
   `saveMetaItem`. Enforcement is unchanged by construction: the evaluator's DB
   fallback loader was already resolving exactly this body. After the backfill the
   record is derived like every other.
3. **Drift healing.** An env-authored record whose name *has* metadata presence but
   whose columns differ from the effective body is re-projected from metadata, with a
   loud warning. Metadata wins deliberately: for such names the evaluator already
   resolved the metadata body, so the record drift was **display-only and never
   enforced** — promoting it into metadata would silently *change* effective
   permissions at upgrade, which is worse than discarding a lie.

The pass is idempotent and re-runs harmlessly on every boot.

### D5 — Env-scope overlays of package-owned sets are FIRST-CLASS customizations (revised 2026-07-14)

**History.** As first landed, the projector refused env-scope bodies for
package-owned records (the #2867 rule), which left an authored overlay of a
packaged set inert — neither projecting nor enforcing. The initial follow-up
(#2898) proposed rejecting such overlays at authoring time. The maintainers
reversed that direction on 2026-07-14: rejection would have made permission
sets the one metadata type whose declared `allowOrgOverride: true` is a lie,
and "clone to customize" **forks** — a clone stops receiving the vendor's
subsequent baseline changes (including security tightenings) and loses the
layered code-vs-overlay diff.

**Decision.** An environment-scope overlay of a package-owned permission set
is the platform's **standard ADR-0005 customization**, fully supported:

- the projector projects the EFFECTIVE (overlay-wins) body onto the record
  while **preserving** `managed_by:'package'` + `package_id` — the package
  still owns the row; the overlay customizes it;
- a data-door edit of a package row is translated by the write-through into
  exactly this overlay (no more flat 403); a data-door "delete" removes the
  overlay — an ADR-0005 **reset** to the shipped declaration;
- the ADR-0086 two-doors gate narrows to what is still structurally true:
  the admin door can never **forge** package provenance, and lifecycle ops
  with no overlay translation (`transfer`/`restore`/`purge`) stay refused on
  package rows. In a kernel without a metadata overlay layer the legacy full
  refusal applies (there is nothing to carry a customization);
- cross-package composition remains a POSITION concern (bind several
  packages' sets to one position — the union model adds; an overlay narrows),
  and package-first authoring (ADR-0070) gives runtime-created sets a home
  package, so the loose `managed_by:'user'` category can retire over time.

**The risk this accepts, deliberately.** ADR-0005 overlays are whole-document:
an env overlay can widen a vendor baseline, and a vendor's later baseline
*tightening* does not reach a name that is pinned by an overlay until the
overlay is reset or re-authored. Mitigations: the Studio layered view diffs
code-vs-overlay; upgrade flows should surface "customized packaged sets" for
review; ADR-0091 recertification covers overlays like any other grant source.
This is the same trade every overlayable type makes — permission sets no
longer get a bespoke, stricter rule that the rest of the platform contradicts.

## Consequences

**Positive.**
- One truth. No write path — present or future — can desync the record from metadata
  through the data plane: the choke point is the engine middleware every ObjectQL write
  traverses, not an opt-in subscriber.
- Setup edits of declared sets finally **enforce** (they become env overlays), and
  Studio edits/creations appear in Setup **before the save returns** (awaited
  projection — acceptance criterion "no projection race").
- Display and enforcement can no longer disagree: both derive from the layered
  effective body (projection + in-memory registry sync).
- Legacy data is migrated, not stranded (D4 backfill).

**Negative / behavior changes.**
- "Deleting" an artifact-backed set through Setup now **resets** it to the declared
  body instead of deleting the row (the definition ships with the app and cannot be
  deleted from the env — the honest semantic; previously the delete produced a ghost:
  row gone, enforcement unchanged).
- Record drift authored through the data door **before** this change and shadowed by
  metadata is discarded at first boot (loud warn). It was never enforced.
- Renames through the data door are rejected.
- Engine object hooks / realtime `data.record.*` events no longer fire for redirected
  `sys_permission_set` writes from the data door (the projector's system writes fire
  them instead).

**Neutral / open.**
- Multi-node: the in-memory registry sync is per-node; cross-node convergence rides on
  the existing metadata watch/boot mechanisms (pre-existing posture, unchanged).
- Whether the *record* store can eventually be dropped entirely (queries served from
  metadata) stays open; junction FKs and Setup's list/query surface make the projection
  the pragmatic shape today.

## Alternatives considered

- **Keep hardening the #2867 subscriber** (more events, more call sites). Rejected —
  eventually-consistent glue between two writable stores can always be bypassed; the
  issue explicitly asks for a structural fix.
- **Deny all data-door writes and move Setup to the metadata API.** Rejected for now —
  breaks the Setup surface (sibling repo) and every existing integration; write-through
  preserves the API while changing the store underneath.
- **Make the record authoritative and project into metadata.** Rejected — the metadata
  layer is the platform-wide authoritative store for every other type (ADR-0005), is
  versioned/auditable, and is what enforcement already prefers.

## References

- framework#2875 (this ADR), #2857 / #2867 (display-freshness gap and projection
  band-aid), ADR-0005, ADR-0086 (D3/D4/D5/P2), ADR-0090 (D12), ADR-0056.
- Implementation: `packages/plugins/plugin-security/src/permission-set-projection.ts`,
  `packages/metadata-protocol/src/protocol.ts` (`registerMutationProjector`),
  `packages/plugins/plugin-security/src/security-plugin.ts` (wiring).

---

## Addendum (2026-07-14): generalizing to the sibling declared-metadata ↔ queryable-record types

`sys_permission_set` is not the only object with **two stores** — a declared
definition in the metadata layer AND a queryable `sys_*` record, historically
synced only at boot and on publish. An audit found three siblings seeded the
same way: `sys_position` (`bootstrapDeclaredPositions`), `sys_sharing_rule`
(`bootstrapDeclaredSharingRules`), and `sys_capability`
(`bootstrapSystemCapabilities`). This addendum promotes the decision from a
permission-set-specific fix to a **classification rule** for all of them, so a
future maintainer neither leaves a split-brain unaddressed nor naively applies
the wrong cure.

### The general invariant

A declared definition and its queryable record must not be **two independently
writable authorities** reconciled only at boot/publish. Exactly one is
authoritative; the other is derived and documented as such — enforced
structurally (a choke point every write traverses), not by a subscriber a new
path can bypass.

### The classification criterion — *which store does enforcement read at request time?*

The cure follows the authority, and the authority is decided by one question:
**at request time, does the runtime read the metadata definition or the data
record?**

- **Metadata-authoritative** (enforcement resolves the definition from the
  metadata layer) → the record is a **pure projection** (this ADR's machinery:
  data-door write-through + awaited `registerMutationProjector` +
  `registerAuthoringGate` + boot reconciliation). The record must never be an
  independent authority, because it isn't the one enforcement trusts.
- **Record-authoritative** (enforcement reads the `sys_*` record live) → the
  record is the authority and the declared metadata is a **boot SEED only**,
  not a competing overlay. The cure is the mirror image: the seeder must not
  clobber an environment-edited record, and no path may treat the declared
  body as a live override that silently loses to (or fights) the record. **Do
  not** apply the projection machinery here — projecting the record *from*
  metadata would invert the real authority.

The generic protocol seams added by this ADR (`registerMutationProjector`,
`registerAuthoringGate`) serve the *metadata-authoritative* case and are
reusable by any such type; the record-authoritative case needs no new seam,
only a seed-not-clobber discipline.

### Per-type decisions

| Type | Enforcement reads | Class | Decision |
| :-- | :-- | :-- | :-- |
| `sys_permission_set` | metadata (`PermissionEvaluator.resolvePermissionSets` → `metadata.list('permission')`, DB row only as fallback) | metadata-authoritative | **Record is a projection — done** (this ADR). |
| `sys_sharing_rule` | the record, live (`sharing-plugin.ts` "rule evaluation reads `sys_sharing_rule` live"; `sharing-rule-service` `engine.find`) | **record-authoritative** | Declared rules are a **boot seed**; the record is the authority. Do **not** project. Audit that `bootstrapDeclaredSharingRules` preserves env-edited rows (seed-not-clobber) and that the metadata overlay is not read as a live override. |
| `sys_position` | mixed — position→permission-set resolution is metadata-first for the *sets*, but the `sys_position` **record** (incl. its `permissions` field, bindings, `delegatable`, `admin` gating) is read live by the anchor gate and `DelegatedAdminGate` | **needs the seed-vs-authority audit** against the criterion above; likely record-authoritative for bindings with metadata seeding identity | Classify precisely, then either project (if the position *definition* is enforced from metadata) or make declared positions seed-only. |
| `sys_capability` | the record (curated registry read for capability existence) | record-authoritative (registry) | Seed-only; low authoring surface. Audit seed-not-clobber. |

Only `sys_permission_set` was both metadata-authoritative **and** carried a
harmful, actively-drifting split-brain, which is why it was fixed first and in
full. The others are recorded here with their class so the follow-up work is
scoped, not rediscovered — tracked in framework#2909.

### Why an addendum, not a new ADR

The decision — *one authoritative store; the other derived; enforced
structurally* — is identical; only the per-type **direction** differs. A
separate ADR would duplicate the rationale and split the classification from
the decision that motivates it. This addendum keeps the rule and its
applications in one place.
