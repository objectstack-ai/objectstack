---
'@objectstack/service-settings': minor
'@objectstack/plugin-auth': minor
---

Auth: IP allow-list — network gating on the auth routes (ADR-0069 D5, P2)

Adds an `allowed_ip_ranges` auth setting (CIDR ranges or exact IPs; empty = no restriction). A Hono middleware registered ahead of the better-auth handler in the auth-route registration rejects auth requests from a client IP outside the ranges with `403 IP_NOT_ALLOWED`, before they reach better-auth.

- Client IP is read trust-proxy-aware from `x-forwarded-for` (first hop) / `cf-connecting-ip` / `x-real-ip`.
- The public render helpers (`/config`, `/bootstrap-status`) are exempt so a blocked client still gets a clean login page + a clear error.
- **Fails OPEN** when the client IP can't be determined (no proxy header), so a misconfigured proxy is a no-op rather than a lockout — an admin enabling this must ensure forwarded headers are trusted.
- IPv4 CIDR (`a.b.c.d/n`) + exact IPv4/IPv6 matching.

Default-off / additive; per ADR-0049 the setting ships with its enforcement.
