---
"@objectstack/plugin-security": minor
"@objectstack/plugin-auth": minor
"@objectstack/types": minor
"@objectstack/verify": patch
---

fix(security): walled postures elevate only the env-declared platform owner, never the first registrant (#11184, the framework leg of cloud#1509)

**BREAKING** for walled deployments (`OS_TENANCY_POSTURE=group` or
`isolated`), shipped as `minor` under the repo's launch-window convention for
breaking changes. Single-org deployments are byte-for-byte unchanged.

Measured defect (cloud#1509): on a walled multi-tenant SaaS with
`OS_TENANCY_POSTURE=isolated` and `OS_AUTH_MEMBERSHIP_POLICY=invite-only`, the
FIRST self-registrant received the cross-tenant `admin_full_access` grant
(`platform_admin`, `isPlatformAdmin: true`) and — because the default-org
bootstrap binds "the platform admin" — was merged into the deployment's
Default Organization as its owner. Whoever curls the public sign-up endpoint
first owned the platform.

Per the maintainer ruling of 2026-08-23 (verbatim:
「1509 选择 env 指定 owner 邮箱」):

- **Walled postures: platform admin comes ONLY from the env-declared owner.**
  `bootstrapPlatformAdmin` (plugin-security) no longer promotes the oldest
  human user when the requested posture is walled; it promotes exactly the
  account whose email matches the new `OS_PLATFORM_OWNER_EMAIL` variable
  (case-insensitive, matched whenever that account registers — arrival order
  is irrelevant). Self-registrants are never promoted and, since the shared
  `ensureDefaultOrganization` helper binds only the platform admin, are never
  auto-merged into the Default Organization either.
- **Fail-closed startup refusal.** A walled posture with no
  `OS_PLATFORM_OWNER_EMAIL` declared refuses to boot from `AuthPlugin.init()`
  with a message naming the variable — never a silent fallback to
  first-registrant elevation. The elevation site itself also refuses
  (`reason: 'walled_owner_email_undeclared'`, logged at `error`) as
  defense-in-depth for compositions that reach the bootstrap without
  plugin-auth (`os meta resync`, bare embeddings).
- **Single-org posture unchanged.** "First user is owner" stays as ruled
  reasonable there; the new variable is never consulted under `single`.
- The requested posture (`resolveTenancyPosture()`) is deliberately the input,
  so a walled-requested deployment running degraded
  (`OS_ALLOW_DEGRADED_TENANCY=1`) still refuses first-registrant elevation.

Operator action for walled deployments: set `OS_PLATFORM_OWNER_EMAIL` to the
operator account's email address before upgrading. Deployments that already
hold a human platform admin are untouched (the bootstrap remains a no-op once
any human holds the cross-tenant grant); the variable governs installs that
have not yet minted their admin. `@objectstack/types` gains the
`resolvePlatformOwnerEmail()` resolver and the `PLATFORM_OWNER_EMAIL_ENV`
constant; the verify harness declares the owner email (defaulting to its dev
admin) for walled fixtures.

<!-- adr-0087: not-required (no-migration-prescription) nothing authorable is removed, renamed or narrowed: no spec key, no metadata spelling and no stored row changes shape, so there is nothing for `os migrate meta` to rewrite and no ledger entry to make. The prescription above is a deployment-environment requirement (declare an env var before boot), which the ADR-0087 ledger does not carry — the refusal itself names the variable at startup. -->
