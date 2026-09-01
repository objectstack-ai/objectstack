---
"@objectstack/plugin-security": patch
---

fix(plugin-security): registry-driven managed-object write denies now reach `organization_admin_no_bypass` (#14029)

`MANAGED_DENY_TARGET_SETS` named four default sets, and `applyManagedWriteDenies`
matches on it exactly — so at `kernel:ready` the injection walked the derived
`organization_admin_no_bypass` variant and skipped it. The variant is a shallow
copy of `organization_admin` taken at module load (`deriveWallLessOrgAdmin`
strips only the `viewAllRecords`/`modifyAllRecords` superuser bits), which means
its `'*'` wildcard still grants create/edit/delete AND entries injected into the
parent's `objects` can never propagate to it. Its own docblock declares
"managed-write denies … carried over verbatim"; the behaviour violated that
declared contract.

No gap opens on today's tree — the static `BETTER_AUTH_MANAGED_OBJECTS`
baseline covers the 30 declared managed tables and is copied into the variant at
derivation. The gap was the next `managedBy: 'better-auth'` schema that lands
without a hand edit to that list: `organization_admin` would receive the
injected deny while the wall-less variant's wildcard kept granting raw CRUD on
an identity table — precisely the drift the registry-driven module exists to
close (ADR-0092), on the posture (`auto-org-admin-grant` under a wall-less
deployment) where the bits are least bounded.

- `ORGANIZATION_ADMIN_NO_BYPASS` is now a member of `MANAGED_DENY_TARGET_SETS`.
  The variant's pre-existing explicit entries (static baseline, RBAC read-only
  block) survive unchanged — the injection skips any object a set already
  names.
- The membership pin no longer checks the list against itself: the required
  floor ("default sets holding a write-granting `'*'` wildcard") is derived
  from the real seeded sets and diffed against the list; a non-empty
  difference is red. `admin_full_access` stays deliberately excluded (admin
  rescue path) and that exclusion is pinned exactly.
