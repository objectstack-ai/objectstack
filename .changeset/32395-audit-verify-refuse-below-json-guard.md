---
'@objectstack/cli': patch
---

fix(cli): `os audit verify` declares its refusal printer below the body that reads `--json` (#32395)

Clause-②: no
Metadata-protocol: none

A source reorder with no behaviour change: the private `refuse()` helper, which prints the human refusal to stdout only when `--json` is off, now sits below `verify()` instead of between `run()` and it. The nightly stdout tripwire (`diff-usage-error-stream.e2e.test.ts`) judges a command by line position and refused the old layout. Every refusal, its exit status 2 and both faces are unchanged.
