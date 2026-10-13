---
'@objectstack/rest': patch
---

fix(rest): the hand-built REST write routes answer a sandboxed hook that crashed, or that declared a server error, as the data routes do (#22764)

Clause-②: no

**What was wrong.** Two kinds of sandboxed hook failure reach a route as faults, not refusals. One is a hook body that crashed (`ctx.input.title.trim()` on a number): the route receives the QuickJS debug wrapper on `.message`, for example `hook 'guard' threw: TypeError: boom`. The other is a hook that declared a server-band status (`status: 503`). The `/data` routes answer both as faults and withhold the text: a crash answers `500 INTERNAL_ERROR` with `Internal server error`, and a declared `503` answers `503` with its own code and `Internal server error`. The routes below build their error answer by hand, and they sent the wrapper and the native error text to the caller. The four external-datasource routes also answered a crash as `400`, the caller's mistake.

**What changes on the wire, for those two failures only.**

| routes | before | after |
| --- | --- | --- |
| `POST /sharing/rules`, `DELETE /sharing/rules/:idOrName`, `POST /sharing/rules/:idOrName/evaluate` | `500 RULE_*_FAILED`, flat `{ code, error }`, the wrapper | the `/data` answer, nested `{ success: false, error: { code, message } }` |
| `POST /security/suggested-bindings/:id/confirm` and `/dismiss` | `500 SUGGESTION_*_FAILED`, the wrapper | the `/data` answer, `{ error: { code, message } }` |
| the nine `POST /approvals/requests/:id/*` writes (`approve`, `reject`, `recall`, `revise`, `resubmit`, `reassign`, `remind`, `request-info`, `comment`) | `500 APPROVAL_*_FAILED`, flat `{ code, error }`, the wrapper | the `/data` answer, nested |
| `POST /packages/publish` | a crash: `500 INTERNAL_ERROR` with the wrapper; a declared `503`: `503` with the hook's sentence | the `/data` answer |
| `POST /datasources/:name/external/tables/:remote/draft` and `/import`, `/external/refresh-catalog`, `/external/validate` | `400 EXTERNAL_DATASOURCE_ERROR` / `400 EXTERNAL_IMPORT_ERROR`, the wrapper for a crash, the sentence for a declared `503` | the `/data` answer, nested |
| `POST /security/explain` | `500 EXPLAIN_FAILED`, the wrapper | the `/data` answer, nested |
| `POST /analytics/dataset/query`, a crash only (a declared 5xx already answered as `/data` does) | `500 ANALYTICS_QUERY_FAILED`, the wrapper | the `/data` answer, in this route's flat `{ code, error }` |

"The `/data` answer" is `500 INTERNAL_ERROR` with `Internal server error` for a crash, whatever status it declared. For a refusal that declared a 5xx, it is that status, the declared code and `Internal server error`. The prose is released only when the hook marked the declaration a refusal, and a `userMessage` the hook set rides the answer. The withheld text goes to the server log. The answer is computed by the same classification the `/data` routes use, so it cannot drift from theirs.

The same arms serve the read routes of the sharing-rule, suggested-binding and external-datasource families (`GET /sharing/rules`, `GET /sharing/rules/:idOrName`, `GET /security/suggested-bindings`, `GET /datasources/:name/external/tables`), so they answer these two failures the same way.

**Unchanged.** A hook's refusal keeps its sentence and status on every route. A refusal that declared a 4xx on the external-datasource routes still answers `400` with that family's code. A fault that is not from a sandboxed hook keeps each route's own answer and code. A service-declared `503` on `POST /packages/publish` is one such fault. The per-record share routes already withheld the text at their own `500 SHARE_*_FAILED` and are unchanged.

**Upgrading.** Nothing to change. A client that branched on `RULE_*_FAILED`, `APPROVAL_*_FAILED`, `SUGGESTION_*_FAILED`, `EXPLAIN_FAILED`, `ANALYTICS_QUERY_FAILED` or a `400` from an external-datasource route to detect a broken hook reads `INTERNAL_ERROR` (or the declared 5xx code) instead. Those codes still answer every other fault.
