---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@objectstack/lint': minor
---

feat(security): the read-only `viewAllFields` object-permission bit

Clause-②: yes (widening) — @objectstack/spec adds the optional `viewAllFields` key to `ObjectPermissionSchema` (and so to the wire `EffectiveObjectPermissionSchema`) and the optional `viewAllFields` column to `AccessMatrixEntrySchema`; nothing removed or narrowed
Metadata-protocol: added

A permission set can now say "this role reads every field of this object" on its own: `objects: { crm_account: { allowRead: true, viewAllFields: true } }`. The bit casts a read vote on every field of the object, fields added later included, and never an edit vote: an edit still comes from the default (a field no set names follows the object grant) or from an explicit `editable: true` field row. Inside one set the specific row beats the general bit, so a set's own `readable: false` row on a field keeps that field hidden for that set. It is allowed on the `'*'` wildcard entry. It is a field vote only: it grants no object access and widens no record, so pair it with `allowRead`, and use `viewAllRecords` for records.

Nothing behaves differently yet. Today `viewAllRecords` and `modifyAllRecords` also vote on every field, so on a set that carries either bit the new key duplicates a vote already cast. The built-in `organization_admin` set carries it on its wildcard entry, so its holders keep their field visibility when a later major release stops those two bits voting on fields; the wall-less `organization_admin_no_bypass` variant drops it together with the two record bits, as it never held that field vote.

Every reader of the super-user bits reads the new one too:

- both field merges (`PermissionEvaluator.getFieldPermissions` and the `fields` slot of `/auth/me/permissions`) apply it through the one shared vote, `superuserFieldVote` in `@objectstack/core`;
- the agent ceiling clears it on every object entry, as it clears View All and Modify All;
- an organization administrator cannot distribute a set whose `'*'` entry carries it (the organization boundary, condition (a));
- a set carrying it on any object is high-privilege, so it is not bound to the `everyone` or `guest` audience;
- the access-matrix snapshot gains a `viewAllFields` column, written only when `true`, so the `access-matrix.json` of a stack that does not author the bit is byte-identical, and the semantic diff names it ("gains View All Fields on …").
