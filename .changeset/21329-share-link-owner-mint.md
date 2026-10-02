---
'@objectstack/plugin-sharing': minor
---

feat(plugin-sharing): the record owner and an explicit Modify-All holder may mint a share link on a record the data door refuses them (ADR-0111 D8 rule 1, ruling A′) (#21329)

Clause-②: yes (widening)

- **Who may mint.** `ShareLinkService.createLink` admits the caller when they can see the record, **or** own it, **or** hold `modifyAllRecords` on the object. The object's `publicSharing` opt-in is still checked first, and `publicSharing.eligibility` still last. On an object declared `access: { default: 'private' }` no wildcard grant covers the record, so its owner's own read is refused; the owner can now share it anyway. A member who neither sees nor owns the record is refused exactly as before, with the same envelope.
- **Who still needs visibility.** A hierarchy manager whose write depth covers the record's owner manages the record's shares (revoke, grant, list), but is not admitted to mint without seeing the record: a link creates access.
- **The organization wall.** Under the `group` and `isolated` tenancy postures the owner and Modify-All alternatives are withheld and visibility alone admits, as before this release. A member who left an organization still owns the records they created there, and must not be able to publish them by link.
- **API.** `SharingService.canMintWithoutVisibility(object, recordId, context)` answers the two alternatives with the owner and Modify-All branches `canManageShares` reads. `ShareLinkServiceOptions.canMintWithoutVisibility` is the late-bound probe `createLink` asks once the visibility read refuses, and `SharingServicePlugin` wires it. A host that constructs `ShareLinkService` itself without it keeps the visibility rule alone.
