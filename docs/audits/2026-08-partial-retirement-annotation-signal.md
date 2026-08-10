# Partial-retirement-annotation signal — corpus measurement (#6635)

**Measured at** `origin/main` `bf32d4a0ec1cebca4f636b26c040ad6903c54287` (2026-08-10).
`main` takes roughly 18 merges a day, so every number below belongs to that sha.

**Instrument**: `scripts/measure-partial-retirement-annotation.mjs`. Not a gate, not
wired into any workflow, not a `check:`/`gen:` script. Committed so the numbers are
reproducible rather than asserted.

**Mandate**: the maintainer ruling of 2026-08-09 on #6635 — measurement first, no gate
is built yet. This document reports total hits, a spot-verified true/false-positive
split, and the exemption count a warning-tier rule would need on day one. **It does not
select a decision branch**; the ruling reserves that.

---

## 1. The signal as implemented

For each (file, retired symbol): flag the file when at least one mention of the symbol
cites its retirement issue number and at least one other mention does not and does not
frame the symbol historically. Annotation-presence, never name-presence — which is what
lets a tombstone error string, whose whole job is to name the retired key, pass.

The annotation window is the **stanza**: a maximal run of lines with non-empty content
once comment furniture is stripped. In TSDoc that is the paragraph; in markdown it is
the paragraph.

Inventory (141 symbols) is the repo's own declaration surface — `RETIRED_DEFS_BY_MAJOR`,
`RETIRED_KEYS_BY_MAJOR` and the `retiredKey()` tombstone guidance strings — tiered by how
distinctive the name is:

| tier | what | example | count |
|---|---|---|---|
| A | retired def names | `ETLPipeline`, `WidgetManifest` | 45 |
| B | retired keys, qualified | `Manifest.loading`, `crypto.hash` | 81 |
| C | retired keys, bare | `transform`, `type`, `cursor` | 15 |

## 2. Positive control — the scanner is proven to see before any number is believed

The specimen fixes landed before this measurement, so the control was rebuilt from
history rather than read off `main`:

| tree | file | result |
|---|---|---|
| `4e271b2c6` (= the #6630 fix commit's parent) | `packages/spec/src/shared/retry-policy.zod.ts` | **FLAGGED** — `ETLPipeline`, cited at L30 (`#6414`), bare at L81 and L133 |
| `bf32d4a0e` (`origin/main`) | same file | **clear** — 0 hits |

That is the #6630 finding reproduced mechanically, and the expected direction in both
legs: red before the fix, green after it.

**Recall bound, measured on the same specimen.** #6630 landed in two parts. The signal
catches part 1 (PR #6701) and **structurally cannot catch part 2** (PR #6753): that site
had a single mention, phrased as prose (`an ETL pipeline's retry`) rather than as the
symbol name. The signal needs at least two mentions with at least one already annotated,
so it is blind both to single-mention drift and to the pure-miss case where a retirement
pass touched nothing in the file at all — the more common shape of a missed retirement.

## 3. Total hits

| scope | hits (file x symbol) | files |
|---|---|---|
| all tiers, no exclusions | **197** | **65** |
| tier A only | 42 | 10 |
| tier B only | 99 | 45 |
| tier C only | 56 | 22 |

Window sensitivity — the burden is not an artifact of the stanza choice:

| window | hits | files |
|---|---|---|
| stanza (default) | 197 | 65 |
| plus/minus 3 lines | 184 | 66 |
| plus/minus 6 lines | 179 | 56 |

## 4. True/false-positive split

**34 of 197 hits were verified by hand** (file opened, mention and its stanza read in
context). Sampling was not random: every hit in the residual set of section 5 was
verified exhaustively (20/20), plus 14 more drawn one-per-class from the record surfaces
and tier C, chosen to cover each structural class rather than to estimate a rate.

**Result: 0 true positives, 34 false positives.**

No hit was a retired symbol taught in the present tense as if it still existed. The
closest candidate — `packages/spec/docs/SYNC_ARCHITECTURE.md` L399, an
`import type { ETLPipeline }` — is the deliberate "Before" specimen of a migration
guide, in a plain fence rather than a `typescript` one, with the file stating in prose
that it must not compile.

## 5. What a warning-tier rule would emit on day one

Building the most generous structural exclusions into the rule itself — drop tier C
entirely, path-exclude every record surface (the two registries, `CHANGELOG.md`,
`.changeset/`, `docs/audits/`, `docs/protocol-upgrade-guide.md`,
`content/docs/releases/`) — leaves:

| rule shape | hits | files |
|---|---|---|
| all tiers, no exclusions | 197 | 65 |
| tier A+B only | 141 | 51 |
| **tier A+B, record surfaces excluded** | **20** | **16** |
| tier A only, record surfaces excluded | 8 | 5 |

**All 20 were hand-verified. All 20 are false positives.** So the day-one exemption
count for the best-case rule is **20 entries across 16 files, against 0 true positives**
— every warning it emits on the current tree would have to be exempted.

## 6. Structurally legitimate partial-citation classes

Five classes where partial citation is correct authoring, not drift. These are not
"files that happen to be noisy" — in each, annotating every mention would make the prose
worse.

1. **The retirement ledgers themselves** (62 hits / 2 files). `RETIRED_DEFS_BY_MAJOR`'s
   entries are bare string literals — `'ui/I18nObject',` — that can never carry an issue
   number, and the D2/D3 evidence strings enumerate the retired names by design
   (`'No source imports \`ServerEvent\`, \`ServerEventType\`, ...'`).
2. **Retirement pin tests.** A removal's pin test asserts the name is gone —
   `expect(name in httpServer).toBe(false)`,
   `expect(HookBodyCapability.options).not.toContain('crypto.hash')`,
   `it('rejects the retired \`body\` with the rename prescription')`. The name must
   appear bare, once per assertion. This is a genre the repo requires of every
   retirement.
3. **Migration guides with a "Before" specimen.** The retired shape must be spelled out
   un-annotated or the guide teaches nothing.
4. **Changelogs, changesets and generated projections** (74 hits / 34 files). Historical
   by construction: the release note that removed the symbol names it, and so do the
   earlier entries that introduced it.
5. **Annotated header plus enumeration stanza.** The repo's own correct pattern is a
   section header carrying `#NNNN` followed by a markdown table or bullet list naming one
   retired shape per row (`system/http-server.zod.ts` L198-215 is the model). Any
   stanza-scoped window splits the citation from the rows it governs.

## 7. Two detector-level defects found while building the instrument

Reported because they price the gate, not as findings against any file.

**a. Bare-key matching collides, including with other retirements.** Tier C keys —
`type`, `body`, `layout`, `multiple`, `transform`, `cursor`, `distinct` — are ordinary
words. Sharpest case: `distinct` was retired **twice by different issues**
(`query.distinct` at #4286, `AggregationNode:distinct` at #6815), so a paragraph
correctly annotated `#4286` reads as un-annotated when checked against `#6815`
(`content/docs/protocol/objectql/query-syntax.mdx` L102).

**b. There is no machine-readable retirement-to-issue mapping in the repo.** A gate
needs one as data. The registry tables are flat string arrays whose attribution lives
only in free prose above each group, and parsing that prose is wrong in two silent ways:
it picks the wrong number when a comment names several (the `transform` trio's header
reads "The first entries since #4659 built this table (#5552)" — #4659 built the table,
#5552 is the retirement), and it cannot see repo boundaries (the #6946 group cites
`objectui#3829` and `objectui#3818`, indistinguishable from local numbers once the
prefix is dropped). The mapping in the instrument is therefore hand-curated and stated
explicitly so it can be audited.

## 8. Reproducing

```bash
node scripts/measure-partial-retirement-annotation.mjs            # summary
node scripts/measure-partial-retirement-annotation.mjs --hits     # every hit with context
node scripts/measure-partial-retirement-annotation.mjs --tier A   # one tier
node scripts/measure-partial-retirement-annotation.mjs --window 3 # window sensitivity
node scripts/measure-partial-retirement-annotation.mjs --inventory # the 141 symbols
```

The positive control needs a tree at the pre-fix commit:

```bash
git worktree add --detach ../objectstack-6635-cmp 4e271b2c670a1262b83dc50450c1244639df6115
cd ../objectstack-6635-cmp
node <path-to>/scripts/measure-partial-retirement-annotation.mjs \
  --tier A --file packages/spec/src/shared/retry-policy.zod.ts --hits
```
