---
"@objectstack/core": minor
---

fix(core)!: a throwing `kernel:ready` handler now fails the boot on **LiteKernel** too (#5170)

**Behaviour change — read this if you run `LiteKernel` (vitest harnesses,
serverless functions, edge workers).** A `kernel:ready` handler that throws now
**rejects `bootstrap()`** on `LiteKernel`, exactly as it always has on
`ObjectKernel`. Before this change the throw was caught inside the kernel,
written out as one `Hook handler failed: kernel:ready` error log, and the boot
continued to "✅ Bootstrap complete".

**Why it mattered.** The two kernels ran the same hook through two different
dispatchers: `ObjectKernel` used `context.trigger` (a bare awaited loop that
never catches), `LiteKernel` used `triggerHook` (per-handler try/catch,
"continue with other handlers even if one fails"). Same hook name, same plugin
code, opposite failure semantics — which is `declared ≠ enforced` in the
kernel's own lifecycle contract.

`kernel:ready` is the only correct moment for a plugin to assert that a
precondition it *declared* was actually delivered: the service registry is
still filling during `init()`, so a boot gate has nowhere earlier to run. Every
"declare it and we refuse to start if we cannot honour it" gate in this repo
therefore lives there — and on `LiteKernel` those gates were being downgraded to
a log line while the process came up and served traffic without the guarantee it
had announced. `EmailServicePlugin`'s `queueDelivery: true` gate (#5160) is the
worked example: on `ObjectKernel` the boot failed, on `LiteKernel` the server
came up and quietly fell back to inline delivery. Serverless is exactly where
"do not start misconfigured" matters most.

**Who is affected.** Any `LiteKernel` host whose `kernel:ready` handler throws
on a healthy boot. That boot previously "succeeded"; it now fails loudly with
the original error, and the kernel is left `stopped` rather than `running`. The
failure was never silent — it was already an `ERROR` line in your logs — so
check for `Hook handler failed: kernel:ready` in existing logs to find hosts
that will now refuse to start. If the handler's work is genuinely optional,
catch inside the handler and log there; the kernel no longer decides that for
you. The full test surface in this repo that boots `LiteKernel` (core, client,
runtime, http-conformance, the connectors, service-automation) passes unchanged
— nothing was relying on the swallow.

Scope: **`kernel:ready` only.** `kernel:bootstrapped`, `kernel:listening` and
`kernel:shutdown` keep `LiteKernel`'s isolating dispatch, pinned by a test.
