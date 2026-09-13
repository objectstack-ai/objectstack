---
'@objectstack/runtime': patch
---

A sandboxed hook's business refusal reached through a script action answers 4xx, not `500 INTERNAL_ERROR`

`POST /api/v1/actions/:object/:action` answered **`500 INTERNAL_ERROR`** when a
`beforeUpdate` hook refused a state transition for a business reason and the
refusal travelled out through the action body's `ctx.api` write. The same refusal
has answered **`400`**, with the hook's sentence verbatim, on `/data` since
objectstack#11588. A 500 tells every client "the platform broke", so a
well-behaved one retries, alerts or pages for a guard that will never say yes.

**Where the producer was.** Not in the action route's classifier — that read the
shape it was handed correctly, and both sides of the line it pins (`a deliberate
REJECTION is a 400` / `an unexpected FAULT is a 500`) are unchanged. The refusal
arrived already stripped of every mark that says "a body reported this on
purpose", one VM hop earlier: `hostErrorToVm` marked **every** `SandboxError`
crossing into the action body's VM as the sandbox's OWN fault (objectstack#4431)
on an `instanceof` test — and a nested sandboxed hook's refusal *is* a
`SandboxError`, wrapped by the same runner one level down. The pump branch that
reads that marker then discarded `innerMessage`, `code`, `status` and `fields`,
and the classifier read the missing business message as a crash.

**What changed.** The marker now asks the question the `/data` door asks —
`sandboxBusinessMessage`, objectstack#11588 — instead of testing the error's
class. Both of that predicate's conditions travel, because both are load-bearing:
a capability denial carries no business message and stays a fault, and a nested
body that **crashed** carries `TypeError: …` and stays a fault too.

**No status was picked for this route.** It matches what `/data` already answers
for the same producer: the status the body declared, or `400` when it declared
none. A refusal that declares `{ status: 409, code: 'RECORD_LOCKED' }` now
reaches the caller as `409 RECORD_LOCKED` instead of losing both.

**The sentence a caller receives is byte-identical to what the 500 carried** —
this moves the status, not the prose. The flattened `SandboxError: ` name prefix
is stripped on the rejection path by the same helper the fault path already used.

No authorable key, accept set or export surface moves; no consumer needs a
change. Clients branching on 5xx to decide whether to retry will stop retrying
these refusals.
