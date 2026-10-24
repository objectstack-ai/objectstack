---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/rest': minor
---

feat(spec,core,rest): an import column can be written only when its row is created (`applyOn`), and `matchFields` takes ordered key sets

Clause-②: yes (widening)
Metadata-protocol: added

Two additions to the import contract (`POST /data/:object/import` and the async import job), both honoured by the import runner:

- **`FieldMappingEntry.applyOn: 'create' | 'always'`** (default `always`, today's behaviour). An inline mapping entry marked `create` is written when the import creates the row and left out when an `upsert` updates an existing one; an `update` import never writes it. One upsert can then be re-run safely: master-data columns refresh, while a column the app has changed since the first run (a status, a flag) keeps its current value. A create-only column is still read for matching, and the key a row was found by stays in that row's update. An `applyOn` value outside `create` / `always` refuses the request with `400 INVALID_REQUEST`.
- **`matchFields` accepts ordered key sets** (`string[][]`) beside one key set (`string[]`, unchanged). Each row is matched by the first set whose fields are all non-blank on it, and only by that set, so one sheet can identify domestic suppliers by `credit_code` and overseas ones by `country` + `registration_no`. A row blank on every set fails with `BLANK_MATCH_KEY` (`ok: false`, `action: 'failed'`) instead of being created or skipped; `skipBlankMatchKey: true` with key sets is refused with `400 INVALID_REQUEST`, as are malformed key sets (an empty set or name, or names mixed with sets). A set that matches more than one record fails the row with `AMBIGUOUS_MATCH`, as before.

```json
{
  "writeMode": "upsert",
  "matchFields": [["credit_code"], ["country", "registration_no"]],
  "mapping": [
    { "sourceField": "Code", "targetField": "credit_code" },
    { "sourceField": "Country", "targetField": "country" },
    { "sourceField": "Reg. no.", "targetField": "registration_no" },
    { "sourceField": "Name", "targetField": "name" },
    { "sourceField": "Status", "targetField": "status", "applyOn": "create" }
  ]
}
```

`@objectstack/spec` also exports `isMatchKeySets(matchFields)`, which tells the two `matchFields` spellings apart. `RunImportOptions` in `@objectstack/core` gains `createOnlyFields` and accepts both `matchFields` spellings.
