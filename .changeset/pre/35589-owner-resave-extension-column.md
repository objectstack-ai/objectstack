---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an unchanged owner object re-save is not refused over a column an extension adds

Clause-②: no
Metadata-protocol: none

Re-saving an object's own body unchanged (`PUT /api/v1/meta/object/NAME`, without `force`) while an enabled `object_extension` adds a stored column to it answered `409 DESTRUCTIVE_CHANGE`, naming the extension's column as one the save would drop. The destructive-change check compared the incoming body, which is the owner's layer alone, with the object as it is served, which carries every enabled extension's fields. On the dispatcher's `PUT /meta`, which takes no `force`, such an owner could not be saved at all while the extension was installed.

The check now folds the enabled extensions onto the incoming body before the diff, so it compares the object served before the save with the one served after it. A column an enabled extension still contributes keeps its data and is not reported. A column only the owner declares is still refused `409 DESTRUCTIVE_CHANGE` when the body drops it. The stored body is unchanged: it is still the owner's own layer, without the extension's fields.
