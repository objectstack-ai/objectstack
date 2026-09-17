---
"@objectstack/runtime": patch
---

fix(runtime): a NON-sandboxed crash at `/api/v1/actions` no longer ships its native error message verbatim (#18540)

Clause-②: no

A plain `TypeError` thrown by an in-process registered action handler answered
`500 INTERNAL_ERROR` carrying the native sentence on the wire:

```
{"success":false,"error":{"code":"INTERNAL_ERROR",
 "message":"Cannot read properties of undefined (reading 'id')","httpStatus":500}}
```

The identical crash through the `/data` door answered `"Internal server error"`
(#7543 / #15071). One repository, two doors, one already meeting the contract.

**The status was already right; what leaked was the sentence.** No status code,
no `error.code` and no envelope key moves — reaching this branch already proves
the throw declared no `status`/`statusCode` (the branch above serves those) and
is not a `ValidationError`, so the resolver's status was the 500 fallback and its
code was the status-derived `INTERNAL_ERROR`. Only `error.message` changes.

**Why neither existing guard caught it.** #17273's crash terminal is keyed on the
SANDBOX — `isNativeErrorName` read over the `innerMessage` the QuickJS runner
fills — and this face never crosses a VM boundary, so nothing sets `innerMessage`
and that terminal never fires. *A predicate that classifies by HOW a crash
arrived is structurally blind to crashes that did not arrive that way, while
looking exhaustive.* The other guard, the dispatcher's 5xx withhold, is gated on
`looksLikeInternalErrorLeak`, which recognises DRIVER DUMPS and reads FALSE for
stack-shaped prose.

**The structural difference, which is the fix.** The `/data` door is default-DENY:
`classifyDataError` ends in an unconditional `UNCLASSIFIED_FAULT()`, and its
`looksLikeInternalErrorLeak` limb only picks `DATABASE_ERROR` over
`INTERNAL_ERROR` — that limb is not what sanitises. The actions door's
`unexpectedFault` exit relayed `err.message` and was therefore default-ALLOW:
prose shipped unless a heuristic recognised it. That exit is this door's
unclassified-fault terminal, so it now answers the terminal's envelope —
`INTERNAL_ERROR_MESSAGE`, through the same `deps.error` seam #17273's terminal
uses.

⛔ `looksLikeInternalErrorLeak` is NOT re-pointed at stack-shaped prose. It guards
a different question at every other boundary, and widening it would change what
each of them withholds.

**Measured population.** Driven through the real `HttpDispatcher.handleActions`
door against `mapDataError` on the same throws: seven shapes leaked at `/actions`
and were already sanitised at `/data` — `TypeError`, `ReferenceError`,
`RangeError`, `SyntaxError`, a driver class whose prose the heuristic does not
recognise (this one shipped a server **filesystem path**), a sandbox timeout and
a sandbox capability denial. All seven now answer the same sentence at both
doors. Two controls are unchanged in both directions: a deliberate rejection
keeps its `400` and its own words, and a crash that DECLARED its own status keeps
that status and that sentence.

**Who is affected.** Any caller reading `error.message` off a `500` from
`/api/v1/actions` to tell one crash from another. That text was never a contract
— it is the thrown error's own prose — and the full text still reaches the
operator: the `console.error` on the line above keeps it, the same
"the client does not read it, the log keeps it" split `rest` already draws.
