---
"@objectstack/platform-objects": minor
"@objectstack/plugin-auth": minor
"@objectstack/core": minor
"@objectstack/runtime": minor
---

feat(identity): API keys are minted against the minter's active organization, and carry it into the request (#8287)

<!-- adr-0087: not-required (no-migration-prescription) One additive column on
an `isSystem` object declaring `protection: { lock: 'full' }`, which tenants
cannot author, so there is no consumer metadata to migrate and nothing
authorable is renamed, retired or tombstoned — no conversion to register. The
behavioural change is that a minted key now carries an organization, that a key
which cannot carry one is refused under the posture where it could never read
anything, and that an ex-member's key stops authenticating. -->

On a deployment running `OS_TENANCY_POSTURE=isolated`, a minted API key could
read **nothing at all**. `sys_api_key` carried no organization column, so key
authentication established a user but no active organization — and the
`isolated` Layer 0 wall is `organization_id = activeOrganizationId`, which with
no active organization matches no row. Every organization-scoped read answered
`200` with `total 0` while the console went on offering minting, so a tenant
admin could mint a valid-looking secret and discover only at call time that it
read nothing. (There was no cross-tenant leak — the failure was in the other
direction.)

**The column was absent by an inherited rule, not by oversight.**
`resolveInjectedSystemColumns` injects `organization_id` into every registered
object *except* `managedBy: 'better-auth'` ones, and `sys_api_key` carries that
flag — even though better-auth's `apiKey` plugin is not loaded and the table is
hand-rolled ObjectStack. So the fix needs the declaration *and* the ADR-0105 D7
extension-field registration to stay consistent. The read side, by contrast,
was **already wired**: `resolveApiKeyPrincipal` already read an organization
into `tenantId` and `resolveAuthzContext` already adopted it — it was reading a
column no mint path ever wrote.

**What changes**

- `sys_api_key` declares `active_organization_id` (+ index, and the column is
  shown in the "My Keys" and "All" list views, because the card's complaint was
  a credential whose reach its owner could not see).
- `POST /api/v1/keys` **inherits** the caller's active organization — there is
  deliberately no org parameter and no cross-org key — and **re-checks the
  caller's `sys_member` membership at mint time**, honouring ADR-0091 validity
  windows. Under a walled posture it refuses (400) rather than minting a key
  with no organization, and refuses (403) for an organization the caller is not
  a member of. The mint response echoes the organization the key is pinned to.
- The verifier reads **one spelling** (Prime Directive #12): the
  `row.organization_id ?? row.organizationId` chain it used to carry was a
  consumer-side tolerance for a producer that did not exist.
- An **ex-member's key fails closed at verify time** — no principal, not a
  degrade to a user-only principal, which would resurrect the same
  `200 + total 0` silent-empty. Checked at verify rather than by revoking on
  membership loss, because membership ends through many paths (better-auth org
  endpoints, SCIM, a direct `sys_member` delete, a lapsing validity window) and
  a hook must catch every one or it silently misses. It costs **zero extra
  queries**: the resolver has already read `sys_member` for this user.
- **Pre-existing org-less keys are never backfilled** — that would silently
  upgrade credentials minted under a different promise. They keep working under
  `single` (no wall) and under `group` (whose wall derives from the owner's
  memberships independently of the active organization, so they already work
  there), and are **refused under `isolated`**, where they are provably dead
  today.

**The column is deliberately named `active_organization_id`, not
`organization_id`** — the `sys_session` spelling, for the same concept: the
organization a credential makes *active*. `objectHasOrgIdField` tests for the
literal `organization_id`, and Layer 0 exempts objects without it, so the other
name would have made `sys_api_key` itself org-walled. Both walled postures
exclude NULL, so every pre-existing org-less row would have vanished from its
**own owner's** "My Keys" list while, under `group`, continuing to
authenticate — a live credential nobody could see or revoke, which is a fresh
instance of the very class this change removes.
