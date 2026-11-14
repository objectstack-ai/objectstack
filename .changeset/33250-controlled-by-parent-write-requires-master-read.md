---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
'@objectstack/lint': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

feat(spec, plugin-security): `sharing.controlledByParent.writeRequiresMasterRead` lets a `controlled_by_parent` detail ask read access on its master, not edit, for every write (ADR-0055 §3 as amended)

Clause-②: yes (widening) — `ObjectSchema` accepts one new optional boolean, `sharing.controlledByParent.writeRequiresMasterRead`, that it refused as an unknown key before. An object that declares it as `true` moves runtime answers, all toward admit: a write by a principal who can read the master but not edit it was refused `403 PERMISSION_DENIED` and is now judged by the detail's own permissions, row-level security and field-level security. Two new parse refusals ship with the key, both on declarations that did not parse before (the key itself was unknown): the key set `true` on an object whose `sharingModel` is not `controlled_by_parent`, and the key set `true` beside `ownerMayEdit: true`. An object that leaves the key out, or sets it `false`, answers byte-for-byte as before.
Metadata-protocol: added

**What the opt-in does.** A `controlled_by_parent` detail derives its access from its master. Reads already follow read access on the master; every write asked edit access on it (ADR-0055 §3). With `sharing.controlledByParent.writeRequiresMasterRead: true` on the detail, the master question for a write is read instead of edit, for every write path:

- insert (single and batch), by-id update and delete, predicate (multi-row) update and delete;
- every hop of a master chain: a hop whose detail opted in asks read on its master and ends the walk there; a hop that did not opt in asks edit, as before;
- re-pointing a row to another master asks read on the new master and on the one it leaves; emptying an optional master asks read on the master it leaves;
- a write on behalf of another user (ADR-0090 D10) asks read on the master under each pass's own context, so the agent and the delegator must both read it.

After the master question the detail's own object permissions, row-level security and field-level security decide, as they decide every write. A principal who cannot read the master still cannot write: an insert or re-point answers `403 PERMISSION_DENIED` ("requires read access to its master record"), and a by-id update or delete meets the read door first, `404 RECORD_NOT_FOUND`, because the detail row's own visibility derives from the master. Unchanged: the platform ownership floor on predicate writes, the required-master `422 MISSING_REQUIRED_FIELD`, and the optional-master owner rule for a row with no master.

**Parse refusals (`ObjectSchema`).**

- `writeRequiresMasterRead: true` on an object whose `sharingModel` is not `controlled_by_parent` is refused at `sharing.controlledByParent.writeRequiresMasterRead`, as `ownerMayEdit` is.
- `writeRequiresMasterRead: true` together with `ownerMayEdit: true` is refused at `sharing.controlledByParent.ownerMayEdit`: delete `ownerMayEdit`; `writeRequiresMasterRead` already admits the owner.

**`@objectstack/spec`.** The new key, its `.describe()` text, the exported reader `controlledByParentWriteRequiresMasterRead(schema)` (`@objectstack/spec/data`), the object form's toggle ("Read on master is enough to write"), the liveness ledger entry (`live`), and prose on `ISecurityService.checkControlledByParentWrite`, `ControlledByParentWriteOutcome` and `ControlledByParentWriteDenialLeg`: under the opt-in, `allow` means the caller can read every master the write reaches, and a denial reuses the existing legs (`object_permission` when the master object is not readable, `row_level_security` when the master row is hidden). No type or union changes.

**`@objectstack/plugin-security`.** The write gate, `checkControlledByParentWrite` and `os explain` (`explain-engine`) all ask the read question for an opted-in detail and agree with each other.

**`@objectstack/lint`.** `security-controlled-by-parent-owner-policy-without-opt-in` stays silent on a detail that declares `writeRequiresMasterRead: true`: its own write policies decide there, so an `owner_id` policy is no longer dead under the master gate. No new rule.

**`@objectstack/platform-objects`, `@object-ui/app-shell`.** The toggle's label and help text in every shipped metadata-form locale, and the Studio's zh-CN label.
