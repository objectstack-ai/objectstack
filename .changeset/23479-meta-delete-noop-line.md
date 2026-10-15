---
'@objectstack/cli': patch
---

fix(cli): `os meta delete` no longer prints "✓ Metadata deleted" when the reset door removed nothing (#23479)

Clause-②: no

**What changed.** The default (human) output of `os meta delete` now reads the reset door's `reset` flag, the same flag `--format json` and `--format yaml` already report as `deleted`. When the door answers `reset: false`, which means the delete's address held no row and nothing was removed, the command prints a warning line instead of the success line:

| Run | FROM (before) | TO (now) |
|:---|:---|:---|
| `os meta delete view x`, nothing stored | `✓ Metadata deleted: view/x` | `⚠ Nothing deleted: view/x — the server found nothing to delete` |
| `os meta delete view x --package P`, P holds no row of it | `✓ Metadata deleted: view/x` | `⚠ Nothing deleted: package 'P' holds no row of view/x` |
| `os meta delete view x --draft`, no pending draft | `✓ Pending draft discarded: view/x` | `⚠ Nothing discarded: view/x has no pending draft` |
| `os meta delete view x --draft --package P`, P holds no pending draft of it | `✓ Pending draft discarded: view/x` | `⚠ Nothing discarded: package 'P' holds no pending draft of view/x` |

**Unchanged.** When a row is removed (`reset: true`), the success line is the same as before, byte for byte. The exit code is `0` on both outcomes and on all three output formats, as before: a reset that removed nothing is a completed command, and the JSON and YAML outputs already report it as `success: true` with `deleted: false`. A script that needs to tell the two outcomes apart should read `deleted` from `--format json`, not the exit code. Failures (a refusal or a transport error) still exit `1`.
