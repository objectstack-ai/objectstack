---
'@objectstack/objectql': patch
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

Warnings, refusals and hints that cited a tracker number now say what was decided

Clause-②: no

Several runtime strings an author or operator reads sent the reader to an issue-tracker number for
the reason behind them. Each now states that reason in the sentence itself:

- `@objectstack/objectql`: the two data-event warnings. A write that names no single record publishes
  no per-record event rather than one with an empty `recordId`; a predicate (`multi: true`) write
  publishes its own `data.records.*` event carrying the affected-row count and nothing else, so a
  driver result that is not a count publishes no bulk event either.
- `@objectstack/service-automation`: the warning for a pausing node type that never declares
  `resumeAuthority`, the generic-route resume refusal (its log line and its error text), and the
  refusal of a suspension from a type that declares `supportsPause: false`. An undeclared
  `resumeAuthority` resolves to `'service'` (fail-closed), so the generic resume route refuses those
  pauses; guessing `'any'` is how a raw resume once walked past an approval decision no service had
  recorded.
- `@objectstack/runtime`: the endpoint step's `NOT_IMPLEMENTED` message and its two hints (the
  composed runtime always threads the policy context and the execution wiring, because execution is
  reachable only past the policy chain), and the endpoint mapping refusals (the publish gate rejects
  the same shapes, so a declaration that reaches the runtime check was stored without passing it).

Text only: no error code, field name, status or behaviour changes.
