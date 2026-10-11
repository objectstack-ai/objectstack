---
'@objectstack/rest': patch
---

fix(rest): twenty more REST write routes answer a sandboxed hook's refusal in the hook's own words (#22719)

Clause-②: no

**What was wrong.** When a sandboxed hook refuses a write (`throw new Error('Locked rows cannot be changed here.')`), the error that reaches the route carries the QuickJS debug wrapper on `.message` (`hook 'guard' threw: Error: …`) and the sentence on `.innerMessage`. Twenty write routes built their error answer by hand from `.message`, so they shipped the wrapper, while the other write doors answer the sentence. Sixteen of them also answered the refusal as a server fault (`500`).

**What changes on the wire, for a sandboxed hook's refusal.**

| routes | before | after |
| --- | --- | --- |
| `POST /sharing/rules`, `DELETE /sharing/rules/:idOrName`, `POST /sharing/rules/:idOrName/evaluate` | `500 RULE_*_FAILED`, flat `{ code, error }`, the wrapper | `400 VALIDATION_ERROR`, nested `{ success: false, error: { code, message } }`, the sentence |
| `POST /security/suggested-bindings/:id/confirm` and `/dismiss`, `POST /security/permission-sets/:id/discard-overlay` | `500 SUGGESTION_*_FAILED` / `500 INTERNAL`, the wrapper | `400 VALIDATION_ERROR`, same nested `{ error: { code, message } }` shape, the sentence |
| the nine `POST /approvals/requests/:id/*` writes (`approve`, `reject`, `recall`, `revise`, `resubmit`, `reassign`, `remind`, `request-info`, `comment`) | `500 APPROVAL_*_FAILED`, flat `{ code, error }`, the wrapper | `400 VALIDATION_ERROR`, nested, the sentence |
| `POST /packages/publish` | `500 INTERNAL_ERROR`, the wrapper | `400 VALIDATION_ERROR`, the sentence |
| `POST /datasources/:name/external/tables/:remote/draft` and `/import`, `/external/refresh-catalog`, `/external/validate` | `400 EXTERNAL_DATASOURCE_ERROR` / `400 EXTERNAL_IMPORT_ERROR`, the wrapper | the same status and code, the sentence |

A refusal that declares its own `code` keeps it (an unregistered spelling rides `declaredCode`), a refusal that declares its own `status` is answered at that status, and a `userMessage` the hook set rides the answer, as on every other write door.

**Also moved, on the sharing-rule, suggested-binding and approval routes.** These routes now ask the same classification as the `/data` door before their `500` arm. So a refusal from the service that declares its own `status` (or `statusCode`) and `code`, and that no route-specific arm reads, is answered at that status, in the nested envelope, instead of `500` with the route's own code. The external-datasource routes keep answering every refusal at `400` with their own code, and `POST /packages/publish` already answered a declared status.

**Unchanged.** A plain fault keeps each route's own `500` answer and code. The route-specific refusals (`VALIDATION_FAILED`, `PERMISSION_DENIED`, `RULE_NOT_FOUND`, `SHARING_NOT_ENABLED`, the approval prefixes, the typed security errors) answer exactly as before.

**Upgrading.** A client that reads both envelopes, as `@objectstack/client` does, needs no change. A client of the sharing-rule or approval routes that reads a string `body.error` reads `body.error.message` for these answers.
