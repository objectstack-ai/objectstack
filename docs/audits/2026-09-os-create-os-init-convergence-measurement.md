# `os create` vs `os init` — convergence measurement

**Taken:** 2026-09-05 · **Tree:** `origin/main` `c99449ab5fd` · **Card:** #15531 (the measurement
#14824's ruling reserved) · **Seat:** `domain:cli` development

> ⛔ **This document decides nothing.** #14824 reserved the convergence question
> explicitly — *"Not ruled here: whether `os create` and `os init` should later converge into
> one command family"* — and reserved it for the maintainer. What follows is the measurement
> that reservation asked for, plus a recommendation reasoned on the four axes. The
> recommendation is an input to a decision, not the decision. No emitted output, no published
> export and no command surface was changed to produce it.

---

## 0. How the numbers were taken

Every file map below is a **real render**, not a reading of the templates. A throwaway vitest
harness drove `Init.prototype.run()` and `Create.prototype.run()` — the actual command bodies,
with `parse()` stubbed to supply argv — into throwaway directories outside the repository, and
hashed the resulting trees (sha256, first 16 hex chars). The harness was deleted afterwards; it
is reproduced in §10 so any reader can re-take the reading.

Two supporting facts are **source reads**, marked as such where they appear: the export lists,
and the call-site counts.

The dependency closure was built before the render (`pnpm --filter '@objectstack/lint...' build`,
4 packages) — an unbuilt `dist/` would have made the render a verdict about build state.

---

## 1. ⚠️ Correction: the population is THREE scaffolders, not two

The card measures a two-scaffolder question. Measured on this tree, the repository ships **three**
project scaffolders, and the third is the one the documentation sends new users to:

| scaffolder | source | emitted by | documented on |
|:--|:--|:--|:--|
| `os init [name]` | `packages/cli/src/commands/init.ts` | `@objectstack/cli` | 3 live doc pages |
| `os create <type> <name>` | `packages/cli/src/commands/create.ts` | `@objectstack/cli` | 4 live doc pages |
| `npx create-objectstack` | `packages/create-objectstack/` | its own published package (`create-objectstack@17.3.0`) | 13 live doc pages |

Page counts are `git grep -l` over `content/docs`, release-note pages excluded (measured:
`os create` 4, `os init` 3 + 1 release page, `create-objectstack` 13 + 2 release pages).

⇒ **The card's bullet "`os init` is the documented on-ramp" is stale on this tree.**
`content/docs/deployment/cli.mdx:29` opens "Your First App in 2 Minutes" with
`npm create objectstack@latest my-app` and casts `os init` as the alternative — and its
`#os-init` section carries an explicit *"Which scaffolder?"* callout saying to prefer
`npm create objectstack@latest` and to "reach for `os init` when you want a **plugin** skeleton
or a **bare config** in an existing directory". `content/docs/getting-started/your-first-project.mdx:72`
says the same ("an alternative scaffolder"), as does `skills/objectstack-platform/SKILL.md:1026`.

This does not weaken the card — the four-export shared surface is real and current (§2). It
changes what a convergence would be converging *toward*: any "one command family" answer that
names only `create` and `init` has already left out the scaffolder with four times the
documentation.

---

## 2. The shared surface — four exports, six call sites (verified complete)

Source read of `packages/cli/src/commands/create.ts:83-88` at `c99449ab5fd`:

| export of `init.ts` | call sites in `create.ts` | what it decides |
|:--|:--:|:--|
| `getCliVersion()` | 1 (`objectstackDependencySpec`) | the version every emitted `@objectstack/*` range pins to |
| `SCAFFOLD_PNPM_RANGE` | 2 (both templates' `engines.pnpm`) | the pnpm floor the emitted project declares |
| `renderPnpmWorkspaceYaml()` | 2 (both templates' `pnpm-workspace.yaml`) | the build approvals a fresh install needs |
| `sanitizeNamespace()` | 1 (`objectstack.config.ts` namespace) | the namespace the emitted manifest carries |

**The card's list is complete and current.** No fifth export of `init.ts` is imported, none of the
four has fallen out of use, and the dependency is one-directional — `init.ts` imports nothing from
`create.ts`. `init.ts` exports 11 module symbols in total; `create.ts` consumes 4 of them.

One shared decision the card does not count, because it does not come from `init.ts`: both
commands import `PROTOCOL_MAJOR` from `@objectstack/spec/kernel` (1 call site in `create.ts`,
3 in `init.ts`) to stamp `engines.protocol`. That is the shape the rest of this document
recommends for everything else — a policy owned by neither front-end.

---

## 3. The drift history, with dates — the argument that restating drifts

Confirmed by `git log -S` on `create.ts` (non-shallow checkout):

| date | commit | event |
|:--|:--|:--|
| 2026-01-31 | `a3dfaac2724` | `create.ts` first carries `workspace:*` **and** `extends: '../../tsconfig.json'` |
| 2026-05-25 | `8fab8a7bd62` | `init.ts` learns the published-range pin (`getCliVersion`) — "make `objectstack init` produce a working project" |
| 2026-09-04 | `cf6b67164e3` | #14824 lands in `create.ts` (PR #15535): 1 imported symbol becomes 4, the un-installable shape goes |

⇒ **The restated policy drifted for 102 days** after the sibling scaffolder had learned better,
on the values that decide whether a scaffold installs at all. At the parent of the fix
(`f7fd5c5d30e`, 2026-09-04) `create.ts` still carried **3** `workspace:*` occurrences and **2**
literal `extends: '../../tsconfig.json'` lines, and imported exactly **one** symbol from
`init.ts` (`sanitizeNamespace`) — the card's history is confirmed exactly as written.

Incidental confirmation from the same read: `create.ts` imported `execSync` and never called it,
so "`create` cannot install" predates the fix rather than being caused by it.

---

## 4. The file map, rendered

Hashes are of the emitted bytes. Identical hash = byte-identical file.

```
--- os init my-app -t app                (7 files)   --- os create plugin my-app             (5 files)
    61022f949eb49fe0  .gitignore                         ac9f163c13714081  package.json
    fdffeca0998e7d18  objectstack.config.ts              d8c47679bacfc34e  pnpm-workspace.yaml   ← same
    86b9c74e664a00ad  package.json                       d0b334035fd11875  README.md
    d8c47679bacfc34e  pnpm-workspace.yaml   ← same       a98397b05aeae0a8  src/index.ts
    58ab1d581dbd8c98  src/objects/index.ts               eaec35bdf812807b  tsconfig.json
    a9b55435ce44424a  src/objects/my_app_item.object.ts
    045d4931833c93b0  tsconfig.json         ← same   --- os create plugin my-app --in-repo   (4 files)
                                                        8ecf6657088d74af  package.json
--- os init my-app -t plugin             (7 files)      d0b334035fd11875  README.md
    61022f949eb49fe0  .gitignore                         a98397b05aeae0a8  src/index.ts
    a9c3aeb477419005  objectstack.config.ts              cdf5348bcc53af2f  tsconfig.json
    da9341755894e00d  package.json
    d8c47679bacfc34e  pnpm-workspace.yaml   ← same   --- os create example my-app            (5 files)
    58ab1d581dbd8c98  src/objects/index.ts               8b033a6e95c2185c  objectstack.config.ts
    95ec0d84825b9e1e  src/objects/my_app_item.object.ts  5c3bcae8cfbc8aeb  package.json
    045d4931833c93b0  tsconfig.json         ← same       d8c47679bacfc34e  pnpm-workspace.yaml   ← same
                                                        82b6a67cbbd8832d  README.md
--- os init my-app -t empty              (5 files)      045d4931833c93b0  tsconfig.json         ← same
    61022f949eb49fe0  .gitignore
    1f58ea648813bf3e  objectstack.config.ts          --- os create example my-app --in-repo  (4 files)
    e1a8e5d8ba66771b  package.json                       8b033a6e95c2185c  objectstack.config.ts
    d8c47679bacfc34e  pnpm-workspace.yaml   ← same       d2c54eefad6f0f2b  package.json
    045d4931833c93b0  tsconfig.json         ← same       76865b038887c87c  README.md
                                                        c54b75668ae79c9c  tsconfig.json
```

**Read the map by file name, not by command:**

| file name | `os init` | `os create` | verdict |
|:--|:--:|:--:|:--|
| `package.json` | 3 templates | 4 emissions | emitted by both, **7 distinct hashes** — genuinely different (§5) |
| `pnpm-workspace.yaml` | all 3 | both standalone | **one hash across 5 emissions** — the imported renderer, provably one producer |
| `tsconfig.json` | all 3 | all 4 | **`init` × `create example` are byte-identical from two independent literals** |
| `objectstack.config.ts` | all 3 | `example` only | different manifests, both `ManifestSchema`-valid |
| `.gitignore` | all 3 | **none** | `os create` ships no `.gitignore` |
| `README.md` | **none** | all 4 | `os init` ships no `README.md` |
| `src/objects/**` | `app`, `plugin` | none | metadata objects |
| `src/index.ts` | none | `plugin` only | a `Plugin` implementation |

⇒ **Of the four file names both commands emit, two already render byte-identical output**
(`pnpm-workspace.yaml` because it is imported; `tsconfig.json` by coincidence of two
restatements that happen to agree today), and two differ for reasons §5 grades as essential.

The file map is therefore *not* the honest scope of a merge. The honest scope is one template
pair (§5.3).

---

## 5. What is genuinely different — enumerated and graded

### 5.1 ⭐ The word "plugin" names two different artifacts

The single most important finding, and it is invisible until the two `plugin` templates are
rendered side by side:

| | `os init my-app -t plugin` | `os create plugin my-app` |
|:--|:--|:--|
| package name | `my-app`, `private: true` | `@objectstack/plugin-my-app`, `license: MIT`, `main`, `types` |
| build script | `objectstack compile` | `tsc` |
| what it emits | `objectstack.config.ts` with `type: 'plugin'` + `src/objects/*.object.ts` | `src/index.ts` exporting a `Plugin` with `init()` / `destroy()` |
| what it IS | a **metadata** plugin — declarative objects compiled to an artifact | a **code** plugin — a TypeScript library implementing the kernel `Plugin` contract |
| publishable | no (`private`) | yes |

These are two different products of the platform, not two spellings of one. **Grade: essential.**
Any convergence must keep both, and the naming collision is a documentation defect that exists
*today*, independent of any convergence.

### 5.2 Capabilities each command has and the other does not

| capability | `os init` | `os create` | grade |
|:--|:--:|:--:|:--|
| installs dependencies (`--install` / `-p <pm>`, 4 package managers) | ✅ | ❌ | **essential** — it is the first-run guarantee |
| self-validates the scaffold against the author-time rule set (`validateScaffold`) | ✅ | ❌ | **essential** — it is what stops shipping a scaffold the platform refuses |
| scaffolds into the **current** directory (name omitted) | ✅ | ❌ | **essential** — "add ObjectStack to an existing directory" |
| validates the project name (npm rules) | ✅ | ❌ | **essential** (and a live defect — §7.1) |
| "Created files" summary walked off finished disk | ✅ | ❌ | incidental |
| emits `.gitignore` | ✅ | ❌ | incidental gap in `create` |
| `--in-repo` placement (platform work: `workspace:*` + root `tsconfig` extends) | ❌ | ✅ | **essential** — documented monorepo-contributor path |
| arbitrary target dir (`-d, --dir`) | ❌ | ✅ | incidental (`init` reaches it by `cd`) |
| emits `README.md` | ❌ | ✅ | incidental gap in `init` |
| emits a publishable package (`main`/`types`/`license`) | ❌ | ✅ | **essential** — see §5.1 |
| failure exit path | `this.error` (oclif, exit 2) | `process.exit(1)` + target cleanup | incidental **inconsistency** |

### 5.3 ⭐ The one genuine duplicate

Strip §5.1 and §5.2 away and exactly one pair overlaps:

> **`os create example <name>` is a strictly weaker `os init <name>`.**

Measured: it emits `objectstack.config.ts` (a manifest with commented-out barrels — i.e. `init`'s
`empty` template plus a README), `package.json`, `tsconfig.json` (**byte-identical to `init`'s**)
and `pnpm-workspace.yaml` (**byte-identical to `init`'s**) — and it does not install, does not
validate, does not emit `.gitignore`, and does not validate the name. Everything it does that
`init` does not is one `README.md`.

⇒ **The convergence question, measured, is not "should two commands merge". It is "should
`os create example` exist".** That is the retirement outcome the triage flagged as possible,
scoped to one template rather than a command family.

---

## 6. What is still restated — the residue, measured

#14824 imported the values that decide whether a scaffold **resolves**. Everything else is still
restated across the three scaffolders, and it has already drifted:

| restated value | `os init` | `os create` | `create-objectstack` | drifted? |
|:--|:--|:--|:--|:--:|
| `@objectstack/*` range | `^17.3.0` (imported `getCliVersion`) | `^17.3.0` (imported) | `^17.0.0` (own version stamp) | no, by import |
| `engines.pnpm` | `>=10.15` (imported) | `>=10.15` (imported) | `>=10.15` (literal) | no |
| `pnpm-workspace.yaml` | rendered (imported) | rendered (imported) | literal file | semantics pinned by a test |
| **`typescript`** | `^5.3.0` | `^5.8.0` | `^6.0.0` | ⚠️ **3 values** |
| **`vitest`** | `^4.0.18` (`plugin`) | `^4.0.0` | — | ⚠️ **2 values** |
| **tsconfig base 6 keys** | inline literal | `STANDALONE_COMPILER_OPTIONS` | template file | 3 literals, identical today |
| `zod`, `@types/node` | not declared | `^4.3.6`, `^22.0.0` | not declared | n/a |
| the `engines.protocol` explainer comment | 3 copies | 1 copy | 1 copy | 5 copies, swept by a test |

⇒ **The values that are imported have zero drift across five emissions. The values that are
restated carry three disagreeing TypeScript ranges today.** This is the same defect class as the
102-day drift in §3, one severity band lower — nobody's scaffold fails to install because of it,
but a newcomer scaffolding two ObjectStack projects on the same afternoon gets two different
TypeScript majors.

---

## 7. Findings this measurement turned up (not fixed here, not filed blind)

### 7.1 `os create` accepts a project name npm refuses — **measured, live defect**

```
os init      "My App"  → REFUSED: "Project name must be lowercase"; nothing written
os create plugin "My App"  → ACCEPTED; writes ./plugin-My App/
                             package.json name: "@objectstack/plugin-My App"
```

`init.ts` has `validateProjectName()`; `create.ts` validates nothing. The emitted manifest carries
a name npm rejects, in a directory with a space. Same class as #14823 (`os create`'s injected
comments are validated by nothing): **`os create` validates nothing it emits.** Independent of any
convergence outcome.

### 7.2 The `plugin` word collision (§5.1) is a documentation defect today

`os init -t plugin` and `os create plugin` produce different artifacts, and no page says so.
`content/docs/deployment/cli.mdx`'s "Which scaffolder?" callout tells a reader to reach for
`os init` for "a **plugin** skeleton" — which is the metadata plugin, while every plugin page
(`plugins/index.mdx`, both `protocol/kernel` pages) scaffolds the code plugin with `os create plugin`.

### 7.3 `.gitignore` / `README.md` are each emitted by exactly one command

Neither is a decision anyone recorded; each is an artifact of two implementations.

---

## 8. What a merge would cost, and what survives it

**Documented surface** (the real bill): 4 doc pages spell `os create`, 3 spell `os init`. Retiring
either spelling is a published-CLI-surface change needing a deprecation, and
`test/create-plugin-docs-parity.test.ts` holds 3 of those pages to the emitted file map by name —
so a changed file map reddens the docs pin, by design.

**CI**: `os create` has a dedicated smoke gate (`.github/workflows/os-create-smoke.yml` +
`scripts/create-scaffold-smoke.sh`, which scaffolds every template outside the repo, installs from
packed tarballs and builds it), with path filters mirrored in `scripts/check-ci-filter-parity.mjs`.
`os init` has **no end-to-end CI gate at all** — measured: the only mention of `init` in any
workflow is `packages/cli/src/commands/init.ts` in the *create* gate's path filter, present because
`create` imports it (positive control: the same grep finds `os create` and `create-objectstack`
steps in four workflows, so the pattern does find invocations when they exist).

**The drift guards survive, and simplify — the card is right.** Both both-scaffolder sweeps derive
their populations from the two maps rather than listing them:

- `test/scaffold-manifest-schema.test.ts` — `Object.keys(TEMPLATES)` + `Object.entries(templates)`
  filtered to those emitting a config (today: 3 + 1 = 4 scaffolds).
- `test/init-template-comments-self-contained.test.ts` — both maps, whole.

Under a merge each sweeps one map instead of two; the assertions naming `create:example` /
`create:plugin` would be re-pointed, not deleted. `test/scaffold-workspace-consistency.test.ts` is
**untouched** by any create/init merge — it holds the CLI renderer against the
`create-objectstack` template, i.e. the *other* pair, and stays exactly as load-bearing.

---

## 9. Recommendation — reasoned on the four axes

Three options, then the axes.

- **A. Merge `os create` and `os init` into one command family.**
- **B. Do not merge. Extract the remaining restated emission policy (no user-visible change), and
  put ONE user-visible question to the maintainer: should `os create example` be retired?**
- **C. Change nothing.**

**② 项目长远合理性 — ≥50% weight, leading.** The long-term-correct shape this repository is
already converging on is *one emission policy, thin front-ends that import it* — that is what
#14824 did, and §6 measures the result: **imported values have not drifted; restated values carry
three disagreeing TypeScript ranges.** The long-term risk is the restatement, not the command
count. A merge (A) spends a deprecation on the command count and leaves the restatement exactly
where it is; C leaves both. **B is what ② asks for**, and it also removes the one true duplicate
(§5.3) rather than pretending the whole surface is duplicated.

**① 实际业务需求 — measured, not asserted.** The on-ramp demand is already served by a third
command (13 doc pages, 3 CI workflows including a weekly published-registry canary). The demand
only `os create` serves is the **code plugin** skeleton (3 plugin/kernel pages + a dedicated smoke
gate). The demand only `os init` serves is *install + self-validate + scaffold into an existing
directory* — no other scaffolder does any of the three. **No command here is callerless**, so this
is not a retirement card at the command level; it is a retirement question at the *template* level
(`os create example`, §5.3).

**③ 防 AI 写代码犯错 — the axis with the sharpest measured answer.** The question is which shape
makes an AI structurally less likely to emit a drifted scaffold, and §3 + §6 answer it with dates:
the same author, restating, drifted for 102 days on the value that decides whether the scaffold
installs; the same author, importing, has zero drift across five emissions. ⚠️ **A merge is not
what buys that** — the 4 imports already did, inside two commands. What still buys it is extracting
the *rest* (tsconfig base, devtool ranges) into the same shared module. And a merge carries its own
③ hazard: collapsing §5.1's two different artifacts under one word is exactly the shape that
teaches a reader (human or AI) that a metadata plugin and a code plugin are the same thing.

**④ 创业阶段不扩散需求 — cuts both ways, as the dispatch warned.** One command family is less
surface; but the migration is 7 doc pages, a docs-parity pin, a CI path-filter parity script and a
deprecation on a published CLI. B's extraction is contained (one module, no user-visible change,
no doc edits) and B's one open question is one template, not a command family. **④ is against A,
mildly for B, and against C only because §7.1 is a live defect.**

### ⇒ Recommended: **B**

1. **Extract the residue** (§6) — tsconfig base options and the devtool ranges — into the shared
   emission-policy module both commands already import, the way `SCAFFOLD_PNPM_RANGE` is shared.
   No user-visible change, no doc edits, and it closes the drift class that is *currently open*.
   Worth considering in the same move: whether the third scaffolder's template can consume it too,
   which is where the widest divergence sits (`typescript@^6` vs `^5.3`).
2. **Ask the maintainer one question, not four**: should `os create example` be retired in favour
   of `os init` (§5.3)? It is the only genuine duplicate; it is user-visible; it is a deprecation.
3. **Fix the `plugin` word collision** in the docs (§7.2) — independent of 1 and 2.
4. **Do not merge the command families.** The measurement does not support it: after §5.1 and
   §5.2 the two commands share four file names, two of which already render byte-identical
   output, and differ on eleven capabilities of which six are essential.

⛔ Each of 1–3 is its own card. This document implements none of them.

---

## 10. Reproducing the reading

```bash
git fetch origin main && git worktree add --no-track ../os-15531 -b tmp/15531 origin/main
cd ../os-15531 && pnpm install && pnpm --filter '@objectstack/lint...' build
```

Then, in a throwaway test file under `packages/cli/test/`, drive the real command bodies with
`parse()` stubbed (`Object.create(Init.prototype)`, assign `cmd.parse = async () => ({ args, flags })`,
`process.chdir()` into a temp dir, `await cmd.run()`), and hash the resulting tree. The
`--in-repo` placements need a `pnpm-workspace.yaml` in the working directory or the command
refuses the flag, by design. Delete the harness afterwards: it is a measurement instrument, not a
test — nothing here asserts, so nothing here should live in the suite.

The source reads (`§2`, `§3`) are:

```bash
sed -n '83,88p' packages/cli/src/commands/create.ts          # the four imports
git log -S 'getCliVersion' --reverse -- packages/cli/src/commands/init.ts
git log -S 'workspace:*'   --reverse -- packages/cli/src/commands/create.ts
git grep -l -E '\b(os|objectstack) (create|init)\b' -- content/docs
```
