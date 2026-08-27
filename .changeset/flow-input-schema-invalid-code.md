---
"@objectstack/spec": minor
---

feat(spec): register `FLOW_INPUT_SCHEMA_INVALID` — the definition-level input-schema refusal becomes a never-dispatched exit with its own ADR-0112 code (#11504, the contract half of the #10025 ruling)

`AutomationResult.code` gains `'FLOW_INPUT_SCHEMA_INVALID'`, and the code is
registered in the ADR-0112 error-code ledger under `@objectstack/runtime`
beside `FLOW_DISABLED` / `FLOW_NO_START_NODE`. Semantics: a node's static
`config` violates the `inputSchema` its own flow definition declares, so the
engine refuses to dispatch — nothing runs, nothing is written, the result
carries the code and NO `status` (the #9378 never-dispatched class), and a
transport maps it to **422** (unexecutable stored definition, exactly as
`FLOW_NO_START_NODE`).

Ruled by #10025 (maintainer, 2026-08-20): the refusal is **non-retryable** —
the guard's verdict is a pure function of the flow definition, so re-running
it cannot change the answer. This release ships only the contract vocabulary;
the engine behaviour change is #10025's services half and lands separately.

**Operator-visible consequence once that services half lands, stated
plainly:** retry accounting and run-log volume change for affected flows. A
`strategy: 'retry'` flow whose node `config` violates its declared
`inputSchema` today burns its whole retry budget (including configured
backoff delays) and writes `1 + maxRetries` identical failed run-log rows;
after the services half it refuses **once**, producing **one** run-log row
carrying `code: 'FLOW_INPUT_SCHEMA_INVALID'` and no `status`. Anything
watching retry counters or paging run history for this exit sees different
numbers for the same flow.
