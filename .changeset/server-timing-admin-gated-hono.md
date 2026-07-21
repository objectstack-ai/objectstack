---
"@objectstack/observability": patch
"@objectstack/rest": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/runtime": patch
---

fix(server-timing): emit the per-request, admin-gated `Server-Timing` header on the standard server (`os serve`/`dev`) (#3361)

The per-request `Server-Timing` path (#2408) — where an admin sends
`X-OS-Debug-Timing: 1` (or `json`) and gets phase timings while an ordinary user
gets nothing — never emitted on the shipped Hono server. The disclosure gate the
Hono middleware opens is only ever flipped by the runtime dispatcher's
`timedResolveExecutionContext`, but the data (`/api/v1/data/*`) and metadata
(`/api/v1/meta/*`) routes on `os serve`/`dev` are served by `@objectstack/rest`'s
`RestServer` (which shadows the Hono plugin's own CRUD), and its identity
resolver never opened the gate. Only global mode (`OS_SERVER_TIMING=true`) — which
discloses to *every* caller, not just admins — worked.

- **observability**: the disclosure predicate `isPerfDisclosurePrincipal(ec)` now
  lives here (the home of the gate), the single definition of "who may pull
  per-request timings" shared by every HTTP entry point. `@objectstack/runtime`
  re-exports it for back-compat.
- **rest**: `RestServer.resolveExecCtx` opens the gate for an admin/service
  principal (via the carried `posture` rung), the REST-server analog of the
  dispatcher — this is the fix that makes `os serve`/`dev` emit.
- **plugin-hono-server**: the standalone CRUD surface's self-contained
  `resolveCtx` opens the gate too (deriving the rung for the gate decision only,
  never writing it onto the enforcement context). Adds an e2e test that boots the
  Hono app and asserts an admin gets `Server-Timing` while a member/anon does not.
