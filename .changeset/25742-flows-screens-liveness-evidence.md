---
'@objectstack/spec': patch
---

The liveness ledger's `flows.screens` translation row stops citing a file that no longer names the key

Clause-②: no
Metadata-protocol: none

- `liveness/translation.json`, row `flows.screens`: the evidence pointer at service-automation's `engine.ts#renderFlowTextSlot` is dropped. That file named `screens` only in a comment, and the comment moved to `run-resume.ts` when the engine's resume body was extracted, so the citation no longer said anything about the key. The row's other in-repo pointer, `builtin/screen-nodes.ts#registerScreenNodes`, names the key, and every objectui pointer is unchanged.
- The status stays `live`, `verifiedAt` is unchanged, and no state count moves. No schema changes: what a translation bundle or a `translation` item accepts and refuses is unchanged, and so is every other ledger row.
