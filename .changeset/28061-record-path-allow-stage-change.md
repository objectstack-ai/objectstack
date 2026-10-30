---
'@objectstack/spec': minor
---

feat(spec): a `record:path` block may opt in to `allowStageChange`, so a stage can be pressed to move the record there

Clause-②: yes (widening)
Metadata-protocol: added (record:path allowStageChange)

A `record:path` block draws the status field's stages as a progress rail, and nothing on it can be pressed: moving a deal to the next stage means opening the edit form and changing the picklist.

- **Spec.** `RecordPathProps` (`ComponentPropsMap['record:path']`) declares an optional boolean `allowStageChange`. Off unless authored, with no schema default, so every existing path keeps its read-only look and parses exactly as before. Any value other than a boolean is refused at the key.
- **Meaning.** With the key on, each stage the reader may move the record to is a button, offered only to a reader who may edit `statusField`. A press asks for confirmation, then saves `statusField` through the same record update `record:details` uses, carrying the record's concurrency token, so the object's state machine validation and the field's edit rights decide the move like any other edit. A refused move (an illegal transition, a missing required field) is shown in place. Nothing new is judged on the server.
- **Renderer.** The console does not read the key yet; the path stays a readout until the `plugin-detail` path renderer honours it. The block's registry does not publish the input until then.

Nothing to do for existing pages. Once the console honours it, add `allowStageChange: true` to a `record:path` node's properties to let readers change the stage from the path.
