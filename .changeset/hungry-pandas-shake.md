---
'@objectstack/cli': patch
---

`os validate` no longer drops a summary section that happens to be empty — every section prints its zero state

The metadata summary shared by `os validate`, `os info` and `os compile` skipped any section whose every item was `0`. #10504 fixed that for `UI:` only; `Data:`, `Logic:` and `Security:` still vanished. Measured against the real CLI: a stack with one object and nothing else printed `Data:` and `UI: 0 Apps` and no `Logic:` or `Security:` line at all, so "this project declares no automation" was indistinguishable from "this summary does not report on automation". A stack declaring no objects printed the single line `UI: 0 Apps`.

All four rows now always print, in the shipped `UI: 0 Apps` shape: `Data: 0 Objects`, `Logic: 0 Flows`, and `Security: 0 Positions  0 Permissions` (both peers — `Security:` has no single canonical signal the way `UI:` has `Apps`).

Patch, not minor: no API, flag, exit code or `--json` payload changes — this is the human-readable summary printing rows it previously omitted. Anything scraping the text summary for the absence of a section row will now see it present.
