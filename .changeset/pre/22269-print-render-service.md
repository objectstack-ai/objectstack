---
'@objectstack/service-print': minor
'@objectstack/spec': patch
'@objectstack/service-storage': minor
---

feat(service-print): print a record's print page to a PDF in headless Chromium, as the requesting user, and archive it as a file attached to the record

Clause-②: yes (widening)

A new package, `@objectstack/service-print`. `PrintServicePlugin` registers the in-process `print` service (`IPrintService`): `status()` and `printRecordToFile({ app, object, recordId, page, filename? }, context)`. It adds no route, no metadata key and no error code. Compose it explicitly:

```ts
import { PrintServicePlugin } from '@objectstack/service-print';
plugins: [new PrintServicePlugin()]
```

- **One engine, headless Chromium, in one of two placements.** A local executable (`OS_PRINT_CHROMIUM_PATH`, option `chromiumPath`), or a remote browser's DevTools WebSocket endpoint (`OS_PRINT_BROWSER_ENDPOINT`, option `browserEndpoint`). Either one needs `OS_PRINT_CONSOLE_URL` (option `consoleUrl`): the console's URL as that browser reaches it, `/_console` included. Configuring both placements is refused. `playwright-core` is pinned exact on this package only.
- **Loud at startup.** `start()` probes the engine and logs its placement and Chromium version. An engine that is not configured, is misconfigured or does not answer is reported once, with the setting to fix, and `status()` says why. A remote endpoint is never logged beyond its scheme and host.
- **As the requesting user.** The page is rendered through a short-lived session minted for the caller's own principal by the auth service (`mintPrincipalSession`), and revoked in a `finally`. There is no system principal.
- **Refusals first, each with `code` and `status`, before any session is minted or browser started** (an engine that failed its last probe is re-probed only after them all): a caller that is not a human user acting for themselves (`PERMISSION_DENIED` / 403); an engine that is not ready (`SERVICE_UNAVAILABLE` / 503); an unknown page (`RESOURCE_NOT_FOUND` / 404); a page that is not the object's default record page or declares no `print` (`VALIDATION_ERROR` / 400); a record the caller cannot read (`RECORD_NOT_FOUND` / 404); an object without `enable: { files: true }` (`FILES_DISABLED` / 403).
- **The archive runs as the requesting user.** `@objectstack/service-storage`'s `file-attachments` service gains a caller-scoped face, `ICallerFileAttachmentService` (exported type), on the same slot and the same writer: `assertMayAttach(parentObject, parentId, context)` throws the insert's own refusal without writing (`PERMISSION_DENIED` / 403 when the caller may not create attachments, `ATTACHMENT_PARENT_ACCESS` / 403 when the attach rule refuses), and `attachFileAs(input, context)` writes one `sys_file` owned by the caller and one `sys_attachment` inserted under the caller's context, so every insert gate judges the caller and the row is stamped `uploaded_by` the caller. The print service asks `assertMayAttach` in its files step, before any session is minted or browser started. `attachFileAs` acts only in the caller's own organization: an `organizationId` other than the context's `tenantId` (or `null` when it names none) is refused `PERMISSION_DENIED` / 403. `attachFile` (the system verb) is unchanged.

`@objectstack/spec`'s `llms.txt` counts the new package: the workspace publishes 72 packages.
