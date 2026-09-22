---
"@objectstack/plugin-auth": minor
---

MCP OAuth is eligible over plain HTTP when the deployment's own host is loopback **or a private / link-local address** — RFC 1918 `10/8`, `172.16/12`, `192.168/16`; RFC 4193 `fc00::/7`; `169.254/16`, `fe80::/10`. A **public** host keeps TLS-required and fail-closed, exactly as before (#19489).

Clause-②: no

Shape ruled by the maintainer (2026-09-21), with the semantics of Keycloak's `sslRequired=external`: 「要(开发模式)」 and 「19342 同意兼容」. Reasoning of record — a deployment that already serves its login form and session cookies over plain HTTP gains nothing from OAuth refusing plain HTTP; the refusal only removes MCP from that deployment. An intranet install and a developer's `os dev` bound to a LAN address are the same case, so development mode is **subsumed** and there is no separate dev-mode branch.

- **⛔ No configuration key and ⛔ no environment variable.** A switch would be reachable on a public host, which is exactly the deployment this rule must keep refusing. `OS_ALLOW_INSECURE_OAUTH_HTTP` is not introduced in any form.
- **The public arm is unchanged.** `http://example.com` and `http://203.0.113.5` are refused as before; the MCP endpoint stays API-key-only and no OAuth metadata is advertised. Addresses that merely look private are refused with it: `172.15.x` / `172.32.x` fall outside RFC 1918, `fec0::/10` site-local (RFC 3879) falls outside `fc00::/7`, and a hostname that only begins with a private IPv4 string (`10.0.0.5.evil.com`) is a name, not an address.
- **A non-IP hostname over plain HTTP stays refused**, deliberately: the rule judges the host **literal** of the deployment's own canonical origin. `crm.corp` and `host.docker.internal` are not IP literals, so configure the base URL on the private address the deployment already binds (`http://192.168.1.10:3000`). Resolving the name in DNS was rejected — it makes a synchronous predicate depend on a round trip whose answer can be rebound — and judging the requester's peer address, which is what Keycloak does, was rejected because it cannot decide what a deployment **advertises** at mount time and because a plain-HTTP reverse proxy on a public address makes every requester look internal.
- **One loud startup line** on every plain-HTTP deployment the rule ACCEPTS: 「OAuth 未加密:仅限可信内网」, followed by the issuer URL and what crosses the wire in the clear. None under TLS — and none on a public plain-HTTP deployment either, whose OAuth track this same rule leaves dark: that line would assert a transport this deployment was refused, so its line stays the separate `OAuth track is NOT live` warning.

Nothing an author writes changes: `isOAuthEligibleBaseUrl` keeps its signature, no export is added or removed, and no published payload gains a key. A deployment on a public host sees no behaviour change at all.
