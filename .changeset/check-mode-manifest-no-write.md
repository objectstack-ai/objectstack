---
'@objectstack/spec': patch
---

fix(spec): `build-schemas.ts --check` no longer writes `json-schema.manifest.json` (#4711)

The manifest ratchet had no `CHECK` discriminator. `check:authorable-surface`
(`build-schemas.ts --check`) — one of the eight generated-artifact gates
`check:generated` runs — recomputed the emitted schema set and, on any addition
or renamed-away key, **rewrote the tracked `json-schema.manifest.json` in place
and exited 0**. Two defects, one missing `if`:

1. **A check edited the working tree.** Whatever the file held locally was
   overwritten by a command whose entire job is to look, which is how a
   `git stash pop` / worktree / merge-conflict operation fails for a reason
   nobody traces back to a gate. It is also the #4675 merge-driver trap from the
   other side: run any check mid-merge and a manifest computed from a
   half-merged tree gets committed to disk — "a plausible generated file is an
   invisible error".
2. **The additions branch could never go red in CI.** Seven of the eight
   artifacts mean "stale ⇒ fail, run the generator"; this one meant "stale ⇒
   I'll write it for you", inside the same `check:generated` summary.

The ratchet is now isomorphic to the authorable-surface ratchet immediately
below it: in `--check` it prints the unrecorded keys and the `gen:schema`
remedy, then exits 1; outside `--check` it writes exactly as before. The
`missing` branch (a published schema disappeared) is untouched — it already
exited 1.

**Behavioural change for contributors:** adding a schema export without running
`pnpm --filter @objectstack/spec gen:schema` now fails `check:authorable-surface`
/ `check:generated` instead of being silently repaired. `check:generated --fix`
(and `check:docs`, which runs `gen:schema` first) regenerate it as before, so no
CI job changes shape — a clean checkout with a current manifest stays green.
No published API, schema or authorable key changes.
