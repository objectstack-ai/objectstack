---
"@objectstack/spec": patch
---

fix(spec): deleted authorable-surface baseline lines must prove themselves (#4650)

The authorable-surface ratchet's check (a) reads `authorable-surface.json` from
the same commit it is checking, so hand-deleting a baseline line deleted the
very evidence the check runs on — #4638 and #4643 both removed authorable keys
with zero registered conversions and a green gate, and #4662 proved the file
had been hand-edited. `gen:schema` (and `check:authorable-surface`) now anchor
deletions on the baseline at the **merge base with `origin/main`** — the one
version of the file a PR cannot rewrite (comparing against `HEAD:` would be
vacuous in CI, where HEAD is the PR's own commit) — and every deleted line must
carry one of three proofs, all computed inside the gate:

1. **Aged-out tombstone** — the base entry was `[RETIRED]` and its surface is
   registered in `CONVERSIONS_BY_MAJOR` / `MIGRATIONS_BY_MAJOR` at a major ≥ 2
   behind the current one (the "~two majors" the file's description has always
   promised, now enforced).
2. **Not reachable from the metadata-type roots** (2026-08-02 ruling on #4650)
   — BFS over the build's in-memory Zod graph from
   `BUILTIN_METADATA_TYPE_SCHEMAS` + the `EXTRA_METADATA_TYPE_SCHEMAS` overlay,
   with derived-clone bridging so `.refine()`/`.extend()` copies (e.g.
   `ViewSchema` inside `ViewMetadataSchema`) keep their originals protected.
   Over-collected entries (REST envelopes and other never-parsed defs) may be
   deleted without a tombstone; the exception waives only this file's
   requirement and is not a license to change the schema.
3. **The whole def left the build** — adjudicated by the
   `json-schema.manifest.json` ratchet (#2978) and `check:api-surface`.

`--check` additionally rejects any byte of `authorable-surface.json` that is
not the generator's own output (description/formatting hand-edits included,
per #4662); write mode regenerates such drift. Checks (a0)/(a)/(b) are
unchanged. Build-time gate only — no runtime export, schema shape, or
generated artifact changes.
