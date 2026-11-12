---
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

docs: the trigger-door route docblocks (`@objectstack/runtime`) and the `AutomationEngine.execute()` exit comment and README (`@objectstack/service-automation`) no longer say a stored flow with no `start` node answers `422 FLOW_NO_START_NODE`. Since #32273 registration refuses it, a stored one is never armed and its trigger answers `404`; the engine exit stays as a defensive path no door reaches (#32288)
