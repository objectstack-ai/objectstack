---
'@objectstack/plugin-auth': patch
'@objectstack/cli': patch
---

Clause-②: no
Metadata-protocol: none

fix(plugin-auth): a configured `http://localhost` base URL is kept as written.

On `kernel:ready` AuthPlugin used to rewrite any configured `http://localhost…` origin to `http://localhost:<bound port>`. Behind a proxy (`OS_AUTH_URL=http://localhost`, app listening on :3000) invite links, invitation mail and the sign-in / reset URLs in auth mail then pointed at a port nobody published. The port correction now applies only when no base URL was configured: no `baseUrl` option, or one the host filled from its own loopback fallback. `os serve` marks that case with the new `baseUrlDefaulted` option (set when none of `OS_AUTH_URL`, `BETTER_AUTH_URL` or `OS_BASE_URL` is set). An explicit `OS_AUTH_URL`, `OS_BASE_URL` or `baseUrl` is the public origin and is honoured as documented; a dev server with nothing configured is still corrected to the port it bound. Trusted-origins resolution is unchanged.
