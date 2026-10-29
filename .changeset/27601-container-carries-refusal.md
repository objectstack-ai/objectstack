---
'@objectstack/service-automation': patch
---

fix(service-automation): a refused write inside a `map` item or a `subflow` reaches the flow's caller as the structured refusal

Clause-②: no
Metadata-protocol: none

A flow whose data node met a refusal (a permission, a validation rule, a duplicate, an app hook's declared refusal) already reported it on the run's result as `innerRefusal` (`{ code, message }`) and the producer-marked `userMessage`, and every flow door served them on the `FLOW_FAILED` details. When that write sat inside a `map` item or a `subflow`, the container built a new failure of its own and the two members were lost, so the caller got only the whole node chain as text (`Node 'recalc_each' failed: map 'recalc_each': item 0 (subflow '…') failed: …`). Both containers now carry the child run's members onto the failure they return, so the refusal reaches the top run however deep it was met, nested `map` → `subflow` included. A `map` stops at its first failing item and carries that item's refusal. A child that failed with no refusal carries none, as before, and the `error` text is unchanged.
