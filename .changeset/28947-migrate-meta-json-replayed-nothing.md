---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta --json` says when no migration step ran

Clause-②: yes (widening)
Metadata-protocol: none

An empty range (`--from N` where `N` is already the highest major this build carries a step for, or `--from N --to N`) and an inverted one (`--from` above `--to`) replay no step. The human run has always warned that such a run "replayed nothing — that is not a finding that the metadata is canonical", but the `--json` answer looked exactly like a clean replay: `applied: []`, `todos: []`, `schemaValid: true`, exit 0. A script or CI step with a wrong `--from` was told its metadata had been migrated.

The `--json` answer now carries `replayedNothing` whenever no step ran:

- `reason`: `empty-range` when the range is well-formed but holds no step, `inverted-range` when `--from` is above `--to`.
- `widestRange`: the widest range this build carries from the same `--from` (`from`, `to`) and how many mechanical (`applied`) and manual (`manual`) changes it holds for this stack, or `null` when no wider range exists: `--to` already reaches the highest major, or `--from` is at or above it.

Both faces read the same answer, so the human run now also names an inverted range as inverted. A run that replays at least one step carries no `replayedNothing` member and its payload is unchanged, and the exit code is unchanged in every case: an inverted range is answered, not refused.
