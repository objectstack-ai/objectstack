---
'@objectstack/plugin-sharing': minor
'@objectstack/lint': minor
---

feat: a share or sharing rule on a public object reaches an external member of the record's organization

Clause-②: yes (widening: the grant door and the materialiser admit one recipient population on effective-public objects)
Metadata-protocol: semantic

An external member (`sys_member.role` exactly `external`) reads only the rows it owns and the rows shared to it, on every object. On a `public_read_write` object, or a system object with no `sharingModel`, a share to it used to be refused as one that would never take effect. For that member it is the only thing that does.

- **Manual shares.** `SharingService.grant` now admits a `user` recipient on such an object when the recipient is an `external` member of the record's organization. Every other recipient keeps the 422 `SHARING_NOT_ENABLED`, with a message that says the share is consulted for external members only. A user who is external in one organization and a member of another is judged in the record's organization. `controlled_by_parent`, owner-less, federated phantom-anchor and bypass objects are refused for every recipient, as before.
- **Sharing rules.** A rule's pass writes rows for the external members it expands to and skips the internal ones without failing the pass. When it skips any, the evaluate result carries a one-line `note`, and the pass logs the count once.
- **Lint.** `sharing-rule-object-not-shareable` on a public object is now a warning: the rule is effective for external recipients only. `os explain` says when to keep it and when to change the object's `sharingModel`.
