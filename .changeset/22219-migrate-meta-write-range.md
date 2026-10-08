---
"@objectstack/cli": patch
---

fix(cli): `os migrate meta --from N --write` rewrites the declared protocol range the load refuses (#22219)

Clause-②: no

The load refuses a manifest whose `engines.protocol` excludes the runtime's protocol major, and the refusal names `objectstack migrate meta --from N` as the command that resolves it. `--write` wrote the chain's mechanical changes and left `engines: { protocol: '^N' }` as it was, so an author who followed the refusal, wrote, and reloaded got the same refusal back. A manifest with nothing to convert was not written at all.

- `--write` now also rewrites the declared range when the load would still refuse the migrated source under it, in the scaffold's spelling: `'^16'` → `'^17'` on a protocol-17 runtime. It rides the same plan, write and re-check as the chain's changes: a range literal the command cannot trace to one site is left with the reason, and a re-check that disagrees restores it with every other file.
- A manifest with nothing to convert gets the range edit alone.
- The major is `--to`, capped at the protocol this runtime implements. `--to` defaults to the highest major this build carries a step for, which can run ahead of the runtime: on a protocol-17 build, `--from 16` replays 16 → 18 and writes `'^17'`.
- The range is rewritten under the key the load read it from: `engines.protocol`, else `engines.platform`, else the legacy `engine.objectstack` (written as `'^17.0.0'`, the only form that key accepts).
- Left alone: a range the load already admits, an absent or unrecognised range, a range at or above the target major, and a range below `--from` (the report names the `--from` that moves it).
- The dry run (no `--write`) names the range edit `--write` would make. With `--json`, `write.range` reports the edit: `status`, `path`, `from`, `to`, and `file` / `line` when written or `kind` / `reason` when left.
