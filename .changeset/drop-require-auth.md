---
"@objectstack/spec": major
"@objectstack/rest": major
"@objectstack/runtime": major
"@objectstack/core": minor
"@objectstack/cli": minor
"@objectstack/plugin-hono-server": minor
"@objectstack/plugin-dev": minor
---

feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

`api.requireAuth: false` let a deployment open its ENTIRE data plane with one
config key. It is removed. Auth is a kernel concern, not a deployment posture:
anonymous callers are denied on every HTTP surface that reaches object data,
unconditionally.

Every surface that legitimately serves a session-less caller already derives its
own narrow authorization from a DECLARATION, so none of them needed the global
switch:

- control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
  remediation) — the auth-gate allowlist;
- public form submission — `publicFormGrant` (ADR-0056 Option A);
- share links — the capability token, validated then read as SYSTEM;
- a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
- MCP — an OAuth token or API key.

**Breaking changes.**

- `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
  `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
  a fix-it message rather than being silently stripped (the ADR-0104 / #3733
  quiet-failure this whole line of work has been closing). `os migrate meta`
  drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
- `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
  input; it denies any anonymous, non-system caller outside the control-plane
  allowlist.
- A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
  data API (`objectstack serve`, plugin-dev), instead of getting an explicit
  fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
  API. There is no anonymous-data carve-out any more — publishing a public
  surface is done by declaration (see above).

**Migration.** Delete `api.requireAuth` from the stack config (or run
`os migrate meta`). If you were serving data publicly with `requireAuth: false`,
replace it with the declaration that fits: a public form view, a share link, or
`book.audience: 'public'`. If you have an auth-less stack that intentionally
served data, it must now mount auth or stop serving the data API.
