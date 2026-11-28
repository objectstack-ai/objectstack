---
'@objectstack/observability': patch
---

fix(observability): `ConsoleLogger` and `JsonLogger` record an error's `cause` chain

Clause-②: yes (widening)
Metadata-protocol: none

`error(message, err)` and `fatal(message, err)` on both loggers used to record the error's own message and stack only, so an error wrapped around an original on `cause` (`new Error(say, { cause })`) logged without its root cause. The record now carries `causes` beside `error` and `stack`: one entry per link, outermost first, each with the link's message and stack. The chain is bounded at five links and stops at the first repeat of a cycle, ending in a marker entry whenever it was cut. It is the same shape the 5xx fault line (`faultCauseChain` in `@objectstack/types`) and `ObjectLogger` in `@objectstack/core` record.

An error with no `cause` logs exactly as before: `causes` is omitted. No new exports, and no new runtime dependency.
