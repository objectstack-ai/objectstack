---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
"@objectstack/plugin-security": minor
---

feat(sharing): hierarchy managers may manage shares within their write DEPTH (ADR-0111 D1 DEPTH)

`canManageShares` gains its named DEPTH extension: a caller whose effective
WRITE scope on the object is a hierarchy scope (`unit` / `unit_and_below` /
`own_and_reports`) may now manage shares on a record whose owner falls within
that scope's owner set — the same set the write filter and `canEdit` already
honour, resolved by the enterprise `hierarchy-scope-resolver`. This lets a
manager grant/revoke/list shares on a subordinate's record, matching
Salesforce (roles above the owner) and Dataverse (the `Share` privilege's BU
depth), without expanding the MVP owner + Modify-All authority.

- New `ISecurityService.resolveWriteScope(object, context)` — the effective
  write scope, resolved by the same evaluator the CRUD middleware uses; fails
  closed to `own`. Mirrored on the sharing plugin's structural probe.
- The gate honours only the three hierarchy scopes. `org` from the probe is
  deliberately ignored: it means both a genuine Modify-All holder (already
  granted via `hasWriteBypass`) AND the fail-OPEN "no permission set mentions
  this object" default, so honouring it here would reopen the hole
  `hasWriteBypass` was chosen to avoid.
- Fails closed with no security service or no enterprise resolver — the open
  edition stays owner + Modify-All, exactly as before.
