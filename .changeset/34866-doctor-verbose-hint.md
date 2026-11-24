---
'@objectstack/cli': patch
---

fix(cli): `os doctor --verbose` no longer ends by telling you to run with --verbose

Clause-②: no
Metadata-protocol: none

When `os doctor` finished with warnings it always closed with "Run with --verbose to see fix suggestions.", including on a run that already passed `--verbose` and had already printed those suggestions. The line is now printed only when `--verbose` is off; a run without the flag reads exactly as before.
