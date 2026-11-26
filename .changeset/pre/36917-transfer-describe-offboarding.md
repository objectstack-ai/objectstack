---
'@objectstack/spec': patch
---

docs(spec): the `userActions.transfer` description names both things the switch decides, the Change Owner action and the offboarding hand-over

Clause-②: no
Metadata-protocol: none

The description of an object's Change Owner switch (`userActions.transfer`), in the published JSON schema and the generated reference docs, said the switch gates only the Change Owner action. On an object eligible for Change Owner it also decides whether the offboarding hand-over of a user's assigned work moves the object's `owner_id`: where an eligible object's switch resolves off, those records are counted as held and keep their owner. An `owner_id` the platform does not provide (an object the platform gives no owner column, declaring its own `owner_id` user field) is handed over like any other user field. The hand-over reads only the resolved on or off, not the per-record `visibleWhen`/`disabledWhen` predicates. The description now says so. No shape, accepted value or default changes.
