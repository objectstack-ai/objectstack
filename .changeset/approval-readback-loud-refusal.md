---
"@objectstack/plugin-approvals": patch
---

fix(approvals): refuse loudly when a successful mutation's read-back is org-filtered out (#12769)

Ten ApprovalService result sites (decide/decideNode, recall, sendBack, resubmit,
reassign, remind, requestInfo, comment) read the row they just mutated back
through the caller's organization narrowing and asserted the result non-null
(`fresh!`). For an org-less request row — produced by construction on every
schedule / time-relative / api trigger run (#10131; pinned rather than repaired
by #9132) — an org-scoped caller's read-back matches nothing, so a call that
SUCCEEDED shipped a well-formed success envelope whose declared-non-null
`request` was `null` (HTTP 200 with `"request": null` through the REST
pass-through), and a client dereferencing `request.status` crashed.

The read-back now throws `READ_BACK_FAILED: …` instead: the write is recorded
and NOT rolled back; only the result echo is refused, loudly. Over REST the
error surfaces through each route's existing 500 arm (`APPROVAL_RECALL_FAILED`
and siblings — already-registered codes) with the `READ_BACK_FAILED:` message
in the body. No declared result type changed — the declared-non-null `request`
is now always true because a result that cannot be built is never returned. The
caller-org narrowing in `loadRequest` (tenancy wall) is deliberately untouched.
