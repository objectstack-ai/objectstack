---
"@objectstack/cli": patch
---

`os validate`'s summary now prints `UI: 0 Apps` instead of dropping the whole
`UI:` row when a stack declares zero apps (#10504).

Measured on the `blank` scaffold (`create-objectstack my-app -t blank`,
published 17.1.0, reproduced unchanged at this branch's head): a project with
no navigable UI and a project whose summary simply does not report on UI at
all printed identically — the `UI:` row was *absent*, not printed as `0`, so
a newcomer whose Console comes up empty had no way to tell which of the two
they were looking at. Both cases exited `0`.

`printMetadataStats` (`packages/cli/src/utils/format.ts`, shared by
`os validate`, `os info` and `os compile`) gains an opt-in `zeroFallback` per
summary section — the one item to force-print at `0` instead of dropping the
whole row when every item in that section is zero. It is set only on `UI`
(`Apps`), matching the triage ruling on #10504: the `blank`/`crud`/`full`
templates all ship zero apps deliberately, so a *warning* would fire on every
clean scaffold's first run. This is a legibility fix only — nothing about
what `validate` accepts, rejects, or exits with has changed, and `Data:`,
`Logic:`, `Security:` keep their existing drop-at-zero behavior (tracked
separately in #10952).

The `--json` path already reported `"apps": 0` explicitly at zero — no change
needed there; a separate, unrelated `--json` warnings gap is tracked in
#10953.
