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

**Not covered, measured and reported rather than quietly widened:**
`POST /api/v1/analytics/dataset/query` builds its own `{ code, message }`
envelope inline in `rest-server.ts` and reads `error.message` directly; it
shares no branch with the above and still serves the wrapper. The record-share
routes (`…/:id/shares`) are a third branch again — `respondSharingError` matches
on `error.message` and the fallback interpolates it into a `500`. Both live in a
file held by another open PR this round and are filed separately.
`POST …/import` and `GET …/export` exit through `handleRouteError` like the
bulk routes and are repaired by the same change.
