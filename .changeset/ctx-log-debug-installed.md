---
"@objectstack/runtime": patch
---

fix(runtime): `ctx.log.debug` works in hook and action bodies — the sandbox installs the fourth level the CLI and docs already promise (#7661)

A body that called `ctx.log.debug(…)` threw **`TypeError: not a function`**
inside the VM. Under `onError: 'abort'` that aborted the write, so the failure
mode was a refused save, not a missing log line.

Nothing about the body was wrong. `debug` was declared on three surfaces and
implemented on none:

- the CLI's capability extractor matched `ctx.log.debug` and granted the `log`
  capability for it, so `os build` blessed the body,
- the docs table taught `ctx.log.info / warn / error / debug` → `log`, and
- the sandbox installed `info` / `warn` / `error`.

An author who followed the documentation got a body whose declared capability
was satisfied and whose call then threw. `debug` is now installed in the QuickJS
`ctx.log` bridge and declared on the sandbox's `ScriptContext['log']`, so all
four surfaces agree on four methods.

**Enforced rather than retired** (ADR-0049 enforce-or-remove). This is the same
shape as `crypto.hash` (#4391) one member over, but that one was removed because
implementing it widened the sandbox's *security* surface. Emitting a debug-level
diagnostic from a hook body carries no such argument — `--log-level debug` is
exactly what such a body is for — and `Logger.debug(message, meta)` already
existed on the contract, so the host logger needed nothing new.

`debug` behaves like the other three levels in every respect: it is gated behind
the `log` capability, its line is attributed to the emitting hook or action, its
structured `data` crosses the VM boundary as a value rather than
`"[object Object]"`, and when the BodyRunner was constructed without a logger it
raises the same once-per-body "ctx.log output is discarded" warning instead of
dropping the call silently.

Unaffected: `info` / `warn` / `error` behaviour, the capability tokens, the
extractor regex, and the docs table — all three were already correct.
