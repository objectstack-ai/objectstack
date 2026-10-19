# @objectstack/service-print

## 18.0.0-next.5

### Patch Changes

- Updated dependencies [fa26308]
- Updated dependencies [01fafde]
- Updated dependencies [26501ae]
- Updated dependencies [94e60c0]
- Updated dependencies [adb7910]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [ff48407]
  - @objectstack/spec@18.0.0-next.5
  - @objectstack/core@18.0.0-next.5
  - @objectstack/service-storage@18.0.0-next.5
  - @objectstack/types@18.0.0-next.5

## 18.0.0-next.4

### Minor Changes

- d9a749b: Clause-②: no
  
  feat(service-print): print a record from the console — `PrintServicePlugin` mounts `POST /api/v1/print/records`, which prints the record as the signed-in caller and answers with the file it attached
  
  - **What it adds.** One HTTP route on the kernel's HTTP server, mounted at `kernel:ready` whenever the plugin is composed. Its JSON body is the in-process request, `{ app, object, recordId, page, filename? }`. The route resolves the caller with the platform's one authorization resolver, hands that caller's execution context and the request to `IPrintService.printRecordToFile`, and answers `201` with `{ fileId, attachmentId, size, filename }`. The service attaches the PDF once, as the caller; the route never attaches anything itself.
  - **How an app uses it.** Declare a `type: 'api'` action whose `target` is `/api/v1/print/records`, with `recordIdParam: 'recordId'` and the rest of the request in `bodyExtra` (`app`, `object`, `page`). The console sends the clicked record's id and those fields, and shows a refusal's message as the action's error.
  - **What the route refuses, before the service is asked:** an anonymous request (`UNAUTHENTICATED` / 401); a sign-in held by an authentication policy (`403` with the policy's own code); a request from an impersonation session (`PERMISSION_DENIED` / 403 — a print is archived in the session user's name, so it is never made for them by someone signed in as them); a query parameter, or a body field outside the request (`VALIDATION_ERROR` / 400). A permission store that cannot be read answers its own `SERVICE_UNAVAILABLE` / 503.
  - **What it relays.** Every refusal the service declares keeps its `code` and `status` (`SERVICE_UNAVAILABLE` / 503 when no print engine is configured, `VALIDATION_ERROR` / 400 for a page without `print`, `RECORD_NOT_FOUND` / 404 for a record the caller cannot read, the files and attach refusals, `TIMEOUT` / 504, the archive's own). A 4xx keeps the service's message. A 5xx answers with the route's own sentence, and the service's text goes to the server fault log.
  - **Stated limits.** The route writes no audit row of its own: a print's session sign-in and sign-out are recorded as any sign-in is, and `sys_file.owner_id` and `sys_attachment.uploaded_by` name the caller. An impersonation session is recognised by the mark the auth service writes on it (`session.impersonatedBy`, stored as `sys_session.impersonated_by`); an auth provider that marks impersonation some other way is not recognised.
  - **Unchanged:** the in-process `print` service and its refusals, every export, every plugin option and environment variable, and the error-code vocabulary. A kernel with no HTTP server mounts no route and says so once at `kernel:ready`.

### Patch Changes

- 1fee13d: **Shipped in 18.0.0-next.3**, whose CHANGELOG missed this entry; listed here one prerelease late.
  
  Clause-②: no
  
  fix(service-print): the local placement binds its browser server's control socket to `127.0.0.1` itself, instead of relying on `playwright-core`'s default host
  
  - **What changed.** With `OS_PRINT_CHROMIUM_PATH` (option `chromiumPath`), each render and each boot probe starts a Chromium browser server and connects to it. That server's control socket is now opened with `host: '127.0.0.1'`. Before, no host was passed, so the bind followed `playwright-core`'s default (`localhost`, loopback only in the pinned 1.63.0). Whoever reaches that socket and knows its path drives a browser signed in as the requesting user. How far it reaches is now set by this package, and a `playwright-core` upgrade cannot widen it without a diff here.
  - **What it means for a deployment.** Nothing changes on a host whose `localhost` is `127.0.0.1`, which is the usual case. On a host with no IPv4 loopback address, the local placement cannot open the socket. Its boot probe logs `Chromium could not be reached at the local executable …: listen EADDRNOTAVAIL …` and printing stays off. The socket is never bound to another address instead. On such a host, use the remote placement (`OS_PRINT_BROWSER_ENDPOINT`).
  - **Unchanged:** the remote placement, the port (still random), every option and environment variable, and the exports.
- b036ac5: feat(spec): `AuthSessionApi.getSession`'s result declares the fields its in-process readers read
  
  Clause-②: yes (widening)
  
  - **`@objectstack/spec/contracts` — `AuthSessionApi.getSession`'s result gains five optional members**, each declared for a named reader and typed as that reader takes it: `user.email` and `session.id` / `session.token` (read by `resolveAuthzContext`'s session arm in `@objectstack/core`), `user.authGate` as `unknown` (the ADR-0069 posture, which `normalizeAuthGate` validates against the closed posture vocabulary), and `session.impersonatedBy` as `string | null` (read by the print door's `impersonatorOf` in `@objectstack/service-print`). Before this, those reads went through `any` or a cast, so a field better-auth dropped or renamed compiled and read `undefined`. For `impersonatedBy`, that would have silently turned off the impersonation refusal. Every member is optional, so every implementer and caller typechecks unchanged.
  - **`@objectstack/core`**: `resolveAuthzContext`'s session arm reads the session through the declared type instead of `any`. `ResolveAuthzInput.getSession`'s own type is unchanged. Runtime behaviour is unchanged.
  - **`@objectstack/service-print`**: `impersonatorOf` reads `session.impersonatedBy` through the declared type instead of a cast. Runtime behaviour is unchanged.
- Updated dependencies [b2e7870]
- Updated dependencies [eebaf3b]
- Updated dependencies [194a42d]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [f5ef054]
- Updated dependencies [8d3dd6f]
- Updated dependencies [b0a1df0]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [e46ce7b]
- Updated dependencies [2ac0616]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [62e2b6d]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [31e7d0b]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [d8e11b5]
- Updated dependencies [f573976]
  - @objectstack/core@18.0.0-next.4
  - @objectstack/spec@18.0.0-next.4
  - @objectstack/service-storage@18.0.0-next.4
  - @objectstack/types@18.0.0-next.4

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
