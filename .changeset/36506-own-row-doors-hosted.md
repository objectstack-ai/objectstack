---
'@objectstack/spec': patch
'@objectstack/runtime': patch
'@objectstack/plugin-auth': patch
'@objectstack/service-storage': patch
'@objectstack/plugin-hono-server': patch
---

fix(hosted): deleting a personal view and removing or renaming an attachment work on a kernel with no `http.server` (a hosted tenant kernel) instead of answering 404

Clause-②: yes (widening)
Metadata-protocol: none

`DELETE /api/v1/personal-views/:id` (plugin-auth) and `DELETE` / `PATCH /api/v1/attachments/:id` (service-storage) were mounted only on the kernel's `http.server`. A hosted tenant kernel owns no socket and registers no `http.server` (and runs `AuthPlugin` with `registerRoutes: false`), so the host's `createHonoApp` catch-all handed each request to the runtime dispatcher, which had no domain for them and answered `404 ROUTE_NOT_FOUND`: a member could not delete a personal view, or remove or rename an attachment, there.

- `@objectstack/spec/contracts` declares `IPersonalViewDoorsService` (one optional, transport-neutral member, `handlePersonalViewDoor(request: Request): Promise<Response>`) and types the new `personal-views` service slot with it, and declares `IAttachmentDoorsService` (`handleAttachmentDoor`), which the existing `file-attachments` service implements beside `IFileAttachmentService`. A service without the member still satisfies either contract.
- `AuthPlugin` registers the `personal-views` service in `init()`, whatever `registerRoutes` says, and `StorageServicePlugin`'s `file-attachments` service gains `handleAttachmentDoor`. Each member runs the same registration over the same dependencies the `http.server` mount runs, on a private route table that never listens, so every answer is the mount's own. The `http.server` mounts are unchanged, and no path is mounted twice. The `personal-views` service name is now taken: a composition that registers its own `personal-views` service alongside `AuthPlugin` fails to boot with a duplicate-service error. `@objectstack/service-storage` now depends on `@objectstack/plugin-hono-server` at runtime (the private table is a `HonoHttpServer`).
- `@objectstack/plugin-hono-server` exports `createDoorTableMember(routes, mount)`, the private never-listening table both members are built on, and `matchDoorTableRoute`.
- The runtime dispatcher gains `/personal-views` and `/attachments` domains that claim exactly the door shapes and forward the request, body unread, to the REQUEST kernel's member (never the host kernel's scoped fallback). Every other shape under those prefixes keeps the dispatcher's `404 ROUTE_NOT_FOUND`. With no slot, or one without the member, the doors answer `501 NOT_IMPLEMENTED` naming the package that registers it. The doors stay behind the dispatcher's authentication and project-membership gates.
