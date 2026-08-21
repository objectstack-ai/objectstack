---
'@objectstack/cli': patch
---

`os doctor --scan-deprecations` no longer prescribes a command that does not exist. After listing its hits the report used to print ``Run `objectstack codemod v2-to-v3` to auto-fix``, but no `codemod` command has ever been registered — following the advice returned oclif's exit 2, `command codemod:v2-to-v3 not found`, after the operator had already spent time on it. The hint is not repointed at `os migrate meta` either: that command replays the protocol migration chain over an authored stack config and declines the source rewrite by design ("does not silently rewrite TS config source"), writing only an `--out` JSON snapshot, so it cannot fix the `src/**` TypeScript the scan reports on. It now names the count and the remedy that really exists — the per-finding replacement, printed under `--verbose`. The scanner is unchanged: same file:line attribution, same `→ replacement` detail, still advisory with exit 0 either way.
