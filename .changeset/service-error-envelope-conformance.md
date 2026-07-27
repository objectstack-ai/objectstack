---
"@objectstack/service-storage": patch
"@objectstack/service-i18n": patch
---

fix(service-storage,service-i18n): emit the declared error envelope, not a bare `{ error }` (#3675)

#3636 aligned the **success** bodies of the autonomously-mounted service
routes because those were the ones breaking `ObjectStackClient.unwrapResponse`.
The error bodies were left alone and stayed a bare `{ error: '<message>' }` —
with the code, where one existed at all, as a *sibling* of `error` rather than
a field of it — against a contract (`BaseResponseSchema` + `ApiErrorSchema`)
that declares `{ success: false, error: { code, message } }`.

So the same SDK method returned two different error shapes depending on which
provider mounted the route: a caller reading `body.error.message` got the real
message from the dispatcher and `undefined` from these services. All 32 sites
(27 in `storage-routes.ts`, 5 in `i18n-service-plugin.ts`) now go through a
single `sendError` helper per module — the nested-`error` shape the sibling
services already use (`settings-routes.ts`, `share-link-routes.ts`), plus the
`success` flag those two still omit and the contract requires.

**Codes moved, and that is the breaking part.** `AUTH_REQUIRED`,
`ATTACHMENT_DOWNLOAD_DENIED` and `FILE_DOWNLOAD_DENIED` used to sit at
`body.code`; they now sit at `body.error.code`. The SDK is unaffected — it
already reads `errorBody?.code || errorBody?.error?.code`, one of the four
shapes its error path sniffs for, which is the consumer-side shim Prime
Directive #12 says to cure at the producer. The console's attachment panel
was NOT: it read the top level only, so every gated download would have
degraded from "You don't have access to download this attachment." to
"Download failed (403)". Fixed in objectui to read both dialects, since a
console build ships independently of the server it talks to.

**Guarded both ways.** New `error-envelope.conformance.test.ts` in each
service drives every distinct error branch through the real registrar and
parses the body against the real `BaseResponseSchema` imported from
`packages/spec` — not a local restatement of it — and scans the module source
so a new route cannot quietly reintroduce the bare shape. The route ledgers
(#3563 → #3656) could never have caught this: they audit which routes exist
and whether the SDK can address them, not what comes back.

Measured and left alone: the dispatcher does not conform either — it puts the
HTTP status in `error.code`, where the contract declares a semantic string,
and parks the real code in `details` to work around its own occupied field.
That deviation is now pinned to exactly one field by a test in
`http-dispatcher.test.ts` rather than described in prose. Also unchanged:
service-storage's success bodies are still three shapes of their own
(`{ data }`, bare `{ url }`, `{ ok, key }`, none with `success: true`) — a
non-additive change that needs its own issue, not a quiet ride along with this
one.
