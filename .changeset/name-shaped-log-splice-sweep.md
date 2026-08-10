---
'@objectstack/service-automation': patch
---

fix(service-automation): the five NAME-shaped log splices stop interpolating foreign identifiers into log messages (#6654)

The tail #6499 reported but did not fix and #6587 deliberately excluded: five
`service-automation` log records still spliced **names/identifiers** that
originate outside the engine's control and are not schema-constrained to reject
newlines. `ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so a
newline in any of them turns ONE record into several physical lines of which
only the first is greppable, and `serve`'s boot-quiet window drops the headless
continuations outright on the stdout (warn) path — the same downstream damage as
the closed thrown-text class, reached through a different door.

All five now log a single-line message carrying only controlled facts, with the
foreign identifier(s) in the logger's structured slot:

- the **re-entrancy guard** — the caller's record id → `recordId`;
- the **refused resume** — the caller's resume-signal keys → `rejected`;
- the **screen-input refusal** — the user-submitted keys, which reach the
  message via `validateScreenInputs`' `Unknown screen field "…"` findings →
  `issues` (the message now states the issue COUNT);
- **`warnUnknownNodeTypes`** — the flow's unknown node type names and the
  registered vocabulary → `unknownTypes` / `knownTypes`;
- the **unclaimed branch label** (#4414) — the computed, potentially
  record-derived branch label and the out-edge labels → `branchLabel` /
  `outEdges`.

**No level changes**: every one of the five is #4632-FUNCTIONAL and stays
`warn`. Behaviour is unchanged at all five sites, and the caller-facing refusal
ENVELOPES (`INVALID_SIGNAL`, `INVALID_SCREEN_INPUT`) are untouched — they still
name the offending variables and fields, because an envelope is not a log
record.

Operator-visible: each message keeps its lead phrase so existing greps still
match — `re-entered for the same record`, `signal writes engine-internal`,
`violates its declared field contract`, `no registered executor or descriptor`
(load-bearing: tests and log filters count per-flow findings by it), and
`no out-edge carries that label`. Anything keyed on the spliced identifier
inside those messages must read the structured field instead.
