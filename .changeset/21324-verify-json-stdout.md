---
'@objectstack/cli': patch
---

fix(cli): `os verify --json` writes exactly one JSON document to stdout; the booted stack's log lines move to stderr (#21324)

Clause-②: no

`os verify --json > report.json` used to exit 0 and leave a file no JSON parser accepts. On a two-object stack that reaches the runtime stage, 318 lines landed on stdout ahead of the report: the kernel logger's `INFO` and `WARN` records, the ObjectQL registry's `[Registry] …` lines and the HTTP server's stop line. `JSON.parse` failed at position 4.

Under `--json`, stdout now carries the report and nothing else, and every other line the run writes goes to stderr. Nothing is dropped: the boot records, the warnings among them and the shutdown lines all still reach the operator, on stderr. The document is unchanged, and so is the shape of each of the three `--json` documents (the runtime report, the author-time refusal, and the could-not-run envelope).

`os verify` without `--json` is unchanged: the log lines stay on stdout beside the text report.

A script that read those log lines from `os verify --json`'s stdout now reads them from stderr.
