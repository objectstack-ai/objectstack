---
'@objectstack/plugin-sharing': minor
'@objectstack/spec': patch
---

feat(plugin-sharing): the record owner and an explicit Modify-All holder may mint a share link on a record the data door refuses them (ADR-0111 D8 rule 1, ruling A′) (#21329)

Clause-②: yes (widening)

- **Who may mint.** `ShareLinkService.createLink` admits the caller when they can see the record, **or** own it, **or** hold `modifyAllRecords` on the object. The object's `publicSharing` opt-in is still checked first, and `publicSharing.eligibility` still last. On an object declared `access: { default: 'private' }` no wildcard grant covers the record, so its owner's own read is refused; the owner can now share it anyway. A member who neither sees nor owns the record is refused exactly as before, with the same envelope.
- **Who still needs visibility.** A hierarchy manager whose write depth covers the record's owner manages the record's shares (revoke, grant, list), but is not admitted to mint without seeing the record: a link creates access.
- **The organization wall.** Under the `group` and `isolated` tenancy postures the owner and Modify-All alternatives are withheld and visibility alone admits, as before this release. A member who left an organization still owns the records they created there, and must not be able to publish them by link.
- **A required capability.** Neither alternative applies past a capability the object requires (`requiredPermissions`). An owner or Modify-All holder who lacks it is refused with the capability gate's own refusal, as before this release; an owner who holds it, refused only because no permission set grants the object, mints. The verdict is read from the `required_permissions` layer of `ISecurityService.explain`, so a security service the sharing service reaches must implement `explain`. If it does not, the two alternatives are withheld.
- **API.** `SharingService.canMintWithoutVisibility(object, recordId, context)` answers the two alternatives with the owner and Modify-All branches `canManageShares` reads. `ShareLinkServiceOptions.canMintWithoutVisibility` is the late-bound probe `createLink` asks once the visibility read refuses, and `SharingServicePlugin` wires it. A host that constructs `ShareLinkService` itself without it keeps the visibility rule alone. The probe slice `SharingServiceOptions.securityService` returns gains an optional `explain`, the part of `ISecurityService.explain` the capability verdict reads.
- **`@objectstack/spec` (documentation only).** The `IShareLinkService.createLink` TSDoc states who may mint, replacing "you may only link-share a record you can yourself see". The `ISharingService.canManageShares` TSDoc describes the hierarchy-manager branch, which is implemented, and says it is not mint authority. No schema, key, type or export changes.
