---
'@objectstack/runtime': minor
'@objectstack/core': minor
---

feat(runtime,core): inbound automation hooks work on a kernel with no raw HTTP app — the dispatcher admits `POST /automation/hooks/:flowName/:hookId` with no session, through to the trigger's own signature check

Clause-②: yes

On a self-hosted server, `@objectstack/trigger-api` serves a flow's inbound hook by mounting `POST /api/v1/automation/hooks/:flowName/:hookId` on the raw Hono app, where a third-party sender (a payment provider, a code host) posts a signed event with no session. A hosted tenant kernel has no raw app, so on that shape the path belonged to the dispatcher's `/automation` domain, whose anonymous floor refused every sender `401 UNAUTHENTICATED`.

**What widens: one route passes the anonymous floor and the ADR-0069 gate with no session.** `@objectstack/core`'s auth-gate allow-list gains its first parameterised row: exactly `POST /automation/hooks/:flowName/:hookId` in the dispatcher's spelling (four segments, optionally under one `/environments/:id` scope), and nothing else. `/automation/hooks`, `/automation/hooks/x`, `/automation/hooks/x/y/z`, every other method on the route and every other `/automation` path stay gated exactly as before.

- `@objectstack/core`: `isAuthGateAllowlisted(path, method?)` and `evaluateAuthGate(user, path, method?)` take an optional method. The existing rows are exempt for every method, as before, so a caller that passes no method gets the answer it always got. The new row is exempt for `POST` only, and only when a method is passed. `shouldDenyAnonymous` now passes its `method` to the allow-list beside its `path`. New export: `matchInboundHookRoute(path, method)`, the one reading of the route that the row matches through, returning the two path segments raw.
- `@objectstack/runtime`: the `/automation` domain's anonymous floor now asks the allow-list with its path and method. On the very next statement it hands the admitted route to the request kernel's `trigger-api` service (`ITriggerApiService.handleInboundHook`), ahead of every other `/automation` gate and service probe. The request goes with its body unread and the two path parameters decoded, and the service's `Response` comes back as it is. The service verifies the HMAC signature, so a correctly signed post is accepted and a wrongly signed or unsigned one is refused by that service, with its own answer. The membership gate skips the route for `POST` only, so a signed-in caller is judged exactly as an anonymous one, as on the self-hosted mount.
- No `trigger-api` service registered, or one without `handleInboundHook`: `501 NOT_IMPLEMENTED`, naming which, never `ROUTE_NOT_FOUND`. A service that throws, or a request whose body a transport already read: a sanitised `500 INTERNAL_ERROR`, logged.

Nothing changes on a self-hosted server: the trigger's raw-app mount still serves the path there and never reaches the dispatcher, and the dispatcher mounts nothing that answers it.
