---
---

Releases nothing — docs-only. The v17 upgrade checklist pointed kernel
importers of `MetadataExportOptions` / `MetadataImportOptions` at
`@objectstack/spec/system`; since #4538 deleted the zero-consumer system-side
bags, the correct source is `@objectstack/spec/contracts`. No package ships
from this change.
