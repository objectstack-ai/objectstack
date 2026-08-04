---
"@objectstack/plugin-auth": minor
"@objectstack/service-settings": minor
---

feat(auth): `membership_policy` is a platform setting, and sign-up and backfill read one source (#5152)

**What a new user joins is now configurable at runtime.** ADR-0093's
`membershipPolicy` decides whether a freshly created user is auto-bound to the
deployment's default organization (`auto`) or gets membership only from an
explicit act — creating a workspace, accepting an invitation, an admin adding
them, SSO just-in-time provisioning (`invite-only`). Until now it was settable
**only** as an `AuthPlugin` constructor option, and the AuthPlugin a self-hosted
stack gets is injected by the CLI, which passes no such option and has no env
fallback. Every self-hosted deployment therefore ran `auto`, with no way to say
otherwise. `invite-only` was, in practice, unreachable outside a custom host.

It is now `auth.membership_policy` in the platform settings — a two-value select
(`auto` / `invite-only`, default `auto`) alongside `signup_enabled`, which it
pairs with: one says whether people may self-register, the other says what they
join when they do. Set it in Setup → Authentication → Membership, or pin it
per-deployment with `OS_AUTH_MEMBERSHIP_POLICY`. It applies **without a
restart** — the existing `settings.subscribe('auth', …)` re-application seam
carries it, the same one the password-policy keys ride.

**No behaviour changes unless you set it.** Only an *explicit* value applies;
the manifest's `auto` default is a UI default and never masks a deployment that
configured the policy in code. A stack that sets nothing keeps today's
auto-binding exactly.

**Bug fix — the two membership paths read one source.** Sign-up (the reconciler
in better-auth's `user.create.after`) read the AuthManager's live config, while
the ADR-0093 D6 backfill of pre-existing member-less users read the plugin's
**constructor options**. Wiring a setting to the first and not the second would
have produced "sign-up honours the new policy, backfill still runs the old one"
— and the backfill binds in **bulk**, so it is the more dangerous half. Both now
resolve the policy through the new `AuthManager.getMembershipPolicy()`, and the
backfill waits for the settings namespace to bind before its first pass (the two
`kernel:ready` hooks fire in registration order, which was the wrong order).

**An invalid value is rejected, not coerced.** `PUT /api/settings/auth` refuses
a policy outside the declared option table (`invalid_option`, naming the allowed
set). A value arriving from `OS_AUTH_MEMBERSHIP_POLICY` — which bypasses that
validation — is logged at `error` and **ignored**, leaving the deployment's
current policy in force; it is never silently read as `auto`, because that would
leave an operator believing a wall is up while every sign-up is auto-bound.

New public API on `@objectstack/plugin-auth`: `AuthManager.getMembershipPolicy()`,
plus `MEMBERSHIP_POLICIES` and `isMembershipPolicy()` from `reconcile-membership`.
