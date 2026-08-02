---
---

Releases nothing — docs-only. Corrects the v17 upgrade checklist sentence that
still told upgraders `MetadataWatchEvent.type` carries the raw watcher values
(`add`/`change`/`unlink`); they were removed in #4536 with zero producers. No
package ships from this change.
