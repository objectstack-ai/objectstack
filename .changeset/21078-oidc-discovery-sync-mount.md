---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the OIDC discovery documents answer on every boot, including one whose first request arrives before the auth instance is built

Clause-②: no

- `GET /.well-known/openid-configuration` and `GET /.well-known/oauth-authorization-server` used to be mounted only after the better-auth instance finished building, in the background. When the server answered any request before that (a readiness probe, for example), the router was already sealed. The late mount failed, the failure was logged, and both documents answered 404 until the process restarted. The RFC 8414 path-inserted alias and the two RFC 9728 protected-resource documents had the same problem.
- All five routes are now mounted while the auth routes are registered, before the server opens its socket. Each request waits for the auth instance and then serves the document. A route that cannot be mounted now fails the boot instead of being logged and skipped.
- When the OIDC provider plugin is degraded, these paths answer as they did before, as if they were not mounted. A boot-time error line still reports this.
- If the auth instance cannot be built, a discovery request answers a server error, and the next request tries the build again. Before, these paths kept answering 404.
