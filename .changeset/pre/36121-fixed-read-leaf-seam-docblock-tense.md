---
'@objectstack/objectql': patch
---

docs(objectql): the fixed-read leaf seam's docblocks name plugin-sharing as the leaf's producer, in the present tense (ADR-0155 step 6)

Clause-②: no
Metadata-protocol: none

Comment-only. The seam's docblocks no longer say the producer, its boot check and its up-front answer (R2) are still to land, or that nothing writes the leaf: plugin-sharing writes it and reads `driverEvaluatesFixedReadLeaf` for R2. No export or runtime behaviour changes.
