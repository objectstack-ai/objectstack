# Audit: the verdict/exit-code split in the self-tests `check:merge-driver` chains

**Date**: 2026-09-18 · **Tree**: `objectstack-ai/objectstack` at
`0b31d90fb37d490d7da12c7acd4b14c4feb22501` · **Card**: #18166 · **Instrument**:
`scripts/ablation-replace.mjs`, unmodified, driving `node scripts/<file>.mjs --self-test` and
reading the child's **exit code** — the line it prints as `command exited N`.

**Answer: all three chained files are immune. Nothing was repaired, because nothing is broken.**
Ten firing controls fire and three discrimination controls reproduce the defect shape on the same
three files, so the immunity reading discriminates rather than merely failing to find anything.

## The population, re-derived from the script

`package.json:19` — not copied from the card, which said its own list is a hint:

```json
"check:merge-driver": "node scripts/git-env.mjs --self-test && node scripts/git-merge-regen.mjs --self-test && node scripts/check-regen-pending.mjs --self-test",
```

Exactly three files, in this order:

1. `scripts/git-env.mjs`
2. `scripts/git-merge-regen.mjs`
3. `scripts/check-regen-pending.mjs`

The re-derivation agrees with the card's hint. It is chained with `&&`, which is why the audit
matters at all: a zero from any one of them **is** the gate passing, so a file in the split makes
the whole battery advisory without saying so.

## The question, and why the exit code is the only reading

Per file: **is there any path on which the dispatch prints a failing verdict, or counts a failure,
while the process still exits 0?**

The output cannot answer it. That is the whole shape of the defect PR #18165 repaired in
`scripts/git-merge-regen.mjs`: the run printed `✗ merge driver wiring is inconsistent — N
failure(s)` and exited 0, because the code was set only inside `fail()` while the verdict line was
printed from a count of returned booleans. A reading taken from the text would have called that
run red. Only the exit code distinguishes it, and only the exit code is what `&&` consults.

## Baseline, before any mutation

| run | exit |
|:--|--:|
| `pnpm check:merge-driver` | **0** |
| `node scripts/git-env.mjs --self-test` | **0** |
| `node scripts/git-merge-regen.mjs --self-test` | **0** |
| `node scripts/check-regen-pending.mjs --self-test` | **0** |

## The exit sinks, enumerated per file

Immunity is a property of every sink, not of one, so each was ablated separately.

### `scripts/git-env.mjs` — two sinks, three failure signals

| sink | line | what feeds it | ablated as |
|:--|--:|:--|:--|
| `if (failures) { print ❌; process.exit(1) }` | 444–446 | the `t()` case registrar (`failures += 1` at 286) | **A1** |
| the same sink | 444–446 | the case floor `SELF_TEST_CASE_FLOOR` (`failures += 1` at 442) | **A3** |
| the dispatch's handshake refusal `process.exit(1)` | 462 | `selfTest()` returning anything but `SELF_TEST_VERDICT` (449) | **A4** |

The file has **0** `process.exitCode` sites. On a site count alone that reads as the defect; it is
not. `t()` prints the per-case line and increments the count in the same statement pair, and the
verdict line at 445 and the `process.exit(1)` at 446 are inside one `if (failures)` — one count,
one verdict, one code.

### `scripts/git-merge-regen.mjs` — two sinks (repaired by PR #18165)

| sink | line | what feeds it | ablated as |
|:--|--:|:--|:--|
| `fail()` → `process.exitCode = 1` | 624 | every callee's failure path; the floor-breach loop at 2010 | **B4** |
| `if (failures > 0) process.exitCode = 1;` | 2019 | the count of returned booleans at 2012 — the same count the verdict line is printed from | **B1**, **B3** |

Line 2019 is PR #18165's repair, and **B2** measures that it is load-bearing rather than
decorative: removing it restores exit 0 under a forced failure.

### `scripts/check-regen-pending.mjs` — one sink, three summands

| sink | line | what feeds it | ablated as |
|:--|--:|:--|:--|
| `if (failures > 0) { print ✗; process.exit(1) }` | 1859–1862 | the four declared callees' returned booleans | **C1** |
| the same sink | 1859–1862 | the two assertions written **inline** in the dispatch (`noDist` 1810, `noTree` 1812), which the battery roster deliberately does not cover | **C4** |
| the same sink | 1859–1862 | `floorBreaches` from `batteryFloorFailures()` (1850) | **C5** |

Six `process.exit(` spellings appear in the file; only three are executable statements
(1862, 1865, 1867) and one of those is inside a fixture string. The per-case printer at 1263 is
`check(label, cond)`, which pushes into `results` **and** prints from the same `cond` — so a
callee reporting failure by `return false` alone is counted, not merely printed.

## The matrix — 13 ablations, one mutation each

Every row: the mutation is landed and verified **on disk** (anchor hit exactly once, occurrence
counts and blob hash before/after), the dispatch is run, the child's exit code is read, and the
file is restored from `HEAD` with the restore proven by `blob == HEAD` and an empty
`git diff HEAD`. No `-i`-family editor was used, and no mutation was left in the tree.

| # | file | the mutation | reading | expected |
|:--|:--|:--|--:|:--|
| **A1** | `git-env.mjs` | one registered case reports failure | **1** | non-zero — fires |
| **A2** | `git-env.mjs` | the failing verdict line kept, the exit decoupled from the count | **0** | zero — discriminates |
| **A3** | `git-env.mjs` | case floor raised to 9999, so the floor summand fires | **1** | non-zero — fires |
| **A4** | `git-env.mjs` | `selfTest()` returns a value that is not the verdict | **1** | non-zero — fires |
| **B1** | `git-merge-regen.mjs` | `hookIsExecutable` reports failure by `return false` **alone** — no `fail()`, and it still prints its own `✓` | **1** | non-zero — fires |
| **B2** | `git-merge-regen.mjs` | a failure counted **and** the 2019 repair line removed | **0** | zero — discriminates |
| **B3** | `git-merge-regen.mjs` | the same forced count, 2019 left in place | **1** | non-zero — fires |
| **B4** | `git-merge-regen.mjs` | `registerCase('hookIsExecutable')` deleted, so the floor breaches through `fail()` | **1** | non-zero — fires |
| **C1** | `check-regen-pending.mjs` | `decisionTableSelfTest` returns false while every one of its own rows prints `✓` | **1** | non-zero — fires |
| **C2** | `check-regen-pending.mjs` | a failure counted, the failing verdict line still printed, the exit decoupled | **0** | zero — discriminates |
| **C3** | `check-regen-pending.mjs` | the same forced count, the exit branch intact | **1** | non-zero — fires |
| **C4** | `check-regen-pending.mjs` | the inline `noDist` assertion forced false | **1** | non-zero — fires |
| **C5** | `check-regen-pending.mjs` | `registerCase('decisionTableSelfTest')` deleted, so the floor summand fires | **1** | non-zero — fires |

B1 and C1 each read **2** failures rather than 1: both files' ambient-git-env battery re-enters the
whole `--self-test` in a child, and the mutated child fails too. That inflates the count, never the
colour, and the colour is the reading.

## Why the firing controls alone would not have settled it

"Exited non-zero" and "this harness cannot see an exit 0" produce the same ten rows. So each file
also carries a control in the **other** direction — the same forced failure with the count-to-exit
coupling removed — and all three printed a failing verdict and exited **0**:

```text
A2   ❌ git-env --self-test: 1 failure(s) [ABLATED: exit decoupled from the count]      exit 0
B2   ✗ merge driver wiring is inconsistent — 1 failure(s) (cases and floor); see above.  exit 0
C2   ✗ self-test failed -- 1 failure(s) [ABLATED: exit decoupled]                        exit 0
```

That is the card's defect, reproduced on each of the three files by this exact reading. So the ten
non-zero readings are an immunity measurement and not an instrument that cannot fail. B3/C3 pair
with B2/C2 on the same forced count and differ only in whether the coupling is present, which
isolates the coupling as the thing that makes the difference.

## What was deliberately not changed

- **No gate weakened and no exemption added.** Nothing in the three scripts changed at all. The
  card's acceptance holds trivially: there is no change that could turn a previously-red run green.
- **No shared verdict/exit helper.** The card raises one shared helper against three copies of
  `if (failures > 0)`, expressly as a judgement on measurements. The measurement says **zero** files
  need repair, so neither route earns itself: a refactor rewriting the verdict site of three working
  instruments would add risk with no defect to remove, and `check:merge-driver` is the gate that
  judges its own repair.
- **No permanent test file.** The ablation harness is throwaway by construction; this record is the
  durable artifact.

## Boundaries — what this audit does not say

- It is **not** the assertion-floor class. "A battery that never ran is indistinguishable from one
  that passed" is a different property, measured elsewhere
  (`docs/audits/2026-09-self-test-shape-census.md`, `scripts/measure-self-test-floor.mjs`).
  #13799 is not addressed here. A3/C5/B4 touch a floor only because each file's floor is a summand
  of the very count that sets the exit code, which is inside this card's question.
- It is **not** the handshake class either, except where a handshake *is* one of the exit sinks —
  `git-env.mjs` 462, ablated as A4. The other two files have no `selfTest()` function to hand back
  a verdict: their dispatch block **is** the verdict site.
- `main()` — the production `pre-commit` / `pre-push` path in `check-regen-pending.mjs` — is
  outside this population: `check:merge-driver` runs `--self-test` only. Its `✗` printers at 951
  and 957 increment the same `blocked` count that `decide()` turns into the returned exit status,
  read statically here and **not** ablated.
- **Linux only.** macOS was not measured. #16717 records `check:merge-driver` staying red there for
  unrelated reasons.
