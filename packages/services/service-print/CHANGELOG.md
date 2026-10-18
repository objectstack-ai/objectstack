# @objectstack/service-print

## 18.0.0-next.3

### Minor Changes

- b15f8a1: feat(service-print): print a record's print page to a PDF in headless Chromium, as the requesting user, and archive it as a file attached to the record
  
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

### Patch Changes

- Updated dependencies [b15f8a1]
- Updated dependencies [4216796]
- Updated dependencies [c40a0dd]
- Updated dependencies [60f9baf]
- Updated dependencies [3fed1eb]
- Updated dependencies [a35f7a6]
- Updated dependencies [f606ba2]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [ee0e115]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [0a052e6]
- Updated dependencies [ae0ca66]
- Updated dependencies [23d0bc7]
- Updated dependencies [abb6df0]
- Updated dependencies [0b1179f]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [6422da5]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [4ffdebe]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [e246f06]
- Updated dependencies [a65a59b]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [45e6001]
- Updated dependencies [9f024d8]
  - @objectstack/spec@18.0.0-next.3
  - @objectstack/service-storage@18.0.0-next.3
  - @objectstack/core@18.0.0-next.3
