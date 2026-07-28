---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
"@objectstack/plugin-security": patch
---

fix(sharing): remove the `full` access level — it promised delete/transfer/share and granted `edit` (#3865)

`sys_sharing_rule.access_level` / `sys_record_share.access_level` offered three
levels, the third documented as **Full Access (Transfer, Share, Delete)**. No
code path granted transfer, re-share, or delete because of it: both enforcement
sites matched `access_level in ('edit','full')`, so `full` was byte-equivalent
to `edit`. An admin picking "Full Access" in Setup was told they had granted
delete rights and had not — declared-but-unenforced metadata (ADR-0078,
ADR-0049), the same defect that retired the `queue` recipient before it.

Measured on showcase, a `full` recipient got `read: allowed`, `update: allowed`,
`delete: DENIED` — and the denial came from `decidedBy=object_crud`, i.e. the
object-level CRUD gate rejected the delete *before* sharing was consulted at
all. That is not an oversight to patch around; it is the model working. Record
sharing widens **which rows** a principal reaches, never **which verbs** they
may use — the same split Salesforce enforces (its sharing rules stop at
Read-Only / Read-Write; Full Access is owner / hierarchy / Modify All only,
never grantable by a rule) and Dataverse enforces by AND-ing every shared access
right against the security role's own privilege. Delete and transfer belong to
ownership, the ADR-0057 DEPTH scopes, and admin scope.

**What changed**

- `SharingLevel` (spec/security) and `ShareAccessLevel` (spec/contracts) are now
  `read | edit`. The `Field.select` on both objects offers the same two, so the
  Setup dropdown no longer shows the misleading option.
- `SharingService.grant()` and `SharingRuleService.defineRule()` gained the
  access-level validation they never had: `full` normalises to `edit`, and an
  unrecognised level is a `VALIDATION_FAILED` (HTTP 400) instead of being
  persisted verbatim as a grant no gate would ever match.
- Enforcement stays deliberately wider than authoring — the read/write gates
  still match `edit`/`full` — so a row written before this release keeps
  working. Narrowing them would silently *revoke* access.
- A boot backfill normalises stored `full` rows on both tables, and the
  `sharing-rule-access-level-full-to-edit` conversion rewrites declarative
  stacks at load, so nothing needs consumer action.

**Migration.** None. `full` and `edit` were already behaviourally identical, so
rewriting one to the other cannot change an access decision — unlike the OWD
`sharingModel: 'full'` alias retired in ADR-0090 D4, which changed posture and
had to be delegated to the author. A stack that still authors `accessLevel:
'full'` converts at load with a deprecation notice; stored rows normalise at
next boot. Code that pinned the `ShareAccessLevel` type to `'full'` no longer
compiles — use `'edit'`.

Reviving a real per-record delete grant is a separate design (a capability mask
AND-ed with object CRUD, plus the share-administration model that would have to
authorise re-sharing), not a fourth enum member.
