---
'@objectstack/cli': patch
---

fix(cli): `os build` / `os compile` refuses a `views:` container whose own `name` disagrees with the object it binds to, and writes no artifact the server would refuse at boot (#20393)

Clause-②: no

A view container is registered under the object it binds to. When its own `name`
is set to something else, for example `{ name: 'order_line', object: 'my_app_order_line', list: { … } }`,
the server refuses the whole stack at boot. `os validate` has refused that stack
since #20331, but `os build` still exited `0` and wrote `dist/objectstack.json`
carrying the container, so `os serve` then refused the artifact it was handed.

`os build` now runs the same check `os validate` runs, right after the schema
check and before anything is written, and prints the message the server prints
at boot. The text form and `--json` both exit `1`, and no artifact is written. The
`--json` failure payload is `{ success: false, errors, warnings, conversions }`,
with one `errors` entry per refused container: `path` (for example `views[0]`, or
`packages[1].manifest.views[0]` in a multi-package stack), `code: 'VALIDATION_ERROR'`,
`httpStatus: 400` and `message`, the same rows `os validate --json` reports. A stack
the server accepts builds exactly as before, with the same output.

**Fix:** remove the container's `name`, or set it to the object name the message names.
