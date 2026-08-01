---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
"@objectstack/service-automation": patch
---

fix(automation,spec): the cold-boot flow bind must survive the read path's own annotations (cloud#971)

`getMetaItems({ type: 'flow' })` decorates every served item with
`_diagnostics` (and `_draft` on a preview read). The cold-boot bind fed that
served document straight into `engine.registerFlow` → `FlowSchema.parse`, and
since #4001 closed the metadata schemas an unrecognized key **throws** instead
of being dropped — so every flow failed to register on every boot with
`unrecognized_keys: ["_diagnostics"]`. Not fatal only by luck: the
record-change plugin binds record flows a second way, so automations kept
firing behind one WARN per flow. A flow whose only binding path is this one
would have gone silently dead.

Fixed at the read seam (`readFlowDefsFromProtocol`), not by loosening
`FlowSchema`: the payload is malformed because we decorated it, so the
producer's annotation is the producer's to remove.

`@objectstack/spec` gains `METADATA_READ_DECORATIONS` / `stripReadDecorations`
(`kernel/metadata-read-decorations`) — the list moves out of
`metadata-protocol`, where it was module-private, so the producer and its
cross-layer consumers share one definition. `metadata-protocol` re-exports
`stripReadDecorations` unchanged; no public surface is removed.
