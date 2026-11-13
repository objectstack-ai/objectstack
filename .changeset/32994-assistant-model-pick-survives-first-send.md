---
'@object-ui/app-shell': patch
---

fix(app-shell): the model picked in the AI assistant composer is the model the chat request sends, from the first message of a new conversation on, and the picker keeps showing it

Clause-②: no
Metadata-protocol: none

Every chat host (the full-page `/ai/build` and `/ai/ask` surfaces, the console dock, the Studio copilot) keys its chat pane on the conversation id, and the first send creates that conversation, so the pane remounts mid-send. The pick lived inside the pane and was dropped there: the first message went out with the environment's default model and the picker snapped back to it. The hosts now hold the pick, so it survives the remount.
