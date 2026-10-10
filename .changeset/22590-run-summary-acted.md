---
'@objectstack/service-automation': patch
---

fix(service-automation): the `sys_automation_run` row's highlight set now shows `unmeasured_count` beside `selected_count` and `acted_count`. That puts all three operands of the broken-sweep first filter (`selected_count > 0 AND acted_count = 0 AND unmeasured_count = 0`) on the run row itself. The field's description now also lists a notification queued for delivery as an uncountable effect.

Why: on a stack composed as `serve` composes it, reliable delivery is on, so a `notify` step's in-app message is enqueued. The outbox dispatcher writes it after the run settles, and the node reports `unmeasuredEffect`. A notify sweep that did its job therefore reads `acted 0, unmeasured 1`. With only `selected` and `acted` on the row, it read the same as a sweep with nothing to do. No counter changes: an enqueued delivery stays uncountable, never a fabricated `acted`.

For operators: read the triple (`selected`, `acted`, `unmeasured`), never `acted` alone. `acted 0` with `unmeasured` above 0 means "cannot tell", not "did nothing".
