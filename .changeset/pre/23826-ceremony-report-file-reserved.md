---
'@objectstack/cli': patch
---

fix(cli): `os migrate organization-ownership --apply` refuses an `--out` it cannot write before it executes anything

Clause-②: no

**What was wrong.** The apply wrote its report file only after the ceremony had run, with an exclusive create. Handed an `--out` that already existed (a re-run with the same path), it executed every step (attribution, the id-to-name rewrite, mirror deletion, the column drops) and only then exited 1 with `apply_refused` / `report-file-unwritable`, the same `--json` code a refusal before any write prints. An operator read a completed ceremony as one that never ran.

**What an operator now sees.**

- An `--out` that cannot be written (an existing file, a directory that does not exist, no write permission) is refused before the database is opened: exit 1, `{"error":"apply_refused","reason":"report-file-unwritable","file":"FILE","code":"EEXIST",…}`, and nothing is executed. The existing file is left as it was. Re-run with `--out` naming a new path.
- The report file is reserved (created exclusively) before the boot, and the report is written into that same file at the end, so no other process can take the path in between. Until then the file holds a short JSON note (`"kind": "organization-ownership-apply-reservation"`) saying a run reserved it. A run that is refused, fails a step or cannot boot removes it again; a run killed before its report leaves that note behind, never an empty file.
- A report that still cannot be kept after the ceremony executed (a write error, or the reserved file removed while the run went on) gets its own code: exit 1, `{"error":"apply_report_unwritable","reason":"report-write-failed","executed":true,"report":{…}}`, with the full report in the payload. The text output still says "The ceremony ran". Re-run `--apply` with a new `--out` to write the report; finished steps are not repeated.
- Without `--out`, the default `organization-ownership-apply-TIMESTAMP.json` is stamped with the moment the run reserves it (before the boot), no longer with the moment the report was generated.

The plan run (without `--apply`) is unchanged: it changes nothing in the database, so writing its file last was never a hazard.
