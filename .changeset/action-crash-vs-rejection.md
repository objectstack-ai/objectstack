---
"@objectstack/runtime": minor
---

fix(actions): an action that CRASHED is a 500, not a 200 reporting success:false (#3913 follow-up)

#3937 settled that a failed action reports in the payload at HTTP 200 — "an
action that fails is a normal outcome, not a transport error". That is a
statement about the action **rejecting**: a business rule saying no. The same
exit was also covering a third case it never argued for.

A `TypeError` in a handler, a driver blowing up, a sandbox timeout — those are
not outcomes the action chose to report, they are the server failing to produce
one. Serving them as 200 hid **every handler crash** from the layers that exist
to catch server faults: gateway error rates, retry and circuit-breaker policy,
APM auto-capture, alerting, `fetch().ok`. For a platform whose main extension
surface is customer-authored script bodies, "customer action bodies are
throwing" had no signal short of body-parsing at every hop.

Those are **500** now, through the same `errorFromThrown` exit every other
domain catch has used since #3925 — which also means a driver dump finally goes
through the internal-error-leak sanitiser (#3867) instead of reaching the client
verbatim in a 200 body.

**Nothing #3937 put in the payload moves.** A rejection and a crash are told
apart by the error's NAME, the signal `@objectstack/rest` already uses on this
exact distinction ("non-default names (`TypeError: …`) […] signal a genuine
script bug rather than a deliberately thrown business rule"):

| Thrown | Verdict | Wire |
|:---|:---|:---|
| `new Error(msg)` — a registered handler rejecting | rejection | 200 + payload |
| `SandboxError` with `innerMessage` — a body's deliberate throw | rejection | 200 + payload |
| Anything carrying `code` / `fields`, or a `ValidationError` by name | rejection | 200 + payload |
| A throw with no `name` at all | *not confidently a fault* | 200 + payload |
| `TypeError` / `ReferenceError` / `SqliteError` / a driver's class | crash | **500** |
| `SandboxError` with no `innerMessage` — timeout, capability denial | crash | **500** |

Deliberately the narrow direction: only what is *certainly* a fault moves, and
everything uncertain keeps the 200 it has today.

One related fix in the same exit: an error carrying its own `status` /
`statusCode` (a plugin's `FORBIDDEN` with `status: 403`) is now served with it
rather than buried in a 200 payload — that status was the one thing the thrower
was unambiguous about. Record `ValidationError`s deliberately carry no
`.status`, so #3937's cases never reach that branch.

Documented in `api/error-catalog.mdx` (new **Action Errors** section with the
full status table and the two-check pattern a raw `fetch` caller needs) and
`ui/actions.mdx`.
