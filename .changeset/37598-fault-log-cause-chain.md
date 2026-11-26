---
'@objectstack/types': patch
'@objectstack/core': patch
'@objectstack/service-record-context': patch
---

fix: the 5xx fault log and `ObjectLogger` print an error's `cause` chain

Clause-②: yes (widening)
Metadata-protocol: none

A server fault thrown with the original error on `cause` used to log the wrapper's message and stack only, so the root cause was missing from the operator's line. `logServerFault` (`@objectstack/types`) now prints the chain as `causes` beside `stack` on its console fallback, and `ObjectLogger` (`@objectstack/core`) prints it as `error.causes` for every `logger.error` / `logger.fatal` that passes an error. Each link carries its message and stack; a cycle stops at the first repeat and a chain stops after five links, each saying so in a last link. Nothing reaches a response body.

`@objectstack/service-record-context` drops the `Caused by:` suffix it appended to a failed read's stack, since the fault line now renders the `cause` itself.
