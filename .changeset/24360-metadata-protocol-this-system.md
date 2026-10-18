---
'@objectstack/metadata-protocol': patch
---

Clause-②: no

fix(metadata-protocol): the save door's lock refusals and its default-record-page refusal say "authored in this system"

- **What changed.** Three refusal texts said an item saved through the metadata API is "authored in this environment". They now say "authored in this system": the `protection`-block refusal, the lock-family-key refusal, and the holder text a default-record-page conflict prints for a page no package ships (`page 'NAME', authored in this system`). Inside the running system, user-facing copy names the system the user is in as "this system".
- **Unchanged.** Every error code (`VALIDATION_ERROR`, `DEFAULT_RECORD_PAGE_CONFLICT`), status and `issues[]` entry.
