---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(spec): `spec-changes.json` ships a per-release section, verified against both tarballs (#17080)

Clause-②: yes (widening) — one new OPTIONAL section on a published artifact plus one new
`os validate --json` key. Nothing previously present is renamed, retired or reshaped: the
`aggregate` and `perMajor` records and every existing key keep their spelling and meaning.
Contract-review tier.

`spec-changes.json` (ADR-0087 D4) is keyed to the **protocol major**, while this repo's
launch-window convention ships BREAKING entries as **minors**. A consumer crossing one minor
therefore reads a file whose finest question is "16 → 17" — answered long ago — with
`added: 0, removed: 0`, which reads as *nothing changed*. Measured on the published tarballs:
between `@objectstack/spec@17.3.0` and `17.4.0` the export surface gained **225** exports and
lost **51**, and the shipped manifest reported zero of each.

**What ships now.** The published artifact carries a `release` section — `fromVersion` →
`toVersion` at package-version resolution, with `added` / `removed` (the exports that arrived
and left, each named `"<entry>: <name> (<kind>)"`) and `converted` / `migrated` (the ADR-0087
D2/D3 entries first registered in that release):

```bash
jq '.release | {fromVersion, toVersion, added: (.added | length), removed: (.removed | length)}' \
  node_modules/@objectstack/spec/spec-changes.json
os validate --json | jq .specReleaseChanges      # the same data, via the CLI
```

**The committed copy is unchanged and stays deterministic.** The section is a function of a
previously *published* tarball, so it is generated at publish time only; `check:spec-changes`
keeps the registry-only projection in the tree exactly as it was.

**A wrong change file is worse than none, so it is gated.** Before anything reaches npm the
release lane recomputes the delta from the two tarballs — the previously published one and the
one about to be published — and refuses to publish when the section disagrees, naming the
disagreeing exports and the direction of each disagreement. A release whose data would mislead
does not ship.

**Absence stays distinguishable from zero.** When the previous tarball carries no export
snapshot the section is omitted rather than emitted empty, and `specReleaseChanges` is `null`
in exactly that case: a consumer must never read "could not be computed" as "nothing changed",
which is the defect this closes.

New public exports on `@objectstack/spec`: `SpecReleaseChangesSchema`,
`SpecReleaseSurfaceSchema`, `composeReleaseChanges`, and the types `SpecReleaseChanges`,
`SpecReleaseSurface`, `PreviousReleaseRegistries`, `ReleaseSurfaceDiff`.
