---
'@objectstack/skills': patch
---

docs(skills): the object `enable` capability table names `aiReadable`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/SKILL.md` gains one row in the Object Capabilities (`enable`) table: `aiReadable` opens read-only AI access (query, get one, aggregate, describe, list; never a write) on a platform `sys_*` object, never on the stored-metadata family (`sys_metadata`, `sys_metadata_history`). An app object never declares it: any declared value, `false` included, is refused at parse (`aiReadExposureRefusal` in `@objectstack/spec/data`). No schema or runtime change.
