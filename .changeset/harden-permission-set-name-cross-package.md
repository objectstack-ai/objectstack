---
'@objectstack/metadata-protocol': patch
---

harden(metadata): a permission set's name is unique across packages

Clause-②: no (narrowing) — the metadata save door and the draft→active promotion now refuse a permission-set write (`PUT /api/v1/meta/permission/:name`, draft or publish, and `POST /api/v1/packages/:id/publish-drafts`) whose name an active set of a DIFFERENT owner already holds, with `RESOURCE_CONFLICT` / 409 and nothing written. This pulls the HTTP door back to an already-declared contract: a grant resolves its set by name alone (ADR-0131 D4) and a package never writes into a record another owns (ADR-0086 D4) — the registry already refuses a second holder of a set name at install, and the Studio dialog already refuses the duplicate. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, accepted value, metadata type, export or type changes: a save the HTTP door accepted against an already-declared contract (ADR-0086 D4) is now refused with the door's own worded RESOURCE_CONFLICT envelope, so there is nothing for a migration to rewrite and no tombstone — the same stance the sibling unmanaged-install name-collision refusal takes. -->

**BREAKING** accept-set narrowing at the metadata door (`@objectstack/metadata-protocol`), served by the permission-set save door and the draft→active promotion.

- **Before.** The HTTP door keyed a permission-set write by `(type, name, package)`, so a package could save and publish a set under a name another installed package already published. Resolution by bare name then answered one of the two across packages, and the create precondition (`If-None-Match: *`) was evaluated against the keyed row alone, so it did not notice the name was taken under another package.
- **Now.** A permission-set write whose name an active set of a different owner holds is refused — `RESOURCE_CONFLICT` / 409, nothing written — at the save door (draft and publish mode) and again at the draft→active promotion (the per-item publish and the package publish), so a draft authored before another owner took the name cannot be promoted either. The check runs before the create precondition, so `If-None-Match: *` cannot smuggle a cross-owner create.
- **Owner.** The owner is the publishing package (`package_id` / `_packageId`), or the environment for a runtime-created set. `permission` takes no environment overlay (ADR-0005), so the rule is symmetric on the owner; the same-owner edit path — the owning package re-authoring its own set — is unchanged, and the original holder's access is untouched.
- **Who sees it.** A deployment that published two permission sets of one name from two packages: the second write is now refused where it used to be accepted.

**The remedy.** Rename the set to a name its own package owns (prefix it with the package's module prefix), or edit the set in the package that already owns the name and re-publish.
