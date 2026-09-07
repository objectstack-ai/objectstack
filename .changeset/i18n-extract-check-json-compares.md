---
"@objectstack/cli": minor
---

`os i18n extract --check --json` now COMPARES. It used to exit 0 having compared nothing, on a tree whose bundles had provably drifted.

The machine face returned before the comparison ran: `if (flags.json) { … return; }` sat ahead of both the `--check` needs-`--out` guard and the comparison block. Driven on one fixture, two invocations differing only by `--json` — the first exited 1 with `missing: OUT/zh-CN.objects.generated.ts` and `Translation bundles have drifted from the schema`, the second exited 0 with the ordinary extract payload. The first run is the second one's positive control: the drift was really there. Same shape as the `--dry-run` branch repaired one release earlier, and `--json` is if anything the more likely CI spelling of the two, because a pipeline that wants to parse the result reaches for it.

⚠️ **A pipeline that runs `os i18n extract … --check --json` and was green may now go red, and that is this repair working.** The green was a comparison that never happened; the red is the drift that was already in the tree. The fix is the one the failure names — re-run the same command without `--check` and commit what it writes.

What each invocation now does, with no new member on any published payload:

- **drift found** — the run ends on this command's existing `{ "error": … }` envelope with exit 1, carrying the same sentence the console face prints, the regenerate-and-commit command included. Deliberately not a new `drift` / `missing` / `stale` payload member: every other way this command can fail already speaks that envelope, and naming the drifted files in the machine payload would widen a published output face.
- **in sync** — unchanged: the ordinary extract payload, exit 0.
- **`--check` with no `--out`** — the refusal is now reachable under `--json` too, in the same `{ "error": … }` envelope with exit 1. It used to exit 0 with a payload, having been asked for a comparison it could not make.
- **`--json` without `--check`** — unchanged in every respect.

The run leaves through exactly one of those faces, so stdout still parses as exactly one JSON document.

Graded `minor` rather than `patch` because the PM's clause-② ruling on this card reads the reuse of the existing envelope on a newly reachable path as a widening of the published output face; the maintainer's 2026-09-04 rule puts an already-declared widening at `minor` at least. Nothing an author can write is removed, renamed or narrowed here, and the failure prescribes no consumer code change — so no `**BREAKING**` banner and no ADR-0087 disposition ride along.
