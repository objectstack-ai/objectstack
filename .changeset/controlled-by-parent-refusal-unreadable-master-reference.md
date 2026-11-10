---
'@objectstack/plugin-security': patch
'@objectstack/lint': patch
---

fix(plugin-security, lint): a refused controlled_by_parent write names no master to a writer who cannot read the master reference, and lint warns a set that hides that reference

Clause-②: yes (widening)
Metadata-protocol: none

- **The rule.** A write of a `controlled_by_parent` detail needs edit access to the master its stored master reference names (ADR-0055 §3), whatever the writer may read. Who is admitted and who is refused does not change.
- **The refusal's words follow the writer's field-level security on that reference.** A writer who can read the master reference keeps today's refusal, word for word. A writer who cannot read it (field-level security `readable: false` on the reference) gets the same `403 PERMISSION_DENIED` with a sentence that names no master object, no master record and no check: `… requires edit access to its master record (no edit permission on the parent record of this detail)`. This applies to every refusal of the master-detail write check (the master's object permission, its row-level security, its record sharing, a master further up the chain, and the owner rule of a row whose optional master is empty), on an update, a delete and a create alike. "Can read" is the readable projection the data plane's reads mask by; when it cannot be resolved, the refusal takes the generic sentence. This narrows refusal text only: no status, code, accepted input or success answer changes.
- **New lint warning `security-controlled-by-parent-master-reference-hidden`.** `@objectstack/lint` (and so `os lint`, `os validate` and the metadata save of a permission set or object, which reports it without refusing the save) warns a permission set whose field permission hides the master reference of a `controlled_by_parent` detail (`readable: false`): the hidden field still decides every write of the detail by that set's holders, and a holder refused there sees only the generic refusal. Not reported when the same set holds View All or Modify All on the detail, which makes the mask inert. `os explain security-controlled-by-parent-master-reference-hidden` prints the rule. The rule id is exported as `SECURITY_CBP_MASTER_REFERENCE_HIDDEN`, the widening this changeset declares.
- **A warning still fails a strict run.** Nothing is refused by this rule, but a pipeline that runs `os lint --strict` or `os validate --strict` fails on any warning, so a stack that hides a master reference fails such a pipeline until the reference is made readable or the strict flag is dropped.
