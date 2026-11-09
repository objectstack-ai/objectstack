---
'@object-ui/plugin-detail': patch
---

feat(plugin-detail): the default record page lets an editor move a record to another stage by pressing it on the stage path

Clause-②: no
Metadata-protocol: none

**Visible behaviour change on a released page.** The record page the console synthesizes for an object with a stage field (no authored page) used to draw its stage path as a read-only progress rail, so moving a deal to its next stage took 编辑 → change the stage → 更新. That page's `record:path` now carries `allowStageChange: true`, the existing opt-in (no new metadata key):

- **Who can press.** Unchanged from the opt-in: a reader the record page lets edit this record, on a stage field that is not read-only or computed, whose field edit grant holds for the stored row. Everyone else keeps the read-only path, and so does an editor while the record's inline edit holds unsaved changes.
- **Every press asks for confirmation**, then saves the stage through the record's ordinary update with the record's version, so the object's validation rules and `state_machine` decide. A refused move is shown under the path, naming any other field the move needs (for example a field made required by the new stage); nothing is written.
- **Only reachable stages are offered.** On every page with the opt-in, a stage the stage field's blocking `state_machine` cannot reach from the stored value is drawn as a readout, not a button, the same moves the record form, the grid's inline editor and the board offer. A field with no such rule offers every stage, and the server still judges each move.
- **Authored pages keep their own setting.** A page, or an authored `highlights` slot, that declares its own `record:path` keeps whatever it declares: `true`, `false`, or the key left out (a read-only rail).

To keep a default record page's path read-only, assign the object an authored page (or a `highlights` slot) whose `record:path` leaves `allowStageChange` out or sets it `false`.
