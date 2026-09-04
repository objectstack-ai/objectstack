---
"@objectstack/rest": patch
---

fix(rest): the by-id `/data` door stops shipping the QuickJS debug wrapper out of a declared-code structured arm (#14704)

**Response-contract change on a shipped public route**, in the direction of the
answer the other door already gives. A sandboxed hook or action body refusing a
write throws a `SandboxError` whose `.message` is the
`<kind> '<name>' threw: <msg>` **debug wrapper** written for the server log and
whose `.innerMessage` is the sentence the author addressed to the end user. The
bespoke structured arms in `classifyDataError` are surfaced ABOVE the sandbox
unwrap door on purpose — "so the structured fields survive the generic
catch-alls" — and every one of them built its sentence from `error.message`. The
unwrap door that would have read `.innerMessage` sits below them and was never
reached, so one refusal came back as two different sentences depending on the
route:

| door | answer |
|---|---|
| `sendThrownError` / `handleRouteError` (bulk, metadata, UI) | `409` — `{"error":"Opportunity is closed.","code":"DELETE_RESTRICTED"}` |
| `mapDataError` (single-record `/data`) | `409` — `{"error":"hook 'guard' threw: Error: Opportunity is closed.","code":"DELETE_RESTRICTED",…}` |

The bulk door is the reference and does not move: #11588 named
`sandboxBusinessMessage` and taught the declared-status passthrough to read it,
and #14541 declines the shared arm consult outright for a sandbox-origin error.
This is that same rule reaching the arms — **asked once**, as `armSentence`,
rather than re-opined per arm, because a third local opinion at this boundary is
how the two doors came to disagree.

**What callers see change** — only on the single-record `/data` door, and only
the human sentence. Status, `code` and every structured field are unchanged:

- `DELETE_RESTRICTED`, `CONCURRENT_UPDATE`, `ERR_DATASOURCE_UNAVAILABLE`,
  `VALIDATION_FAILED`, `FEEDS_DISABLED` / `FILES_DISABLED`,
  `ATTACHMENT_PARENT_ACCESS` / `ATTACHMENT_DELETE_DENIED`,
  `RECORD_NOT_ACCESSIBLE` and `PERMISSION_DENIED` thrown from a sandboxed body
  now answer with the author's sentence instead of the wrapper.
- `VALIDATION_FAILED` is the ordinary case: an app-authored hook writing
  `throw Object.assign(new Error('Amount must be positive'), { code: 'VALIDATION_FAILED', fields: […] })`
  answered `400 {"error":"hook 'guard' threw: Error: Amount must be positive"}`
  and now answers `400 {"error":"Amount must be positive"}`.

**Unchanged, deliberately:**

- Every non-sandbox producer. The rule is a READ of the field the sandbox
  populated, never a pattern-strip of the wrapper off `.message`, so an error
  with no `.innerMessage` relays byte for byte what it relayed before.
- Every bulk / metadata / UI route. Those reach the arms through
  `resolveErrorResponse`, which declines the consult for a sandbox-origin error.
- A sandboxed **CRASH** carrying a declared code. `sandboxBusinessMessage`
  declines a crash (#7543), so such an error still answers with the arm's status
  and the wrapper prose, where the unwrap door's terminal for the same crash is
  the sanitised `500`. Choosing between those two answers is fault
  classification rather than message sourcing; it is pinned as a named
  divergence and carried as its own decision card.
- The `DUPLICATE_RECORD` arm. It is gated on the engine's envelope class
  (`name === 'DuplicateRecordError'`) and `SandboxError` sets `name`
  unconditionally, so no sandboxed producer reaches it; converging its GATE
  would change the wire for two producer populations and reverse #14389 §5.
