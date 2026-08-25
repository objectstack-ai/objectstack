---
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
'@objectstack/verify': patch
---

feat(spec,plugin-auth)!: one declared audience posture — `invite_only | email_domain | open`, default `invite_only`

**BREAKING CHANGE (ships as `minor` under the launch-window rule; every publishable package rides the fixed group).** "Who may become a user of an environment's apps" is now ONE declaration instead of an emergent property of five switches — and its default flips to the safe end.

- New authorable surface `auth.audience` on `AuthConfig` (`@objectstack/spec/system`): `posture` (`invite_only` | `email_domain` | `open`), `allowedEmailDomains` (required non-empty for `email_domain`), `selfRegistrationPermissionSet` (required whenever the posture permits self-registration; `admin_full_access` refused). Off-vocabulary postures and inert declarations (domains outside `email_domain`, a permission set under `invite_only`) are refused at parse AND at plugin-auth's config entry — never coerced.
- **FROM:** an undeclared audience meant open email/password self-registration with no email verification, and self-registrants implicitly fell back to the `member_default` permission set. **TO:** an undeclared audience IS `invite_only` — self-serve sign-up (email/password, social-provider OAuth JIT, magic-link/OTP/phone/anonymous, and any unclassified creation method) is refused `403 SELF_REGISTRATION_CLOSED` unless the address holds a pending `sys_invitation` (the first account on a fresh install is exempt — the bootstrap bypass). One-line fix for deployments that mean to stay open: declare `auth: { audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } }`.
- `email_domain` admits only allowlisted domains (`403 EMAIL_DOMAIN_NOT_ALLOWED` otherwise; exact case-insensitive match, subdomains not implied, `+tag` local parts irrelevant). Any self-registration-permitting posture FORCES `requireEmailVerification` on (an explicit `false` beside it is refused at boot) and grants each self-registrant the DECLARED permission set (`sys_user_permission_set`); a declaration that cannot be resolved refuses admission (`403 AUTH_CONFIG_ERROR`) rather than admitting ungranted.
- Operator-driven creation is never posture-gated: admin create-user / bulk import, SCIM provisioning, and JIT through operator-registered identity providers (`oidcProviders`, `@better-auth/sso`) keep working under every posture.
- `/api/v1/auth/config` now serves `features.audiencePosture` and mirrors the forced verification flag; `SELF_REGISTRATION_CLOSED` and `EMAIL_DOMAIN_NOT_ALLOWED` are registered in the ADR-0112 ledger.
- The BOOTSTRAP bypass counts non-system HUMANS, not `sys_user` rows, so a database still carrying the legacy `usr_system` service row is still a fresh install; the same predicate now backs the dev-admin seed's own precondition. The `emailAndPassword.disableSignUp` bootstrap bypass reads it too.
- `@objectstack/verify`: `stack.signUp(...)` seeds a pending `sys_invitation` for the address before signing up, so harness fixtures that mint a second/third identity enter through the invitation carve-out under the new default. Fixtures asserting on their environment's pending invitations should filter by their own `organization_id` (the harness rows carry `org_verify_audience_gate`).

<!-- adr-0087: registered audience-posture-default-invite-only -->
