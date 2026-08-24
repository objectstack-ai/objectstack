---
'@objectstack/rest': patch
---

Serve the `code` a sandboxed hook declared on `/api/v1/data` refusals, at every
status — not only where a bespoke arm happened to catch the condition first

Measured on a booted 17.1.0 server: a hook throwing
`Object.assign(new Error(msg), { code: 'RECORD_LOCKED', status: 409 })` reached
the client as `409 {"error":"…","object":"crm_opportunity"}` — the status but no
machine-readable `code`. Same for `DUPLICATE_VALUE` on `POST` and `FORBIDDEN` on
`403`, while `DELETE_RESTRICTED` at the same 409 and `VALIDATION_FAILED` at 400
carried theirs. A client that must tell "this record is frozen, do not retry"
from "this value is already taken, offer a merge" got `409` for both and had to
substring-match prose that is localised and deliberately reworded over time —
the failure mode the ADR-0112 `code` vocabulary exists to remove.

The branch is `classifyDataError`'s **sandbox unwrap door** in
`error-response.ts` (`typeof error?.innerMessage === 'string'`), which rendered
from the raw error and emitted no `code` at all, while every arm around it
renders from the resolved envelope. That is the whole of the reported
correlation between "no `code`" and "the unwrapped message": they are one
branch, not cause and effect.

It was never the status policy it looked like from outside. The door dropped
`code` on a declared **400** exactly as on a declared 409, and kept it on a
declared 5xx by falling through to the passthrough below — one sandboxed
producer, its code surviving 503 and lost at 409. What made the reading look
status-shaped is which codes have a bespoke arm above the door:
`DELETE_RESTRICTED` and `VALIDATION_FAILED` do and never reach it,
`RECORD_LOCKED` / `DUPLICATE_VALUE` / `FORBIDDEN` do not and did.

The code now rides via `thrownCodeFields`, the one definition the three sibling
arms already use, so the door joins the closed ADR-0112 vocabulary: a registered
spelling arrives verbatim, an unregistered one is demoted to `declaredCode`
beside the status-derived member. Nothing is invented — a producer that declared
no code still gets a body carrying none.

Unchanged: the business message is still the unwrapped `innerMessage` (never the
`hook 'x' threw: …` debug wrapper), a crashing hook body is still the sanitised
`500 INTERNAL_ERROR`, a declared 5xx still withholds its prose, and a refusal
that declares no status still answers 400.
