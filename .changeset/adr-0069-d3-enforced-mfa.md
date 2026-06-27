---
'@objectstack/platform-objects': minor
'@objectstack/service-settings': minor
'@objectstack/plugin-auth': minor
---

Auth: enforced MFA (ADR-0069 D3, P1)

Completes the session-validation gate: when `mfa_required` (new `auth` setting) is on, an authenticated user without TOTP enrolled is blocked from protected resources with `403 MFA_REQUIRED` once their `mfa_grace_period_days` (default 7) window elapses — while the two-factor enrollment endpoints stay reachable so they can comply. Reuses the `authGate` seam shipped in #2388 (a second posture branch in `computeAuthGate`).

- New `auth` settings `mfa_required` (toggle) + `mfa_grace_period_days`; enabling `mfa_required` also force-enables the `twoFactor` plugin so `/two-factor/*` enrollment exists.
- New `sys_user.mfa_required_at` column — the grace clock, stamped lazily the first time a user is seen required-but-unenrolled.
- `isAuthGateActive()` now also trips on `mfa_required` (still zero-overhead when off).

Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

**Needs an objectui follow-up**: the Console should handle a `403 MFA_REQUIRED` by showing the TOTP-enrollment prompt. Per-org `sys_organization.require_mfa` and the dispatcher/MCP gate remain follow-ups (#2375).
