---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a platform operator's tenant-scoped insert from a session with no active organization is refused 403 naming the missing organization, as a member's is, instead of a 500

Clause-②: no (no accept set moves: the insert was refused before and is refused now, with the ADR-0123 D2 answer in place of an internal error)

- **Before.** Under `group` or `isolated`, a platform operator (`admin_full_access`) whose session had no active organization got `500 ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` for a create on a tenant object whose posture lets it cross the organization wall (`access.default: 'private'`). The operator crosses the wall there, so the wall let the insert through, and the engine then refused the row as a system write with no organization.
- **After.** That create gets `403 PERMISSION_DENIED` with the message a member gets in the same state. The message names the missing active organization and tells the user to join or select one.
- **Unchanged.** Nothing was written before and nothing is written now. The refusal judges the row as it is about to be stored, the same row the engine's own organization check reads, so it covers exactly the inserts that answered 500 and no insert that was admitted. These are as before:
  - a row a `beforeInsert` hook places in an organization;
  - the operator's reads and updates across organizations;
  - inserts from an operator with an active organization;
  - inserts into objects that opted out of tenancy;
  - system contexts (which still meet the engine's own refusal);
  - every `single` answer.
