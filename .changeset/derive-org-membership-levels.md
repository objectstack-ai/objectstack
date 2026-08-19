---
'@objectstack/spec': minor
---

`ORG_MEMBERSHIP_LEVELS` is now derived from `BUILTIN_MEMBERSHIP_ROLES` instead of hand-spelling a copy, so the `org_membership_level` approver vocabulary is exactly the `sys_member.role` vocabulary. Accept-set widening: `delegated_admin` (ObjectStack's own ADR-0105 D8 tier, already storable and enforced on `sys_member.role`) is now offered by the approver picker and valid as an `org_membership_level` approver value. The constant's provenance doc-comment is corrected in the same change: the list is ObjectStack's closed membership vocabulary (ADR-0108), no longer "better-auth's closed set".
