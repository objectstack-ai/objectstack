---
'@object-ui/i18n': patch
---

feat(i18n): the Studio sharing-defaults overview's line and confirm for an object the AI assistant left unpublished changes on

Clause-②: no
Metadata-protocol: none

Two keys join the studio namespace in English and Chinese: `engine.studio.owd.aiDraftNotice`, the line an organization-wide-defaults row shows when the AI assistant (copilot or MCP) left unpublished changes on that object, and `engine.studio.owd.aiDraftDiscardConfirmUnsaved`, the confirm its discard asks when the row also holds an edit the person has not saved. Both name the whole object, since saving or discarding that row reaches the object's whole pending draft. No key is renamed or removed.
