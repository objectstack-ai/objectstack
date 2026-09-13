---
"@objectstack/cli": minor
---

fix(cli): `os migrate meta --from N` — the invocation every tombstone prescribes — lists the conversions it was sent to list, and an empty range stops reading as success (#17134)

`--to` defaulted to `PROTOCOL_MAJOR`, the major the runtime implements. But retirements land throughout a major's line, and their ADR-0087 conversions are registered under the NEXT one: `@objectstack/spec@17.4.0` tombstones `dashboard.refreshInterval` while the conversion that renames it is `toMajor: 18`. The `retiredKey()` house sentence names the major the source was **authored** against — `Run \`os migrate meta --from 17\` …` — so the prescribed invocation composed the range `17 → 17`, which `composeMigrationChain` selects **no step** for, and the command answered:

```
✓ Nothing to migrate — the metadata is already canonical for this range.
```

exit 0, printed immediately under the five refusals that named that exact command. **29 shipped tombstones across 15 source files prescribe it.**

Two changes, both in `packages/cli`:

- **`--to` now defaults to the highest major this build of `@objectstack/spec` carries a migration step for** (`Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS)`), so the tombstone template's presumption holds in every window rather than only after the next major has shipped. Nothing is migrated "past" the runtime: every registered conversion maps a shape the installed schemas already **refuse** onto the one they accept, which is why the terminus is the only target for which the command's own `schemaValid` verdict is reachable. `Math.max` keeps the runtime's major as the floor for the reverse case.
- **A range holding no step is answered as one.** `already canonical` was a green verdict on a check that never ran, so the empty-range case now says so, names the range that would list the conversions (`--to N`), and no longer returns past the schema verdict that contradicted it — the same run used to report `schemaValid: false` in `--json` while the human output claimed the metadata was canonical and stopped.

**What changes for you.** `os migrate meta --from <your major>` with no `--to` now replays one hop further than it did, so a cross-major run prints that hop's semantic TODOs as well — the same wall a `--from N-1` run has always printed, one major on. The mechanical rewrite list is still first. `--to` is unchanged when you pass it, `--stored` is untouched, exit codes are unchanged (this command reports findings, it does not exit on them), and a range that holds real steps and rewrote nothing still answers `Nothing to migrate`.
