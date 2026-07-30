---
"@objectstack/rest": patch
---

fix(rest): give the bare 501 error exits a machine `code` (#4067)

Most REST error exits already carry a typed `code` (`VALIDATION_FAILED`,
`BATCH_NOT_ATOMIC`, `BATCH_TOO_LARGE`, `PERMISSION_DENIED`), and the clone /
search 501s already answer `{ error, code: 'NOT_IMPLEMENTED' }`. Four 501 exits
still returned a bare `{ error: '<string>' }` with no code, so a client could
only key on the prose:

- the cross-object transactional batch route (`POST {basePath}/batch`) when the
  runtime has no `transaction()` — the last untyped exit on that route, whose
  siblings (`BATCH_NOT_ATOMIC`, `VALIDATION_FAILED`, the `enforceBatchSize`
  `BATCH_TOO_LARGE`) were already typed by the #3897 / #3933 / #3939 line;
- the two `saveMetaItem`-unsupported exits;
- the UI-view-resolution-unsupported exit.

Each now carries `code: 'NOT_IMPLEMENTED'`, matching the clone / search 501s.
Additive only — the `error` message is unchanged and no status changes — so
existing clients are unaffected; new ones can branch on the code.
