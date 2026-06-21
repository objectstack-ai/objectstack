---
"@objectstack/plugin-hono-server": minor
---

Expose resolved regional defaults to every authenticated user.

Adds `GET /api/v1/auth/me/localization` returning the request tenant's resolved
`{ currency, locale, timezone }` from the ExecutionContext (ADR-0053). The
`localization` SETTINGS are gated to `setup.access`, but the resolved defaults
are needed by every renderer to format currency/dates/numbers — so they are
surfaced here without that gate. Enables a client to format a currency field
in the tenant's default currency when the field omits its own.
