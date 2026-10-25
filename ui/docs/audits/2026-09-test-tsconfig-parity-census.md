# Audit: test-`tsconfig` parity census across the workspace (2026-09)

**Question** (objectui#8714): the repo has found **three** per-package `tsconfig`
divergences — each by a developer tripping over it, none by any instrument. How many
packages differ, on how many axes, with how many distinct values each?

**Why it exists**: the card that triggered this named one instance —
`plugin-timeline/tsconfig.test.json` omits `@testing-library/jest-dom` from
`compilerOptions.types` while `plugin-map`'s names it, so a jest-dom matcher there is
**green under vitest and `TS2339` under `tsc`**. Its own reading was that the tractable
card is not *"add jest-dom to plugin-timeline"* but *"nothing asserts that sibling
packages' test type-programs agree."* That question is unanswerable without this number,
and nobody had it.

⛔ **This audit changes no `tsconfig`, adds no gate, and rules nothing.** Some
divergences are deliberate and load-bearing — one of them is measured below. Normalising
them would be a repo-wide behaviour change dressed as tidying. What lands with this audit
is the *instrument*: `scripts/tsconfig-test-parity-census.mjs`
(`pnpm census:tsconfig-test-parity`), report-only, re-runnable.

**Instrument**: TypeScript's own config resolver
(`ts.getParsedCommandLineOfConfigFile`), so `extends` chains are flattened the way `tsc`
flattens them, and every reading below is taken from the *resolved* program rather than
from the config text.

**Precondition**: every `tsc -p` reading here was taken with the dependency closure
**built** (`pnpm build`, 43/43 tasks green). An unbuilt tree gives `TS2307` for every
workspace import and makes all 38 type-programs look broken in the same way — a
precondition, never a result.

---

## Summary

| | |
| --- | --- |
| test type-programs in the workspace | **42** |
| …with a dedicated `tsconfig.test.json` (this census) | **38** |
| …that fuse tests into the package's ordinary `tsconfig.json` | **4** |
| program root files across the 38 | **2,477** |
| of the 38, compiling green today | **38 / 38** (measured, exit 0, 0 errors each) |
| divergent axes across all 38 | **23** |
| behavioural axes within the 35-package sibling cohort | **4** (`types`, `lib`, `include`, `exclude`) |
| distinct values on those four | 6 / 4 / 3 / 2 |
| **live cost already paid, in workarounds** | **2 sites** — see *Already paid* |
| **files typed only by leakage from another file** | **83** |

⭐ **The headline**: it is not *"two packages differ on one key"* (three one-line fixes and
a note). It is **35 sibling packages, four behavioural axes, no axis with fewer than two
values and one with six** — plus two ambient-type routes that are **not in any `tsconfig`
at all**, which is why three separate cards each found "the" divergence and none of them
found the set.

---

## Population, and proof it is not empty

```
$ pnpm census:tsconfig-test-parity | head -1
# test-tsconfig parity census — 38 projects, 2477 program files
```

38 files, discovered from disk (`packages/*`, `apps/*`, `examples/*`), not from a list —
a list is a thing to forget, and a package outside the census reads exactly like a package
that agrees with its siblings. A census that reads zero because its glob is wrong is
indistinguishable from a uniform repo, so the script **exits non-zero on an empty
population** and `scripts/__tests__/tsconfig-test-parity-census.test.ts` runs that leg.

**Two cohorts**, and the split matters because it explains 19 of the 23 axes:

| cohort | n | `extends` | note |
| --- | --- | --- | --- |
| **A** | 35 | `../../tsconfig.json` (repo root) | the real sibling comparison |
| **B** | 3 | its own package `tsconfig.json` | `examples/console-starter`, `examples/schema-catalog`, `packages/vscode-extension` — a different base, so they diverge on 24 axes among themselves; not comparable to A |

**The 4 fused programs** (no `tsconfig.test.json`; tests compiled by the package's build
config, under the build's options) are a structural axis in their own right:

| package | test files | `types` | `lib` |
| --- | --- | --- | --- |
| `apps/console` | 93 | `["vitest/globals", "@testing-library/jest-dom"]` | `[ES2020, DOM, DOM.Iterable]` |
| `packages/data-objectstack` | 60 | `["node"]` | inherited `[ES2020, DOM, DOM.Iterable]` |
| `packages/cli` | 16 | *unset* | `["ES2020"]` — **no DOM** |
| `packages/test-support` | 5 | `["node", "vitest/globals"]` | inherited |

`vitest/globals` appears in exactly **2 of the 42** programs. `apps/console` extends
nothing at all.

---

## The matrix — cohort A (35 sibling packages)

### 1. `compilerOptions.types` — 6 effective values (7 spellings)

| value | n | packages |
| --- | --- | --- |
| *unset* | 11 | collaboration fields mobile plugin-designer plugin-editor plugin-markdown **plugin-timeline** plugin-tree providers react-runtime sdui-parser |
| `["node"]` | 9 | core create-plugin layout permissions plugin-dashboard plugin-detail plugin-gantt plugin-list types |
| `["node", "@testing-library/jest-dom"]` | 7 | auth components i18n plugin-chatbot plugin-form plugin-grid react |
| `["@testing-library/jest-dom", "node"]` | 6 | plugin-calendar plugin-charts plugin-kanban **plugin-map** plugin-report plugin-view |
| `["node", "vite/client", "@testing-library/jest-dom"]` | 1 | app-shell |
| `["node", "vite/client"]` | 1 | runner |

The last two spellings are the same set in different order — the census normalises sets,
so those two rows are **one** effective value, and 6 is the honest count.

**`types` is a switch, not a list**: naming it at all turns OFF automatic `@types/*`
inclusion. So *unset* and `["node"]` are not "one has jest-dom, one does not" — they are
two different mechanisms.

### 2. `compilerOptions.lib` — 4 effective values

| value | n | packages |
| --- | --- | --- |
| `[ES2020, DOM, DOM.Iterable]` | 27 | (the rest) |
| `[ES2022, DOM, DOM.Iterable]` | 4 | app-shell components mobile plugin-list |
| `[ES2020, DOM]` | 3 | i18n plugin-form types |
| `[ES2022, DOM]` | 1 | plugin-grid |

**6 of the 38** programs are on ES2022. That number matters — see *Already paid*.

### 3. `include` — 3 effective values

| value | n |
| --- | --- |
| `["src/**/*.test.ts", "src/**/*.test.tsx"]` | 28 |
| `+ "src/**/*.d.ts"` | 6 — auth components plugin-charts plugin-dashboard plugin-grid plugin-map |
| `+ "src/**/*.bench.ts"` | 1 — core |

### 4. `exclude` — 2 values

Unset in 34; `["src/browser-process-shim.d.ts"]` in `components`.

### Same program, different spelling (reported, not counted as divergence)

`composite` (`false` ×32 / unset ×3) and `declaration` (`false` ×11 / unset ×24). Both
default to `false` in TypeScript, so the two spellings compile identically. The census
prints them marked `[same program, different spelling]` rather than hiding them, because
"why does my package say this and my neighbour's not" is a real question with a boring
answer.

### Uniform across cohort A (the good news)

`strict`, `module`, `moduleResolution` (`bundler`), `target` (ES2020), `jsx` (`react-jsx`),
`paths` (`{}` — every sibling drops the root source-tree paths so `@object-ui/*` resolves
through built `.d.ts`), `noEmit`, `skipLibCheck`, `isolatedModules`, `resolveJsonModule`,
`baseUrl`, `noUnusedLocals` (`false`), `noUnusedParameters` (`true`),
`useDefineForClassFields`.

---

## The two axes that are not in any `tsconfig`

This is the part a `diff` of the config files cannot produce, and it is why the card's
framing ("nothing compares them") was right about the *problem* and incomplete about the
*surface*.

### Route 3 — jest-dom typed by a side-effect import in a **different file**

`import '@testing-library/jest-dom'` is a global augmentation. Once **any** file in the
program has it, the matchers are typed for **every** file in that program. So a package
can be green with no `types` entry and no import of its own.

| package | `types` names jest-dom | files using matchers | files importing it | **files typed only by leakage** |
| --- | --- | --- | --- | --- |
| `plugin-detail` | no (`["node"]`) | 55 | 24 | **40** |
| `plugin-dashboard` | no (`["node"]`) | 37 | 22 | **16** |
| `fields` | no (*unset*) | 86 | 93 | **15** |
| `plugin-list` | no (`["node"]`) | 22 | 14 | **12** |

**83 files** across four packages compile today because a *different* file imports
jest-dom. Deleting the last importing file from `plugin-detail` turns 40 files `TS2339` in
one commit, and nothing in the package names the dependency.

### Route 4 — Node globals from a `/// <reference types="node" />`

`sdui-parser` and `react-runtime` both leave `types` **unset**. Measured with a probe file
(`const _x: string = process.env.NODE_ENV ?? '';`) compiled by each project:

```
react-runtime  TS2591: Cannot find name 'process'.
sdui-parser    (clean)
```

`--explainFiles` names the cause:

```
node_modules/.../@types/node/index.d.ts
  Type library referenced via 'node' from file
  'packages/sdui-parser/src/__tests__/dashboard-widget-options-census.test.ts'
```

One triple-slash directive on line 1 of one test file types Node globals for the whole
package. **`sdui-parser` is the only one of the 38 whose Node types arrive this way.**
Probed across all 11 `types`-unset projects plus two `["node"]` controls: 10 have no Node
globals, `sdui-parser` has them, both controls have them (control lit).

---

## Already paid — LIVE vs LATENT

A divergence matters only where code depends on it. Both known axes are **LATENT for
compilation** (all 38 programs are green) and **LIVE as workaround cost** — which is the
expensive kind, because the cost is invisible in CI.

| axis | status | evidence |
| --- | --- | --- |
| jest-dom in `plugin-timeline` | **LATENT** — 0 of its 26 program files use a matcher | but **paid**: `ObjectTimeline.expandFls-7429.test.tsx:147` uses `expect(...).toBeTruthy()` with a comment, from PR #8713, *because* the matcher would not type-check |
| `lib` ES2020 | **LATENT** — of the 20 `.at(` matches inside ES2020 programs, 6 are comments and the other 14 sit on `any`-typed receivers (`makeAdapter()` returns `as Record<string, any>`), so none is a real `TS2550` | but **paid**: **5 comment sites in `plugin-designer`** documenting index arithmetic written instead of `.at(-1)` |
| ambient `.d.ts` in `include` | **LATENT and deliberate** | see below |

**Control leg for the `lib` reading** — a zero-hit sweep is evidence only if a lit control
fires. A probe file added to `plugin-timeline`'s program with a genuinely typed array:

```
packages/plugin-timeline/src/zzprobe.test.ts(5,15): error TS2550: Property 'at' does not
  exist on type 'number[]'. … Try changing the 'lib' compiler option to 'es2022' or later.
packages/plugin-timeline/src/zzprobe.test.ts(9,16): error TS2339: Property
  'toBeInTheDocument' does not exist on type 'Assertion<HTMLDivElement>'.
```

Both fire. So the sweep's zeros are readings, not blindness — and the card's `TS2339`
claim reproduces exactly.

⚠️ **One of the paid workarounds encodes a false belief.**
`plugin-designer/src/__tests__/DashboardEditor.i18nTitle.test.tsx` states:

> `.at()` type-checks **nowhere in this repo** even though every runtime it ships on has it.

**6 of the 38 programs are on ES2022**, where it does. That comment is what the absence of
a census costs: a developer generalised correctly from their own package and wrote the
generalisation into the tree as documentation.

---

## Deliberate or accidental — and why you cannot tell by reading

| divergence | verdict | reason |
| --- | --- | --- |
| `permissions` omits jest-dom | **deliberate** | its config says so: *"nothing here needs the jest-dom matchers, which these suites do not use"* |
| `app-shell` raises `lib` to ES2022 | **deliberate** | its config says so, and says why it was raised there and not in the package build config |
| `plugin-map` includes `src/**/*.d.ts` | **deliberate** | its config explains the `TS2882` on a CSS side-effect import |
| `plugin-view` / `plugin-report` **exclude** their `src/global.d.ts` | **deliberate — but undocumented, and only discoverable by measurement** | adding `src/**/*.d.ts` to `plugin-view`'s `include` (the shape 6 siblings carry) turns it **RED with 7 errors**: its `global.d.ts` declares `const process`, which collides with `@types/node`'s. The exclusion is load-bearing; nothing says so |
| `auth`, `plugin-charts`, `plugin-grid` include `src/**/*.d.ts` | **accidental (inert)** | those patterns match **zero files on disk**. Copied along with the config |
| `composite: false` / `declaration: false` present in some, absent in others | **accidental (inert)** | identical program either way |
| `plugin-timeline` omits jest-dom | **inconclusive — and that is the finding** | it does not name `types` at all, so it is not "the sibling that forgot a line"; it is one of 11 packages using a different mechanism |
| `sdui-parser` gets Node types from a triple-slash | **accidental** | no sibling does it; the directive is on line 1 of one file and nothing points at it |

⭐ **The generalisable result**: three of these eight needed a `tsc` run to classify. **You
cannot read deliberate-vs-accidental off the config text.** That is the strongest argument
for an instrument and the strongest argument against normalising by hand.

---

## The one-line fix, and why it was not made

objectui#8714 authorised adding `@testing-library/jest-dom` to `plugin-timeline` **only
if** the census showed the omission accidental — *"its siblings uniformly name jest-dom
and nothing explains the exception."*

**The condition fails.** 21 of 35 cohort-A siblings do not name it; `permissions`
documents its omission on purpose; `fields` uses matchers in 86 files with `types` unset
entirely. There is no uniform sibling practice for `plugin-timeline` to have deviated
from — it is a data point in the matrix, not a bug. **No `tsconfig` was edited.**

Measured, for whoever rules on it (each leg run against a probe file using
`process.env`, restored after):

| plugin-timeline `types` | result |
| --- | --- |
| *unset* (today) | jest-dom matchers `TS2339`; `process` `TS2591` |
| `["@testing-library/jest-dom"]` — the literal one line | matchers type-check; `process` still `TS2591` |
| `["node", "@testing-library/jest-dom"]` — the shape 7 siblings use | matchers type-check; `process` resolves; project green |

If triage rules "fix the instance", the third row is the shape to use, not the first.

---

## Proposed gate — ⛔ NOT implemented here

If triage wants one, this is what it should assert. Implementing it is a separate card.

**It should not assert uniformity.** Four of the eight rows above are deliberate, and a
gate that flattens them is the repo-wide behaviour change this audit refused to make.
What it can assert without ruling anything:

1. **Every divergence is declared.** A `tsconfig.test.json` whose effective value on a
   listed axis (`lib`, `types`, `include`, `exclude`) differs from the cohort's modal
   value must carry a comment on that key. `permissions`, `app-shell`, `plugin-map`
   already pass; `plugin-view`'s load-bearing `d.ts` exclusion and `i18n` / `plugin-form`
   / `types` dropping `DOM.Iterable` do not.
   **Would have caught**: this card, objectui#8691, and the false comment in
   `plugin-designer`.
2. **No file's matchers may be typed only by another file's import.** The `leaning`
   column must be 0 — fixed either by the importing file's package naming jest-dom in
   `types`, or by each file importing it. **Would have caught**: 83 files across 4
   packages, today.
3. **Inert declarations fail.** An `include` pattern matching zero files, or an option
   restating its own default, is deleted. **Would have caught**: 3 dead `d.ts` patterns,
   35 redundant `composite`/`declaration` lines.
4. **Ratchet, not big bang.** Every rule above has live violations; each needs a declared
   allowlist that can only shrink, in the shape `check-type-check-coverage.mjs` already
   uses.

---

## Method — re-runnable

```bash
pnpm build                                   # PRECONDITION: unbuilt => TS2307 everywhere
pnpm census:tsconfig-test-parity             # the matrix
pnpm census:tsconfig-test-parity -- --json   # machine-readable

# baseline: every test project compiles today
for f in $(git ls-files '*tsconfig.test.json'); do
  ./node_modules/.bin/tsc -p "$f" > /tmp/b.log 2>&1
  printf '%-46s exit=%s errors=%s\n' "$f" "$?" "$(grep -c 'error TS' /tmp/b.log)"
done
```

## What this audit does NOT claim

- **Not** that any of the 23 axes is wrong. It reports; triage rules.
- **Not** that the 38 are all the test type-programs — 4 more are fused into build
  configs (see *Population*), and `scripts/__tests__/*.test.ts` are compiled by a 43rd
  program, `tsconfig.scripts.json` (`lib: ES2022`, `types: ["node"]`).
- **Not** anything about `objectui#8710`'s module-resolution axis: that divergence is
  between Vite's alias table and the `exports` map, not between two `tsconfig`s, so this
  instrument cannot see it. `moduleResolution` is uniformly `bundler` across all 38.
- **Not** that a zero in the leakage column means a package is safe — it means no file
  there uses a matcher without its own import *today*.
