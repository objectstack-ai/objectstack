---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow under `errorHandling.strategy: 'retry'` re-evaluates its start condition on every retry attempt

Clause-②: no
Metadata-protocol: none

When a flow's start-node `condition` could not be evaluated (a CEL fault against the record, for example), `execute()` handed the fault to the flow's error strategy. Under `strategy: 'retry'` every retry attempt then ran the flow's nodes without evaluating the start condition at all, so a fault on attempt 1 opened the author's gate on attempts 2 and later. Both attempt paths now call one start-condition evaluator. A condition that faults on every attempt is retried as a fault and the run ends `failed` with no node executed. A condition that faults once and then holds runs the nodes once. A condition that faults once and then does not hold skips the run with the same `condition_not_met` answer attempt 1 gives. The default strategy is unchanged.
