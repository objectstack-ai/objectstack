---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): "publish whole app" now says when an object's storage sync was refused

Clause-②: no
Metadata-protocol: none

`POST /api/v1/packages/:id/publish-drafts` (Studio's "publish whole app") ran each published object's storage sync and dropped the answer, so a batch whose object table was not created or altered answered a plain success; only the server log said so. That object's `published[]` element now carries the same `object-storage-sync-refused` warning on its existing `advisories` that a publish-mode save and `POST /meta/object/NAME/publish` answer since #30635. The status and every other key are unchanged, the publish is not failed, and an element whose sync ran carries no `advisories` key.
