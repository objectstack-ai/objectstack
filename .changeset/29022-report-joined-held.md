---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a report switched to Joined in Properties is held until its first block is added, instead of autosaving a report the draft door refuses

Clause-②: no
Metadata-protocol: none

Setting Report type = Joined clears the report's dataset and measures, because a joined report selects per block. Until a block is added, the report has no `blocks`, and the spec refuses it ("a `joined` report needs `blocks`"). Studio used to autosave that body and get a 422, and every later edit carried the same body and was refused too, then lost on reload. Now the Interfaces pillar holds it unsent, as it already holds an unfinished Order item, block or chart. A neutral line reads "Not saved yet: a Joined report needs at least one block in “Blocks”", its "Show me" focuses the Blocks list, and Studio's leave guard and Publish see the held edit. Adding a block hands the hold to that block until its Name and Dataset are set, and the next autosave then sends every edit kept meanwhile. A joined report with no blocks that also keeps a key the spec refuses is still sent, so that refusal stays on screen.
