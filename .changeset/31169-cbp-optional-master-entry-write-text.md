---
'@objectstack/spec': patch
---

docs(spec): the semantic migration entry `cbp-optional-master-admitted` states the current write rule for an empty optional master, and the security-service contract names the `ownerMayEdit` owner leg

Clause-②: no
Metadata-protocol: none

- **Migration entry `cbp-optional-master-admitted`.** Its `replacement`, and its paragraph in the protocol upgrade guide, still said that a write leaving an optional `controlled_by_parent` master empty is refused with 422. The write gate admits such writes since the owner rule landed (ADR-0055 §3 as amended): an insert that names no master is admitted and its creator owns the row; its owner and a holder of Modify All on the detail update or delete a row whose master reference is empty, and everyone else, View All included, is refused `403 PERMISSION_DENIED`; an update that empties a named master asks edit access on the master it leaves. Only a required master's empty stored reference is still refused with `422 MISSING_REQUIRED_FIELD`. This supersedes the sentence "Writes are unchanged: an insert or update that leaves the master reference empty is still refused with 422" in the `@objectstack/plugin-security` note of `.changeset/30905-cbp-optional-master.md`: that was the state before the write gate followed, and the rule above is the one that ships. The entry's `id`, `surface`, `reason` and `acceptanceCriteria` are unchanged.
- **`ISecurityService.checkControlledByParentWrite` and `ControlledByParentWriteOutcome` (JSDoc).** Both now name the `sharing.controlledByParent.ownerMayEdit: true` opt-in (ADR-0055 §3 as amended 2026-10-26): a by-id update by the record's owner, not on behalf of another user, that does not empty an optional master, needs only read access to the master the record names, so the check answers `allow` for such an owner who can read it. Every other caller and every other write keeps the master-edit rule.

Text only: no schema, type, export or runtime answer changes.
