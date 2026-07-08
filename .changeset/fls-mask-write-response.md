---
"@objectstack/plugin-security": patch
---

Fix field-level-security read leak on mutation responses. The security
middleware only masked read-protected fields on `find`/`findOne` results, so a
caller with edit-but-not-field-read could `insert`/`update` a record and read a
read-protected field back out of the echoed post-image (field WRITES were
already blocked, but the response image was not masked). The mask now also
covers `insert`/`update` results, matching read behavior.
