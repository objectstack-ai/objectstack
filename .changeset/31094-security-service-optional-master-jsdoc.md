---
'@objectstack/spec': patch
---

docs(spec): the security-service contract describes an empty optional `controlled_by_parent` master reference

Clause-②: no
Metadata-protocol: none

Documentation only; no type, export or behaviour changes. Since ADR-0055 §3 as amended on 2026-11-07, a `controlled_by_parent` object may have one optional master, and a row whose optional master reference is empty is written by its owner or by a holder of Modify All on its object. The JSDoc of `ISecurityService.checkControlledByParentWrite` and its outcome types now says so:

- `ControlledByParentWriteDenialLeg`'s `master_chain` also covers the record whose own optional master reference is empty, refused to a principal who neither owns it nor holds Modify All on its object, and a master above it whose optional master reference is empty, which ends the chain under that row's owner rule. Only a required master's empty reference above the record is the chain-walk refusal the old text described.
- `ControlledByParentWriteUnresolvedReason`'s `master_reference_missing` is a stored **required** master reference left empty; an empty optional one answers `allow` or `deny` on `master_chain`.
- `ControlledByParentWriteOutcome`'s `allow` and the member's own description name the owner rule beside edit access to the master.
