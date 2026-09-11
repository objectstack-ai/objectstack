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

**Measured population delta on this tree: 0 → 21 offenders**, among an
unchanged 211 duration-shaped numeric keys across 2433 source files. Every one
was read rather than pattern-matched; none is a detector false positive. Three
need only their describe corrected (the key name already carries `Ms`); the
other eighteen name no unit in the key either, so each is a rename of a
published key under an ADR-0087 conversion. ⛔ **No offender is exempted to
reach green** — there is no baseline here by ruling, and the remediation is
sequenced separately rather than hidden.

**Two wrongly-recorded reasons repaired, both comment-only.** The blindness did
not merely miss keys, it produced confident wrong prose about why they were
missed: the retired-key entry for `SandboxConfig:process.timeout` and the
burn-rate `window` pin comment in `metrics.test.ts` both said the neighbouring
key was "outside the gate's population", when it is inside the census and
outside the verdict — and its unit is not missing, only unpublished. Both now
say that and name the JSDoc unit. `registry.ts` regenerated to mirror the
entry; no pin assertion, title or body changed.

⛔ No published key, accept set, default or runtime behaviour moves.
