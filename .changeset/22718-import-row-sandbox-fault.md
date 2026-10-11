---
'@objectstack/core': patch
---

An import row for a sandboxed hook body that crashed, or that refused with a declared 5xx status, reads as a server fault instead of relaying the fault's text

Clause-②: no

When a hook body crashed during `POST /api/v1/data/:object/import` (or the async `/import/jobs` job), the row's `error` read `hook 'NAME' threw: TypeError: …`, and a hook refusal that declared a 5xx status relayed its own message. `POST /api/v1/data/:object` and `/createMany` answer both as server faults and withhold that text. The row now carries the same sentence those routes answer (`Internal server error`), and its `code` is unchanged: `IMPORT_ROW_FAILED` for a crash, the declared code for a declared 5xx. A hook refusal with no status or a 4xx status still reads in the hook's own words, and a database error's row text is unchanged.
