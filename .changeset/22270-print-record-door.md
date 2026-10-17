---
'@objectstack/service-print': minor
---

Clause-②: no

feat(service-print): print a record from the console — `PrintServicePlugin` mounts `POST /api/v1/print/records`, which prints the record as the signed-in caller and answers with the file it attached

- **What it adds.** One HTTP route on the kernel's HTTP server, mounted at `kernel:ready` whenever the plugin is composed. Its JSON body is the in-process request, `{ app, object, recordId, page, filename? }`. The route resolves the caller with the platform's one authorization resolver, hands that caller's execution context and the request to `IPrintService.printRecordToFile`, and answers `201` with `{ fileId, attachmentId, size, filename }`. The service attaches the PDF once, as the caller; the route never attaches anything itself.
- **How an app uses it.** Declare a `type: 'api'` action whose `target` is `/api/v1/print/records`, with `recordIdParam: 'recordId'` and the rest of the request in `bodyExtra` (`app`, `object`, `page`). The console sends the clicked record's id and those fields, and shows a refusal's message as the action's error.
- **What the route refuses, before the service is asked:** an anonymous request (`UNAUTHENTICATED` / 401); a sign-in held by an authentication policy (`403` with the policy's own code); a request from an impersonation session (`PERMISSION_DENIED` / 403 — a print is archived in the session user's name, so it is never made for them by someone signed in as them); a query parameter, or a body field outside the request (`VALIDATION_ERROR` / 400). A permission store that cannot be read answers its own `SERVICE_UNAVAILABLE` / 503.
- **What it relays.** Every refusal the service declares keeps its `code` and `status` (`SERVICE_UNAVAILABLE` / 503 when no print engine is configured, `VALIDATION_ERROR` / 400 for a page without `print`, `RECORD_NOT_FOUND` / 404 for a record the caller cannot read, the files and attach refusals, `TIMEOUT` / 504, the archive's own). A 4xx keeps the service's message. A 5xx answers with the route's own sentence, and the service's text goes to the server fault log.
- **Stated limits.** The route writes no audit row of its own: a print's session sign-in and sign-out are recorded as any sign-in is, and `sys_file.owner_id` and `sys_attachment.uploaded_by` name the caller. An impersonation session is recognised by the mark the auth service writes on it (`session.impersonatedBy`, stored as `sys_session.impersonated_by`); an auth provider that marks impersonation some other way is not recognised.
- **Unchanged:** the in-process `print` service and its refusals, every export, every plugin option and environment variable, and the error-code vocabulary. A kernel with no HTTP server mounts no route and says so once at `kernel:ready`.
