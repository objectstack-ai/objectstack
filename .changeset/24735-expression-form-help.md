---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Field and object designer forms: the `expression` help text now states what the engine does instead of claiming the expression "makes it read-only". On a `formula` field the expression is computed on read with no stored column; on any other field the engine computes it from the row each write stores and stores the result, so a client-sent value never stands (only `readonly: true` makes a client value a readonly drop). The object designer's field grid now shows the `expression` row for every field type, as the field designer already did, since `FieldSchema` accepts `expression` on any type. The zh-CN, ja-JP and es-ES translations of both rows are updated to match.
