---
"@objectstack/types": patch
"@objectstack/runtime": patch
---

fix(types,runtime): log every 5xx at `error` level instead of answering it silently (#14310)

A 500 that leaves no server-side line is diagnosed from the browser or not at
all. Measured on `main`, through the real plugin and the real route handlers: a
plain `Error` thrown out of a dispatcher route answered `500 INTERNAL_ERROR`
with **zero** log records at any level — the only evidence was the client's
console and the response body. That is AGENTS.md "Route & surface ownership §3
— absence must be loud" inverted, and it is why a `/api/v1/packages` regression
stayed invisible for a week.

The reporting that already existed was not a substitute, for two independent
reasons:

- `ErrorReporter.captureException` defaults to `NoopErrorReporter`. A dev
  server — the surface an operator actually watches — wires no APM, so the
  capture was a no-op every time. A log line is the operator's floor; APM is
  opt-in telemetry on top of it.
- It is fed by `res.__obsRecordedError`, which only the THROWN exit sets. A
  route that catches its own fault and RETURNS a 5xx envelope — how every
  `/packages` handler answers, via `deps.errorFromThrown` — recorded nothing,
  so even a wired reporter never saw those.

**The rule now has one definition.** `logServerFault` (new, in
`@objectstack/types`) emits exactly one `error`-level record carrying method,
path, request id, the message and — where the door still holds the throw — the
stack. It shares a home with `resolveThrownHttpError` for the same reason that
rule was moved there in #8016: a rule two doors must agree on cannot live
inside one of them, because `@objectstack/runtime` depends on
`@objectstack/rest` and an import could only ever point one way.

Wired at each transport's single exit, so a fault costs one line and never two:

- `sendError` — the one writer for every nested-envelope error in the repo. The
  REST direct-mount registrars (the `/api/v1/packages` door that mounts first
  in production) become loud through it with no per-door call, so a door added
  later cannot forget one.
- The dispatcher's thrown exit (`errorResponseBase`), its returned exit
  (`sendResultBase`) and the AI-route mount that writes its own result.

`packages/rest`'s `/data` doors were already loud via `logUnexpectedRouteError`
and are untouched.

`error` level is load-bearing: the CLI's default is `warn` and `error` (40)
outranks `warn` (30), so the record clears `--log-level`'s default without
bypassing the level system. `--log-level silent` still silences it, which is a
deliberate instruction rather than the default this fixes.

**4xx stays quiet**, decided once inside the helper rather than at each call
site — client mistakes are already explained by the response, and logging them
is how a `?state=draft` probe once printed 45 stack traces in one browsing
session. The wire body is byte-identical at every door: this adds a side
effect, never a field.

⚠️ Behaviour change worth knowing before upgrading: a deployment that answers
a *declared* 5xx on a polled route — `501 NOT_IMPLEMENTED` from an uninstalled
optional service, say — now prints one `error` line per request where it
previously printed none. The band is the one the issue specifies ("4xx may stay
quiet; 5xx never"); narrowing it for declared capability-absence would be a
separate contract decision.
