<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# Tenant-audit census — the write call site ledger (generated)

Every application-surface write call site against a tenancy-enabled object, as
`scripts/tenant-audit-census.mjs` derives it from the tree. **The prose, the
method and the deviations from the figures this replaced are on the page**
(`content/docs/permissions/tenant-audit-census.mdx`); this file has no prose to
preserve and is regenerated whole.

## Where the sites are

One file per package, under [`2026-08-tenant-audit-write-call-sites.counts/`](2026-08-tenant-audit-write-call-sites.counts/) —
`services/<package>.md` and `plugins/<package>.md`, for every package that holds
a write call site or a subtraction the census could not defend. Each shard
carries that package's totals and every one of its sites. ⛔ No total across
packages is committed anywhere, so two branches that each add a write call site
in a different package edit different files and merge apart.
`node scripts/check-tenant-audit-census.mjs` prints the census totals on every run.

⛔ **Never hand-patch a row or a number in a shard** — fix the code, or the census,
and regenerate. `scripts/check-tenant-audit-census.mjs` fails the build when a
shard and the tree disagree, when a package with sites has no shard, and when a
shard names a package the census finds nothing in.

Rows are aggregated by (file, verb, object, tenancy, context posture) and carry no
line numbers, so a pure displacement cannot move them. Run the generator with
`--json` for per-site `file:line`.

⚠️ **On a merge conflict in a shard, regenerate — never resolve by hand.** Two
branches that add a write call site in the SAME package produce a shard whose
rows can merge cleanly and whose totals merge cleanly and WRONG. These files are
NOT `merge=os-regen`: no `.gitattributes` row names them, so `git check-attr merge`
over them reads `unspecified`. Routing them would take a `REGEN_ARTIFACTS` row
whose `gen:`/`check:` names exist in the manifest that row declares as owner, and
no manifest declares such a pair for this census — the gate runs straight from
the lint workflow. The gate is the backstop — a wrongly merged shard fails
`check-tenant-audit-census`, so the error is loud rather than silent, and
`node scripts/tenant-audit-census.mjs --write` is the resolution.

## Subtractions the census could NOT defend — enforced

A same-named call on something that is not a data engine is subtracted, and the
subtraction is DEFENSIBLE when this census can name why: the receiver is a `node:`
builtin, a value it watched being constructed, a language global, a type THIS
corpus declares and the door rule rejected, or an `UNTYPED_RECEIVERS` row.

⚠️ Counted in every package shard are the subtractions it can name no such fact
for — the receiver carries a declared type the engine type index does not hold,
and that index is built from TRACKED sources only, deliberately. An untracked,
generated or dependency-owned declaration is one this census never saw, and
«never saw it» must not be spelled the same way as «read it, not an engine».

⚠️ One arm here says something else again: `type-text-not-round-trippable` is a
receiver whose declared type THIS TOOL derived and then could not read back —
the source parsed, the re-serialisation of it did not, so the door rule could
never be read off it. That is a fault in this tool rather than a fact about the
corpus, and it is the one arm here that also fails the gate.

⛔ A shard's door-shaped count is **0 by construction**, not a tally that happens
to be low. An inline type literal stating a write door has no name for the engine
type index to be keyed on, so the door rule is read off the type text itself and
the site is PLACED — it is in the population rather than subtracted. A non-zero
value there means a door-shaped receiver reached the subtraction anyway.

## Corpus scale — present and dated, ⛔ NOT enforced

⛔ These four describe the CORPUS this census walked, not the population it
certifies, and the gate deliberately does not hold them to the tree — a source
file arriving anywhere under the two roots moves them while every verdict
holds still. They are required to be HERE and to say WHEN they were true;
their values are not compared, and `--write` keeps them as committed until
`--write --refresh-scale` re-measures them. The reasoning, and the measurement
behind it, are in `scripts/check-tenant-audit-census.mjs`.

Measured on 2026-11-16 at `94cb58c3d`.

| corpus scale (not enforced) | count |
| :--- | ---: |
| tracked non-test sources scanned | 1186 |
| engine-shaped types recognised | 142 |
| declared objects in the registry | 137 |
| same-named calls subtracted as non-engine | 323 |
