---
'@objectstack/cli': patch
---

fix(cli): `os lint --item` points at the draft publish verdict, not at publishing

Clause-②: no
Metadata-protocol: none

The `os lint --item` text output ended its list of rules that need the rest of the stack with "Run `os lint` on the project, or publish the draft, for those." Publishing makes the item live. The line now names `os meta register <type> --data <file> --mode draft --package <id>`, filled with the item's type and file, which shows the full publish verdict while nothing goes live, beside `os lint` on the project. The `--json` output is unchanged.
