---
'@objectstack/runtime': patch
'@objectstack/hono': patch
---

fix(runtime,hono): approval e-mail links work on a kernel with no raw HTTP app — the dispatcher serves `/approvals/act`, and the Hono catch-all no longer consumes request bodies

Clause-②: no

On a self-hosted server, `@objectstack/plugin-approvals` serves the ADR-0043 action page (the approve / reject link in an approval e-mail or IM message) by mounting `GET` and `POST /api/v1/approvals/act` on the raw Hono app. A hosted tenant kernel has no raw app, so on that shape the path answered `404 ROUTE_NOT_FOUND` and every action link was dead.

**`@objectstack/runtime`.** `HttpDispatcher` now serves exactly `/approvals/act` (no sub-paths) for `GET`, `HEAD` and `POST`. It forwards the request, unread, to the request kernel's `approvals` service (`IApprovalService.handleActionPage`) and returns that `Response` as it is.

- `HEAD` answers as the self-hosted mount does: the `GET` page's status and headers, with no body. It renders and never decides.
- No `approvals` service registered, or one without `handleActionPage`: `501 NOT_IMPLEMENTED`, naming which. Never `ROUTE_NOT_FOUND`.
- A member that throws: a sanitised `500 INTERNAL_ERROR`, with the original error in the server log. The same answer, logged, when a transport hands over a `POST` whose body was already read, instead of an "invalid link" page for a live link.
- The token is the only credential, as on the self-hosted mount. The project-membership gate now skips the exact act path (unscoped or `/environments/:id`-scoped), so a signed-in caller who is not a member of the environment reaches the page like an anonymous one instead of getting `403 PROJECT_MEMBERSHIP_REQUIRED`. Every other path, `/approvals/act/...` and `/approvals/requests/...` included, is checked as before.

**`@objectstack/hono`.** The `createHonoApp` catch-all (and the `/auth/*` fallback) read the JSON body with `c.req.json()`, which consumed the raw request for every `Content-Type`. A domain that forwarded the request got it empty. The body is now parsed from a clone, so `context.request` reaches the dispatcher unread, byte for byte. The parsed `body` the domains receive is unchanged for every input: JSON values as parsed, and `{}` for an empty, form, text or invalid body. The cost is that a request body is buffered twice for the life of the request.

Nothing changes on a self-hosted server: the plugin's raw-app mount still serves the path there and never reaches the dispatcher.
