---
'@objectstack/plugin-auth': patch
'@objectstack/hono': patch
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

feat(plugin-auth): `auth.handleRequest` answers the plugin's whole `/api/v1/auth/*` surface

Clause-②: yes
Metadata-protocol: none

`AuthPlugin` now runs its auth route registration twice: on the composed HTTP server's app, as before (`registerRoutes`), and once more in `init()` on a private route table it binds to the `auth` service. `AuthManager.handleRequest` answers every request under `basePath` through that table, so a host that forwards its auth path to the service (a multi-tenant host, the `@objectstack/hono` embed, the dispatcher's `/auth` domain) serves exactly the routes the self-hosted mount serves. Both tables come from one registration function, and the private one leaves out only the root-path discovery documents, which a host serves itself. Self-hosted deployments serve the same routes in the same order.

What a host that forwards to `handleRequest` gets:

- Every objectstack-mount route: `/config`, `/bootstrap-status`, the `/admin/*` doors, `/authorized-clients`, the service-account doors and the rest of the `objectstack` rows in the route ledger, where it used to get better-auth's 404.
- The mount-layer checks, for every host: the ADR-0069 D5 IP allow-list, the agent forward credential (ADR-0090 D10), the organization IP list at the mount, the one-account-per-request rule and the platform-admin wrappers. They judge the client address by the platform's trust rule, from the transport it passes: `handleRequest(request, { remoteAddress })`. The `@objectstack/hono` embed now passes the peer `@hono/node-server` reports, and the dispatcher's `/auth` domain passes the request's `remoteAddress`.
- Errors from the auth surface reach the host as a rejection of `handleRequest`; the host turns them into its own error body.
- The mobile sign-in hand-off answers a signed-out page navigation with 401: the private table declares that it serves no sign-in page (`OneTimeTokenHandoffServing.server` accepts `null` for that).

Also:

- A route's internal failure is answered with a generic message (`Internal server error`); the error itself goes to the server log. This holds on the self-hosted mount too.
- `AuthManager.handleVendorRequest` is better-auth's handler alone, the entry every in-process re-dispatch uses, and `AuthManager.ownsVendorRoute` asks better-auth's router alone. `AuthManager.ownsRoute` also answers `true` for a route the plugin mounts itself, judged by method and path, so a host that yields a disclaimed 404 keeps an objectstack route's own 404.
- A manager with no bound table (constructed on its own), and any path outside `basePath`, still go straight to better-auth.
- `hono` moves from `devDependencies` to `dependencies` of `@objectstack/plugin-auth`.
- `IAuthService.handleRequest`'s description now says an implementation answers its whole auth route surface there. Its shape is unchanged.
