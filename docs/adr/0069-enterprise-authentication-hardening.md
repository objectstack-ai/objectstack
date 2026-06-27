# ADR-0069: Enterprise authentication hardening — password policy, enforced MFA, SSO, session controls, network gating, and anti-brute-force, all enforcement-wired

**Status**: Proposed (2026-06-24)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (**the governing constraint** — a security property that isn't enforced at runtime is forbidden; no toggle may be a "false surface"), [ADR-0007](./0007-settings-manifest-and-kv-store.md) (settings manifest + cascade KV store), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (`sys_role` is platform-native, decoupled from better-auth; org scoping), [ADR-0066](./0066-unified-authorization-model.md) (capability/assignment split), [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) (`current_user` contract, built-in roles)
**Consumers**: `@objectstack/plugin-auth` (better-auth wiring, `bindAuthSettings`/`applyConfigPatch`, auth route middleware), `@objectstack/service-settings` (`auth.manifest.ts`), `@objectstack/platform-objects` (identity objects `sys_user`/`sys_session`/`sys_account`), `@objectstack/rest` (auth request middleware seam), `../objectui` (settings UI rendering)

**Premise**: pre-launch — specify the target end-state for the authentication settings surface. Dogfooding the **Setup app** as a brand-new system administrator standing up the platform for a company (see issue #2246) surfaced that today's auth surface is **10 settings** — email/password on, self-signup on, email-verification, password min/max length, session expiry/refresh days, and Google OAuth (`packages/services/service-settings/src/manifests/auth.manifest.ts`). That is enough for a demo, **not** enough for a company security review. A real admin cannot enable the platform without: a real password policy, the ability to *require* MFA, SSO beyond Google, session lifetime/idle/concurrency controls, network (IP) gating, and brute-force protection.

> **Hard constraint (ADR-0049).** Every setting introduced here MUST ship with the runtime code path that enforces it. A "Require MFA" toggle that doesn't actually block un-enrolled users, or an "IP allowlist" field nothing reads, is worse than nothing — it gives a false sense of security and fails the spec-liveness gate. This ADR is therefore organized as **(setting -> enforcement seam -> mechanism)** triples, not a wishlist of fields.

## TL;DR

1. **[new]** Extend `auth.manifest.ts` with enterprise groups — *Password policy*, *Multi-factor*, *Sessions*, *Network*, *Anti-abuse*, *SSO* — each field bound to a concrete enforcement seam below.
2. **[ruled]** Prefer **better-auth-native** mechanisms where they exist (1.6.x ships: core `rateLimit`, `haveibeenpwned` breached-password plugin, `twoFactor`, `genericOAuth`/`oidcProvider`, `multiSession`, session `expiresIn`/`updateAge`/`freshAge`). Add **custom hooks/middleware** only where better-auth has no native knob (password complexity/expiry/history, **account lockout**, **org-wide MFA requirement**, idle/absolute/concurrent session limits, **IP allowlist**).
3. **[new]** Add the identity fields that back enforcement: `sys_user.{password_changed_at, failed_login_count, locked_until, last_login_at, last_login_ip, mfa_required_at}`, `sys_session.{last_activity_at, revoked_at, revoke_reason}`, `sys_account.previous_password_hashes`. Without these there is nothing to enforce against.
4. **[ruled]** **SAML is out of better-auth core** (1.6.x exposes `genericOAuth` + `oidcProvider`, no `saml` plugin) -> scope SAML as **P3 / external** (assess `@better-auth/sso` or a custom plugin); ship **generic OIDC** (already wired via `genericOAuth`) as the v1 enterprise-SSO answer.
5. **[ruled]** Phased delivery: **P1** password policy + account lockout + enforced MFA; **P2** session controls + IP allowlist + rate-limit tuning; **P3** SSO expansion (OIDC trust-list UI, SAML assessment). SCIM/bulk-provisioning is a **separate** ADR (directory sync != auth hardening).
6. **[ruled]** Settings scope follows ADR-0007: security knobs are **`global`** scope, `manage_platform_settings` read/write; per-org overrides (`sys_organization.*`) are explicit and additive (an org can only *tighten*, never loosen, the global floor).

---

## Context: what exists today (better-auth 1.6.x)

`@objectstack/plugin-auth` wires better-auth and binds the Settings namespace into it (`bindAuthSettings` -> `applyConfigPatch`, which resets the auth instance on next request). Enabled better-auth features today: `bearer` (always), `organization`, `customSession`, and **opt-in** `twoFactor` / `admin` / `magicLink` / `oidcProvider` / `deviceAuthorization`; `genericOAuth` when `oidcProviders` is configured.

| Setting (today) | Enforcement seam | Real? |
|---|---|---|
| `email_password_enabled` | better-auth `emailAndPassword.enabled` | yes |
| `signup_enabled` | `emailAndPassword.disableSignUp` (+ first-user bypass) | yes |
| `require_email_verification` | `emailAndPassword.requireEmailVerification` | yes |
| `password_min_length` / `password_max_length` | `emailAndPassword.minPasswordLength` / `maxPasswordLength` | yes |
| `session_expiry_days` / `session_refresh_days` | `session.expiresIn` / `session.updateAge` (seconds) | yes |
| `google_*` | adds/removes Google from `socialProviders` | yes |

Everything present is genuinely enforced. The gap is **coverage**, not honesty — which is why the rule for what we add is the same one (ADR-0049).

---

## Decision — capabilities, each as (settings -> seam -> mechanism)

Legend: **[native]** = a better-auth config/plugin does the enforcing; **[custom]** = ObjectStack code (hook or Hono middleware) does it; **[field]** = new identity column required.

### D1 — Password policy (P1)

| Setting (`auth` ns) | Default | Enforcement seam | Mechanism |
|---|---|---|---|
| `password_require_complexity` (toggle) + `password_min_classes` (1-4: upper/lower/digit/symbol) | off | sign-up + reset/change-password path | **[custom]** validator invoked from a better-auth `before` hook on `/sign-up/email`, `/reset-password`, `/change-password`; rejects with `PASSWORD_POLICY_VIOLATION` |
| `password_reject_breached` (toggle) | off | same path | **[native]** enable better-auth `haveibeenpwned` plugin (k-anonymity HIBP range check) |
| `password_expiry_days` (number, 0 = off) | 0 | session validation | **[custom]+[field]** `sys_user.password_changed_at`; on authenticated requests, if `now - password_changed_at > expiry`, force `/change-password` (return `PASSWORD_EXPIRED`) |
| `password_history_count` (0-24) | 0 | reset/change path | **[custom]+[field]** `sys_account.previous_password_hashes` (bounded ring); reject reuse |

> better-auth gives min/max length only; complexity/expiry/history are not native. HIBP **is** native (`haveibeenpwned`) and is the highest-value, lowest-effort win — adopt it first.

### D2 — Account lockout / anti-brute-force (P1)

| Setting | Default | Seam | Mechanism |
|---|---|---|---|
| `lockout_threshold` (failed attempts, 0 = off) | 0 | `before`/`after` hook on `/sign-in/email` | **[custom]+[field]** `sys_user.failed_login_count`, `sys_user.locked_until`; increment on failure, set `locked_until = now + lockout_duration` past threshold, **reject even on correct password** while locked, reset on success |
| `lockout_duration_minutes` | 15 | as above | **[custom]** |
| `rate_limit_window_seconds` / `rate_limit_max` (per IP, auth endpoints) | 60 / 10 | better-auth core `rateLimit` | **[native]** enable + tune better-auth `rateLimit` (stricter `customRules` for `/sign-in/*`, `/sign-up/*`, `/reset-password`); use a **shared store** (not in-memory) for multi-node |

> Distinction that matters: better-auth `rateLimit` throttles **requests per IP/path** (native); **account lockout** (per-identity, survives IP rotation) is **custom** and needs the two `sys_user` fields above + an admin "unlock" action.

### D3 — Enforced multi-factor (P1)

| Setting | Default | Seam | Mechanism |
|---|---|---|---|
| `mfa_required` (global toggle) | off | post-`/sign-in` session gate | **[custom]** `twoFactor` plugin already provides TOTP + backup codes (opt-in via `sys_user.two_factor_enabled` + `sys_two_factor`). When `mfa_required`, a session for a user with `two_factor_enabled = false` is marked **un-stepped-up** and gated out of all protected resources until enrollment + verification |
| `mfa_grace_period_days` | 7 | same | **[custom]+[field]** `sys_user.mfa_required_at`; allow a grace window to enroll before hard-blocking |
| `sys_organization.require_mfa` (per-org) | — | `customSession` org resolution | **[custom]** an org may *require* MFA above the global floor |

> better-auth makes MFA *available*; making it *required* is the missing enforcement. Gate at the session-validation seam so a half-authenticated (password-only) session cannot read data.

### D4 — Session controls (P2)

| Setting | Default | Seam | Mechanism |
|---|---|---|---|
| `session_idle_timeout_minutes` (0 = off) | 0 | authenticated-request middleware | **[custom]+[field]** `sys_session.last_activity_at`; touch on each request; reject if idle beyond timeout |
| `session_absolute_max_hours` (0 = off) | 0 | refresh path | **[custom]** cap total lifetime regardless of refresh (better-auth `updateAge` only slides the window; absolute cap is custom) |
| `max_concurrent_sessions_per_user` (0 = off) | 0 | post-`/sign-in` | **[custom]** count live `sys_session` for the user; reject or evict-oldest past the cap |
| "Sign out all other sessions" | — | — | **[native]** already wired (`/revoke-other-sessions`, action on `sys_session`) — keep |
| `session_expiry_days` / `session_refresh_days` | 7 / 1 | `session.expiresIn`/`updateAge` | **[native]** existing — keep |

### D5 — Network gating / IP allowlist (P2)

| Setting | Default | Seam | Mechanism |
|---|---|---|---|
| `sys_organization.allowed_ip_ranges` (CIDR[]) | — | auth request middleware (Hono, **before** the better-auth handler in `plugin-auth` route registration) | **[custom]** extract client IP (`x-forwarded-for` / `cf-connecting-ip`, trust-proxy aware); reject login/session outside the org's ranges with `IP_NOT_ALLOWED` |
| `sys_user.allowed_ip_ranges` (optional override) | — | same | **[custom]** per-user override, evaluated before org |
| `require_ip_match` (toggle) | off | session refresh | **[custom]** detect `request IP != session.ip_address` (already captured) -> re-verify or revoke |

> IP is already captured on `sys_session.ip_address`; the only missing piece is the **gate** — a middleware seam exists in the auth route registration, before requests reach better-auth.

### D6 — Enterprise SSO (P2/P3)

| Capability | Status | Plan |
|---|---|---|
| Generic **OIDC** RP | **[native]** `genericOAuth` already supported when `oidcProviders` configured | **P2**: surface it in settings — an admin-managed **trusted OIDC provider list** (`issuer`, `client_id`, `client_secret`, `scopes`, allowed email domains for account-linking) instead of code/env-only config |
| Be an **OIDC Provider** (IdP) | **[native]** `oidcProvider` plugin | keep opt-in; out of scope to expand here |
| Social providers beyond Google | partial (Google is settings-driven; others hardcoded) | **P2**: make the provider set settings-driven via the same manifest pattern |
| **SAML 2.0** | **not in better-auth core** (no `saml` plugin in 1.6.x) | **P3**: assess `@better-auth/sso` (adds SAML in newer lines) vs a custom plugin wrapping a SAML lib; do **not** add a SAML settings surface until an enforcing implementation exists (ADR-0049) |

### D7 — Identity-object fields (prerequisite for D1-D5)

**[new fields]** — these back the enforcement and must land with (or before) the settings that read them:

- `sys_user`: `password_changed_at`, `failed_login_count`, `locked_until`, `last_login_at`, `last_login_ip`, `mfa_required_at`
- `sys_session`: `last_activity_at`, `revoked_at`, `revoke_reason`
- `sys_account`: `previous_password_hashes` (bounded)
- `sys_organization`: `require_mfa`, `allowed_ip_ranges`

Plus admin-facing surface: a `sys_user` list-view filter for locked accounts + an **Unlock** action; a "force password reset" action.

---

## Enforcement seam summary (where the code hooks)

1. **better-auth config** (`auth-manager.ts` instance creation) — native knobs: `rateLimit`, `haveibeenpwned`, `session.{expiresIn,updateAge,freshAge}`, `emailAndPassword.{min,max}PasswordLength`, `twoFactor`, `genericOAuth`.
2. **better-auth `hooks.before` / `hooks.after`** on `/sign-in/*`, `/sign-up/*`, `/reset-password`, `/change-password` — complexity/history validation, lockout counter, last-login stamping.
3. **Hono auth-route middleware** (in `plugin-auth` route registration, *before* delegating to better-auth) — IP allowlist, rate-limit pre-check.
4. **Session-validation path** (resolve-execution-context / `customSession`) — MFA step-up gate, password-expiry gate, idle-timeout, locked-account rejection.
5. **`bindAuthSettings` -> `applyConfigPatch`** — the existing channel that turns every new setting into live config without restart.

Each row in D1-D6 names exactly one of these seams. No setting is introduced without one.

---

## Phasing

- **P1 (security floor for first real customers)**: D1 (complexity + HIBP + expiry/history), D2 (lockout + rate-limit tuning), D3 (enforced MFA + grace). + D7 fields for these.
- **P2 (defense in depth)**: D4 (idle/absolute/concurrent sessions), D5 (IP allowlist), D6 OIDC trust-list UI.
- **P3 (federation breadth)**: SAML assessment, broader social providers, per-org overrides UI polish.

## Out of scope / deferred

- **SCIM / directory provisioning & bulk import** — separate ADR (provisioning, not authentication); tracked in #2246.
- **Passkeys / WebAuthn** — future (better-auth has a `passkey` direction); not P1.
- **Audit of every auth event** — partially covered by `sys_audit_log`; a dedicated security-events stream is a follow-up.

## Consequences

- **Positive**: the auth settings surface becomes defensible in an enterprise security review; every knob is real (ADR-0049 upheld); most of P1 leans on better-auth-native mechanisms (low risk).
- **Negative / risk**: custom session-gate logic (MFA step-up, idle, lockout) sits on the hot path — must be cheap and well-tested; multi-node rate-limit/lockout needs a shared store (couples to the cloud deployment story); per-org overrides add evaluation cost to `customSession`.
- **Migration**: new identity fields are additive (nullable / default-off); all new settings default to **off**, so existing environments are unchanged until an admin opts in. No behavior change on upgrade.

## Alternatives considered

- **Adopt the settings fields now, wire enforcement later** — rejected: violates ADR-0049 (false surface). Fields and their enforcement land together.
- **Outsource all of auth to an external IdP (Auth0/WorkOS)** — rejected as the default: the platform must be self-hostable and own its identity; external IdP is supported *through* D6 (OIDC), not instead of the local floor.
- **Build SAML now** — deferred: no native better-auth support in 1.6.x; building it before an enforcing implementation exists would be an ADR-0049 violation.


---

## Addendum (2026-06): SAML is now better-auth-native — premise updated

The original decision deferred SAML to "P3 / external" on the premise that **SAML is out of better-auth core (1.6.x exposes only `genericOAuth` + `oidcProvider`)**. That premise is **no longer true**: the already-installed **`@better-auth/sso@1.6.20`** (the same plugin wiring the OIDC trust list) ships **full SAML 2.0** — it bundles `samlify` + `fast-xml-parser` + `jose`, exposes `/sso/saml2/sp/metadata`, `/sso/saml2/sp/acs/:providerId`, `/sso/saml2/sp/slo/:providerId`, and registers SAML providers through the **same `/sso/register`** endpoint with a nested `samlConfig` (entryPoint, cert, callbackUrl, spMetadata, identifierFormat, …). Signature/timestamp/replay validation is handled by samlify.

Consequently SAML did **not** require a custom plugin. What shipped (D6/P3):

- A **`register_saml_provider`** action on `sys_sso_provider` (Setup → SSO Providers) collecting flat IdP fields (providerId, IdP EntityID, domain, IdP SSO URL, IdP signing cert, NameID format).
- A shared **`runRegisterSamlProviderFromForm`** bridge (sibling of the OIDC one) that reshapes the flat form into the nested `samlConfig`, derives the per-provider ACS URL (`/sso/saml2/sp/acs/<providerId>`), defaults the SP descriptor, and re-dispatches through `/sso/register` so the admin gate runs. It returns the **SP ACS + metadata URLs** to configure on the IdP.

Verified end-to-end against a test IdP: register → provider persisted with `saml_config`; SP metadata endpoint serves a valid `EntityDescriptor`/`SPSSODescriptor`; `/sign-in/sso` routes an email domain to the IdP with a valid `SAMLRequest` redirect. The IdP→ACS assertion round-trip is `@better-auth/sso` / samlify's responsibility.
