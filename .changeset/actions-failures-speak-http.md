---
"@objectstack/runtime": major
"@objectstack/client": minor
---

fix(actions)!: failures speak HTTP — business rejections are 400, success is a single wrap (#3962)

**BREAKING (raw-HTTP callers of `POST /api/v1/actions/...` only).** The
200-with-inner-envelope wire was never a designed contract: no ADR or doc ever
specified it, it originated as the route's catch block reusing
`deps.success()`, and `/actions` was the only route of 12 that double-wrapped.
#3962 classifies it as a bug. Five defects traced back to that one extra layer
(the console's green toast on failed actions, `redirectUrl` never firing, a
marketplace install reported as installed when it failed, the client-envelope
divergence #3927 papered over, and crashes invisible to monitoring).

The contract now, identical to `/data`:

| Outcome | HTTP | Body |
|:---|:---:|:---|
| Ran, returned | **200** | `{success: true, data: <handler return value>}` — single wrap |
| Ran, rejected (business rule / validation) | **400** | `{success: false, error: {message, code, details: {code?, fields?}}}` |
| Never dispatched (unknown / denied / wrong type / unavailable) | 404 / 403 / 400 / 503 | unchanged (#3930/#3951) |
| Crashed (`TypeError`, driver class, sandbox timeout) | **500** | unchanged (#3951) |

A validation rejection carries `details.code: 'VALIDATION_FAILED'` and
`details.fields[]` — the exact payload #3937 fought for, now on the same wire
shape `/data` has always used, which `@objectstack/client` normalizes to
`err.code` / `err.fields` (#3927). A rejected flow is a 400 with
`details.code: 'FLOW_FAILED'`. The crash-vs-rejection discriminator (#3951,
error `name`) now selects 400 vs 500.

`client.actions.invoke` / `invokeGlobal` still never throw: they fold every
failure status into `{success: false, error}`, read the single wrap on
success, and keep a NARROW legacy heuristic so a current SDK talking to a
pre-#3962 server still folds the old double-wrapped 200s correctly.

**Migration for raw-HTTP third parties:** branch on the HTTP status — a
non-2xx is the failure, `error.message` / `error.details` carry the detail; on
a 200, `data` is the handler's return value directly (one level less than
before). Callers using `@objectstack/client` need no change.
