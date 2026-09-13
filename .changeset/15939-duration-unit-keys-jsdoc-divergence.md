---
'@objectstack/spec': patch
---

`check:duration-unit-keys` refuses a duration key whose JSDoc names a unit its describe does not

The gate read a key's unit from `.describe()` and `.meta({ description })` only.
A duration-shaped `z.number()` whose unit was written solely in the JSDoc block
above it appeared in `--list` as a census row with `[prose: -]` and was never
judged — and its own self-test pins *"a describe declared through
`.meta({ description })` is READ — no exemption by blindness"*, which made the
JSDoc blindness read as deliberate, measured coverage.

**Ruled 2026-09-07 (decision batch #65).** JSDoc is developer commentary, not
governed prose: `.describe()` is what `content/docs/references/**` renders and
what rides into the published dist, and the JSDoc stops at the source file. So
the gate does **not** start reading JSDoc as a unit channel — a unit written
only there still has not satisfied the rule. What it now refuses is the
DIVERGENCE: the JSDoc names a unit and the describe names none (or there is no
describe at all), so the two channels disagree about whether this number's unit
is written anywhere a reader can reach, and the channel that is silent is the
published one. New rule `unit-in-jsdoc-not-in-describe`; the remedy is to move
the unit into the describe, where the existing rule then puts it in the key
name.

⛔ **The JSDoc is read in exactly one direction: to refuse, never to satisfy.**
A duration-shaped key with no unit in *either* channel is still listed and
still not judged (the #14519 shape, unmoved). The new branch tests for a unit
PRESENT in the JSDoc; it never tests for one absent from the describe, which is
what would have made it the option the ruling declined.

**The population this rule adds was remediated before the rule landed.** When
the gate was written it found **21** offenders. Ruling A on #15939 sequenced
those out of this change and into seven per-file cards (#17780–#17786), all
merged: eighteen were renames of published keys, each carrying its own ADR-0087
conversion and `retiredKey()` tombstone, and the other three needed only their
describe corrected. On this tree the gate reads **zero offenders** among **211**
duration-shaped numeric keys across **2482** source files (6 declared `EpochMs`
instants, 11 declared `externalVocabulary` mirrors). ⛔ **No offender was
exempted to reach that zero** — there is no baseline in this gate by ruling, and
none was added.

**One wrongly-recorded reason repaired, comment-only.** The blindness did not
merely miss keys, it produced confident wrong prose about why they were missed:
the retired-key entry for `SandboxConfig:process.timeout` said the neighbouring
`RuntimeConfig.resourceLimits.timeout` was "outside the gate's population", when
that key was inside the census and merely never judged — its unit lived in a
source JSDoc only. That note now records the true reason, and points at the
neighbour's own entry rather than describing a landed rename as pending.
`registry.ts` regenerated to mirror it. The same wrong reason in the
`metrics.test.ts` burn-rate pin was corrected by #17783 when it renamed that
key, so nothing is owed there.

⛔ No published key, accept set, default or runtime behaviour moves.
