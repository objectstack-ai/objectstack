---
'@objectstack/lint': patch
'@objectstack/metadata-protocol': patch
---

A junk entry in `stack.objects` no longer crashes the reference-integrity rules, and a probe rule that throws is reported instead of read as "nothing wrong".

`indexObjectGraph` is the first statement of every rule that resolves a field path, and it read each `stack.objects` member without checking it was a record — so a `null` entry (an empty YAML list item, a partial editor write) threw `TypeError: Cannot read properties of null (reading 'name')` before any rule's own per-object guard could run. Because these rules also run inside the runtime publish gate, that was an exception on a write path rather than a missed finding. The seam now drops non-record entries — silently, matching every sibling collection reader in the package — and the valid objects beside them are judged exactly as before.

On the publish receipt, `runBuildProbes`' object plane wrapped its rule call in a catch that produced an empty finding list, so a crashed rule was indistinguishable from a clean object while `checked.objects` had already counted it. A rule that throws now surfaces as a `runtime`-layer `object_field_ref_rule_failed` error carrying the thrown message, so an unverified object never reads as a verified one. Probes still never fail the publish they verify.
