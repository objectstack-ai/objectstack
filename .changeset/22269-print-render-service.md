---
'@objectstack/service-print': minor
'@objectstack/spec': patch
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
- **Refusals first, each with `code` and `status`, before any session is minted or browser started:** a caller that is not a human user acting for themselves (`PERMISSION_DENIED` / 403); an engine that is not ready (`SERVICE_UNAVAILABLE` / 503); an unknown page (`RESOURCE_NOT_FOUND` / 404); a page that is not the object's default record page or declares no `print` (`VALIDATION_ERROR` / 400); a record the caller cannot read (`RECORD_NOT_FOUND` / 404); an object without `enable: { files: true }` (`FILES_DISABLED` / 403).
- **The archive** goes through `file-attachments` (`IFileAttachmentService.attachFile`): one `sys_file` and one `sys_attachment` on the record, under its size limit and organization wall.

`@objectstack/spec`'s `llms.txt` counts the new package: the workspace publishes 72 packages.
