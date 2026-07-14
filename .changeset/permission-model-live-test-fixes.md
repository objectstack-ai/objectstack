---
'@objectstack/plugin-security': patch
'@objectstack/plugin-hono-server': patch
---

Fix two authorization defects surfaced by ADR-0090 live testing in app-showcase:

- **plugin-security**: `computeWriteCheckFilter` now passes the caller's held
  positions into `collectRLSPolicies`, so a write-time `check` policy that
  declares a `positions` applicability domain fires for holders of those
  positions — matching the read-path (`using`) behaviour. Previously an
  owner-transfer that the check policy should reject (ADR-0058 D4) was
  silently allowed.
- **plugin-hono-server**: `resolveCtx` now delegates identity resolution to
  the shared `resolveAuthzContext` (@objectstack/core) instead of a hand-rolled
  copy that skipped `sys_user_position` / `sys_position_permission_set`.
  Position-granted capability previously never reached
  `GET /api/v1/auth/me/permissions`, so the console rendered fully read-only
  forms for users whose writes the data plane accepted.
