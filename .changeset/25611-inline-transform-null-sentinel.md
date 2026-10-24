---
'@objectstack/rest': patch
---

Clause-②: no
Metadata-protocol: none

`POST /api/v1/data/:object/import`: a cell the request declares null through `nullValues` now stays blank whatever case `transform` its inline mapping entry declares. The blank test reads the raw cell and a blank cell is not transformed, so an `uppercase` or `lowercase` entry no longer rewrites a sentinel such as `n/a` into a stored value (`N/A`): the cell is stored unset, takes the entry's `defaultValue`, or is refused by `required` as blank. A non-blank cell is transformed as before.
