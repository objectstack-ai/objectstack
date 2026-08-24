---
'@objectstack/rest': patch
---

Serve a sandboxed hook's own refusal sentence on the bulk write routes, instead
of the QuickJS debug wrapper

A hook's `throw new Error('删除被阻断…')` is a deliberate business rule, and
`classifyDataError`'s sandbox unwrap door exists precisely so the end user sees
only that sentence — the `<kind> '<name>' threw: <msg>` prefix "belongs in
server logs", in the door's own words. Six write routes never reached the door.
Measured against the real route handlers: `PATCH /api/v1/data/:object/:id`
answered `Opportunity is closed.` while `POST …/batch`, `…/createMany`,
`…/updateMany`, `…/deleteMany` and `…/:id/clone` answered
`hook 'guard' threw: Error: Opportunity is closed.` — one hook, one refusal, a
different sentence depending on which route the caller happened to use.

The branch is `resolveErrorResponse`'s declared-status passthrough, which is
checked *before* it delegates to `mapDataError` and answered its 4xx arm from
`error.message`. It now reads the business text through `sandboxBusinessMessage`
— the unwrap door's own two conditions (a non-empty string `.innerMessage`, and
not a `isScriptFaultMessage` crash) named once so the two doors ask the same
question.

**Not a reorder.** The passthrough's own docblock argues the ordering: handing a
declared 5xx to `mapDataError` re-labels it from the message TEXT (the
overlay-delete fault comes back `404 OBJECT_NOT_FOUND` and stops being logged),
so the arm stays exactly where it is and keeps deciding the status. Only the
sentence it reads changes. #5437/#5582's unconditional 5xx prose withhold is
untouched — a sandbox refusal declaring a 5xx still answers with the generic
text, pinned on both spellings.

What this restores is an invariant the same docblock already asserts. Its #7525
paragraph says an error declaring `statusCode` instead falls to `mapDataError`,
"So the two doors already agree on the wire answer." For a sandbox refusal that
was false — `statusCode` was unwrapped and `status` was not — which is the
two-spellings asymmetry this card was filed on. The doors agree again, pinned
door-to-door across the whole 4xx band rather than asserted in a comment.

**Bump level: `patch`, argued rather than defaulted.** The change is to message
TEXT on shipped routes, so the level is not automatic. It is a patch because
nothing about the envelope's contract moves: same status, same `code`, same
field set, no request newly accepted or refused. The delta is that one string
loses a debug prefix that this boundary already declares must never be on the
wire, and that the single-row routes never emitted — so no client could have
been reading it uniformly in the first place. Keying on the prefix would mean
substring-matching prose that is localised and deliberately reworded over time,
which is the practice the ADR-0112 `code` vocabulary exists to remove.

`POST /api/v1/analytics/dataset/query` — the seventh row — needed its own
repair: it builds a `{ code, message }` envelope inline and touches neither
door. It now imports the same `sandboxBusinessMessage` rather than re-deriving
the unwrap, so the analytics face and the `/data` face cannot answer one refusal
two ways. Both of its client emissions are covered (the declared-4xx envelope
and the `500 ANALYTICS_QUERY_FAILED` fallback); `logError` still receives the
whole error and `looksLikeInternalErrorLeak` still reads the raw text, so the
operator's copy and the leak heuristic are untouched.

`POST …/import` and `GET …/export` exit through `handleRouteError` like the bulk
routes, so they are repaired by the same change — measured rather than assumed.

**Measured and deliberately NOT repaired here**, each recorded so it is not
rediscovered as new: the record-share routes (`…/:id/shares`, list/grant/revoke)
are a third branch again — `respondSharingError` classifies by
`message.startsWith(CODE)` and its fallback interpolates `error.message` into a
hand-built `500`, ignoring a declared `status`/`code` entirely. And on the
analytics route an *undeclared* hook refusal answers `500` where `/data` answers
`400`; only the sentence was corrected, the status disagreement is a separate
defect. Both are filed as their own issues.
