---
'@objectstack/driver-sql': patch
---

On a deployment whose media columns have not moved, the JSON-column filter refusal on a single-value file-class field (`file`, `image`, `avatar`, `video`, `audio`) now names the repair that works there: the media-column move, not `$contains`.

Clause-②: no

The filter is still refused with `INVALID_FILTER` / 400, for the same operators as before (`$eq`, `$in`, `$startsWith`, `$icontains`, the orderings and the rest of that set, and the bare `{ field: value }` spelling). Before, the refusal told the caller to use `$contains`, the membership repair for a multi-valued field. On a single-value file-class field `$contains` with the field's exact id answers no rows. The refusal now says that the field answers these operators again once the deployment finishes the media-column move (the column step of `objectstack migrate files-to-references --apply`), and it still names `$null` / `$empty`, which answer there. A multi-valued field keeps the `$contains` words, byte for byte. Once the media columns have moved, these filters are not refused, as before.
