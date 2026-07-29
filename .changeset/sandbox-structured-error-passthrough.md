---
"@objectstack/runtime": patch
---

fix(runtime): carry `code` / `fields[]` across the sandbox boundary so form actions can anchor validation errors (#3918 follow-up)

Found by dogfooding the merged #3918 chain against a running app. Submitting a
record that fails validation through a form **action** came back as:

```
HTTP 200
{ "success": true, "data": { "success": false,
                             "error": "ValidationError: issued_on is required" } }
```

No status a client could branch on, no code, no `fields[]`. The chain's
dispatcher fixes could not help: the field list was already gone before any
dispatcher exit ran. It was lost at the QuickJS boundary, twice —

1. **host → VM.** `vm.newError({ name, message })` dropped every other property,
   so a body reaching a record `ValidationError` through
   `ctx.api.object(x).update(...)` saw bare prose.
2. **VM → host.** The wrapper's reject handler flattened the error to the string
   `<name>: <message>` before the host ever saw it.

Both hops now carry an explicit **allowlist** — `code` and `fields` — alongside
the message, and `SandboxError` exposes them as `.code` / `.fields`. The
allowlist is a security boundary, not a style choice: host errors routinely hang
driver state, connection details or whole record payloads off themselves, and
anything crossing INTO the VM is readable by untrusted sandboxed code. Copying
the error's own enumerable keys would leak all of it.

`/actions` then surfaces them, so a form can highlight the offending input:

```
HTTP 200
{ "success": true, "data": { "success": false,
                             "error": "ValidationError: issued_on is required",
                             "code": "VALIDATION_FAILED",
                             "fields": [ { "field": "issued_on", "code": "required", … } ] } }
```

**The `/actions` wire contract is deliberately unchanged.** The status stays
200 and `success: false` remains the failure signal: that route has always
reported business failure in the payload (an action that "fails" is a normal
outcome, not a transport error) and every caller branches on `data.success`.
Making it a 4xx would be a break in exchange for a strictly additive fix, so the
fix is additive — `code` and `fields` are simply omitted when absent, and a
caller that ignores them sees exactly what it saw before.

Message channels are byte-identical: `SandboxError.message` keeps the
`<kind> '<name>' threw:` debug wrapper for server logs and `.innerMessage` stays
the plain business text a toast shows. The structured payload rides alongside
them, never instead of them.

Also adds `dispatcher-validation-error.real.test.ts`, which pins both dispatcher
exits against the **real** objectql `ValidationError` rather than a hand-built
fixture — including its deliberate absence of `.status`, the assumption the
whole #3918 fix rests on. The existing fixture-based tests restate that contract;
these check it, so a future change to the class fails a test instead of quietly
regressing production.
