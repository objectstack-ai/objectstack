---
'@objectstack/spec': patch
'@objectstack/service-print': patch
'@objectstack/runtime': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(hosted): printing a record works on a kernel with no `http.server` (a hosted tenant kernel), and an api action whose service is absent shows a readable, localized line instead of the route text

Clause-②: yes (widening)
Metadata-protocol: none

`POST /api/v1/print/records` (service-print) was mounted only on the kernel's `http.server`. A hosted tenant kernel owns no socket and registers no `http.server`, so the host's `createHonoApp` catch-all, and the `/actions` door's in-process forward of a `type: 'api'` action, handed the request to the runtime dispatcher, which had no domain for it and answered `404 ROUTE_NOT_FOUND`. A hosted HotCRM's Print Quote showed its user `Route Not Found: /print/records`.

- `@objectstack/spec/contracts` declares `IPrintDoorService` (one optional, transport-neutral member, `handlePrintDoor(request: Request): Promise<Response>`). A service without the member still satisfies it.
- `PrintServicePlugin`'s `print` service gains `handlePrintDoor`, which runs the same registration the `http.server` mount runs, on a private route table that never listens (`createDoorTableMember`), so every answer is the mount's own. The `http.server` mount is unchanged, and no path is mounted twice. `@objectstack/service-print` now depends on `@objectstack/plugin-hono-server` at runtime.
- The runtime dispatcher gains a `/print` domain that claims exactly `POST /print/records` and forwards the request, body unread, to the REQUEST kernel's member (never the host kernel's scoped fallback). Every other shape under `/print` keeps the dispatcher's `404 ROUTE_NOT_FOUND`. With no `print` slot, or one without the member, the door answers `501 NOT_IMPLEMENTED` naming `@objectstack/service-print`. The door stays behind the dispatcher's authentication and project-membership gates.
- The console shows a `type: 'api'` action's refusal whose code says the service behind its target is absent (`SERVICE_UNAVAILABLE`, `NOT_IMPLEMENTED`, `ROUTE_NOT_FOUND`, `ENDPOINT_NOT_FOUND`) as the new `actions.serviceUnavailable` line in the user's language (zh-CN: 「此操作所需的服务在当前环境未启用，请联系管理员。」) instead of the server's operator text. A producer-marked `userMessage` still wins.
