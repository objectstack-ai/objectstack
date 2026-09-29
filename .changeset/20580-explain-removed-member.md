---
'@objectstack/plugin-security': patch
'@objectstack/core': minor
---

fix(plugin-security): `security/explain` resolves the user it explains in the organization enforcement resolves them in, so a member whose membership in the caller's organization has ended is no longer explained holding that organization's grants (#20580)

When an administrator explains another user, the explanation is computed in the administrator's own organization. Enforcement does one more thing for that same user first: under a walled tenancy posture (`isolated` or `group`), it drops an organization claim that no current membership backs, and the user resolves with no active organization, so only their global grants apply. The explainer skipped that check. For a user whose membership in the administrator's organization had ended, the explanation listed that organization's grants, and the verdicts they decide, while enforcement applied none of them.

The explainer now asks the same check before it resolves the user, and resolves them where it says. `@objectstack/core` exports that check as `vetOrganizationClaim(claimedOrganizationId, accessibleOrgIds, tenancyPosture)`. It returns the claimed organization while a current membership backs it or while no wall is enforced, and `undefined` once the claim is dropped. `resolveAuthzContext` asks the same function for a session's claim, so the two cannot disagree. This is a new export with no behaviour change to `resolveAuthzContext`.

Unchanged:

- Enforcement admits and refuses exactly what it did before.
- A current member's explanation.
- The `single` posture, where no claim is dropped on either side.
- Explaining yourself, and a caller with no active organization.
