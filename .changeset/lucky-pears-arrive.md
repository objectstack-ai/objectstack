---
'@objectstack/cli': patch
---

fix(cli): `--json` now owns stdout — kernel boot logs move to stderr (#6217)

Every `os migrate` / `os meta` subcommand that boots a kernel wrote its
machine-readable payload into a stream it shared with ~60 INFO lines. The
kernel logger routes `debug`/`info`/`warn` to stdout and only `error`/`fatal`
to stderr, so `os migrate recorded-by --json | jq .` failed with `parse error:
Invalid numeric literal` while stderr sat completely empty — a `--json` flag
whose only audience is a program, handing that program something it cannot
parse.

With this change, a `--json` run reserves stdout for its payload: everything
the kernel and its plugins write goes to **stderr** instead, including the
`[StandaloneStack] no compiled artifact …` notice that never went through the
logger at all. `JSON.parse(<entire stdout>)` now succeeds with no heuristic
extraction, and no diagnostic is lost — every line an operator used to see is
still printed, on the stream diagnostics belong on.

Covers the whole family that shares the boot seam: `os migrate plan` / `apply`
/ `resume` / `recorded-by` / `summary-nulls` / `value-shapes` /
`files-to-references`, `os migrate meta --stored`, and `os meta resync`.
Human-mode runs are unchanged.
