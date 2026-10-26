---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
'@objectstack/lint': minor
---

feat(spec,plugin-security,lint): a `controlled_by_parent` detail may opt its rows' owners into updating them with read access to the master — `sharing.controlledByParent.ownerMayEdit: true`

Clause-②: yes (widening) — a detail row's owner now passes the master-detail write gate with READ on the master, on an object that declares the opt-in; everyone else, and every other shape of write, still needs master EDIT. The default is unchanged.
Metadata-protocol: added (`ObjectSchema.sharing.controlledByParent.ownerMayEdit`, a per-object opt-in read only under `sharingModel: 'controlled_by_parent'`)
Ruling-ref: 6398566164 (letter 1)

ADR-0055 §3 had one rule for every write of a `controlled_by_parent` detail: EDIT access to the master record. Salesforce's Activities under OWD = Controlled by Parent let the owner of an activity edit it while merely reading its account; the platform could not express that, and an authored `owner_id == current_user.id` update policy on the detail could not either — the detail's own policies compose AND with the master gate, so it only narrowed the master's editors.

- **Spec.** `ObjectSchema` gains `sharing: { controlledByParent: { ownerMayEdit: boolean } }`, both blocks closed. `ownerMayEdit: true` is refused at parse on any object that is not a `sharingModel: 'controlled_by_parent'` detail, at `sharing.controlledByParent.ownerMayEdit`. The reader `controlledByParentOwnerMayEdit(schema)` (`@objectstack/spec/data`) fails closed on every shape but the parsed `true`.
- **Gate.** On an opted-in detail, a by-id `update` by the caller whose `userId` is the stored row's `owner_id` (the registry's injected per-record owner) passes step 2.8 when the caller can READ the master row, asked of the read door under the caller's own context. Insert, delete, a predicate (`multi: true`) update and a delegated (on-behalf-of) write keep the master-edit rule; a body that re-points the master reference still asks EDIT on the master it names; a row with no owner admits nobody. The detail's own object grant and row-level policies run before the leg, unchanged. An opt-in on an object whose schema carries no `owner_id` column (`ownership` other than `'user'`) is inert and reported once per object at `warn` by the relation resolver.
- **Lint.** `os lint` reports `security-controlled-by-parent-owner-policy-without-opt-in` (warning) for an `update` or `all` row-level policy whose `using` or `check` keys a field on the caller (`owner_id == current_user.id`, either operand order, the SQL `=` spelling included) on a `controlled_by_parent` detail that has not declared the opt-in. `os explain security-controlled-by-parent-owner-policy-without-opt-in` prints why such a policy can only narrow, and what the opt-in changes.
- **ADR-0055** §3 is amended (2026-10-26, #25760) with the opt-in, its boundaries, and what stays out of scope.
