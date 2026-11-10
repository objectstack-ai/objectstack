---
'@objectstack/client': patch
---

docs(client): the `automation.trigger` / `execute` docblocks no longer promise `422 FLOW_NO_START_NODE` for a stored flow with no `start` node. Registration refuses such a flow (`400 VALIDATION_FAILED` at the save), a stored one is never armed, and its trigger answers `404` (#32288)
