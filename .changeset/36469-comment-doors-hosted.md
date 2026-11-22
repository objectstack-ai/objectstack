---
'@objectstack/spec': patch
'@objectstack/runtime': patch
'@objectstack/plugin-audit': patch
---

fix(comments): unreact, resolve and own-comment delete work on a kernel with no `http.server` (a hosted tenant kernel) instead of answering 404

Clause-②: yes (widening)
Metadata-protocol: none

The three comment doors, `DELETE /api/v1/comments/reactions/:id`, `PUT /api/v1/comments/:id/resolution` and `DELETE /api/v1/comments/:id`, were mounted by `AuditPlugin` only on the kernel's `http.server`. A hosted tenant kernel owns no socket and registers no `http.server`, so the host's `createHonoApp` catch-all handed each of them to the runtime dispatcher, which had no domain for them and answered `404 ROUTE_NOT_FOUND`, and removing a reaction, resolving or reopening a thread and deleting your own comment failed there.

- `@objectstack/spec/contracts` declares `ICommentDoorsService` with one optional, transport-neutral member, `handleCommentDoor(request: Request): Promise<Response>`, and types the `comments` service slot with it (`ServiceSlotContracts.comments`). A service without the member still satisfies the contract.
- `AuditPlugin` registers the `comments` service with that member. It runs the same registrars over the same dependencies the `http.server` mount runs, on a private route table that never listens, so every answer is the mount's own. The `http.server` mount is unchanged, and no path is mounted twice. `@objectstack/plugin-audit` now depends on `@objectstack/plugin-hono-server` at runtime (the private table is a `HonoHttpServer`), and the `comments` service name is now taken: a composition that registers its own `comments` service alongside `AuditPlugin` fails to boot with a duplicate-service error.
- The runtime dispatcher gains a `/comments` domain that claims exactly the three method and path shapes and forwards the request, body unread, to the request kernel's `comments` service. Every other `/comments` shape keeps the dispatcher's `404 ROUTE_NOT_FOUND`. With no `comments` service, or one without `handleCommentDoor`, the doors answer `501 NOT_IMPLEMENTED` naming `@objectstack/plugin-audit`. The doors stay behind the dispatcher's authentication and project-membership gates.
