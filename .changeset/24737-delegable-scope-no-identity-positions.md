---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the delegable-scope report no longer offers the built-in identity positions to a platform administrator or a delegate

Clause-②: no

`GET /security/my-delegable-scope` (`describeDelegableScope`) listed `platform_admin`, `org_owner`, `org_admin` and `org_member` in `assignablePositions` for a tenant-level administrator and for a delegate holding a placing `adminScope`. `sys_user_position.position` refuses those four names from every writer with `400 VALIDATION_FAILED`, so the invite dialog and Setup's position picker offered choices that could only fail.

Every branch of the report (tenant-level, organization-level, delegated) now reads one position listing that leaves out the ADR-0068 D2 identity names through the same `isReservedIdentityName` predicate the write's validation is built from, beside the audience anchors it already left out. No other position leaves any branch, and placeable business units are unchanged. The write path's refusal and the reserved list are unchanged. No spec key, endpoint or configuration changes.
