#!/usr/bin/env node
/**
 * When a change touches the SOURCE of a package changesets versions, the same
 * change must declare a `.changeset/*.md`. An EMPTY frontmatter counts.
 *
 * Run:  node scripts/check-changeset-presence.mjs
 * Exit: 0 = nothing guarded changed, or a changeset was added
 *       1 = guarded source changed with no declaration, or the inputs could not
 *           be read (both are failures — see "Never silent" below)
 *
 * ## The gap this closes (objectui#3387)
 *
 * objectstack#4731 / #4843 made the DECLARED changesets the single criterion for
 * "which frontend changes shipped": the platform reads this repository's
 * `.changeset/*.md` and writes them into its own release notes. That criterion is
 * only as true as the premise underneath it — *a change to published source
 * carries a changeset* — and nothing enforced the premise.
 *
 * Measured over `7d9734d5e321..785b8a5d432c` (53 non-merge commits): 7 carried no
 * changeset, and two of those changed published source in a user-visible way —
 * `19716b5bf` `fix(charts): name the slices` (`plugin-charts`, `plugin-dashboard`)
 * and `5e7ef1141` `fix(i18n): resolve qualified view ids` (`i18n`). Neither
 * appears in a CHANGELOG, a version number, or any release note: both rode the
 * next release out as anonymous cargo. A third landed after the issue was
 * written — `0e50440` (#3518), 26 files across five packages and all ten locale
 * packs — which is the point worth keeping in view: objectstack#4843 made the
 * omission *audible* on the platform side, and it did not make it stop. Only a
 * gate does.
 *
 * ## Why this is a second workflow and not a wider trigger on the first
 *
 * `.github/workflows/changeset-guard.yml` already exists and looks like the
 * natural home. It is not: its trigger is `paths: ['.changeset/**']`, and that
 * INVERSION is deliberate and documented in its own header.
 *
 * Its reason is NOT the one this comment used to give — "`ci.yml` and `lint.yml`
 * both list `.changeset/**` under `paths-ignore`, so a PR that adds ONLY a
 * changeset starts no other workflow at all". objectui#3523 step 2 deleted
 * `paths-ignore` from those two workflows' `pull_request` trigger; it survives
 * only on `push`. Such a PR therefore DOES start them and DOES produce their
 * contexts — measured: PR #3856 (one markdown file) started 16 checks, PR #4339
 * (one line added to AGENTS.md) started 17. objectui#3857 pinned the correction
 * after an author acted on the old sentence and got the opposite result.
 *
 * What #3523 moved rather than deleted is the path DECISION. It is now the
 * `Decide whether this change needs a full run` step in `ci.yml`, with a twin in
 * `lint.yml`, and its exclusion list is that `push` filter unchanged — markdown
 * and `.changeset/**` included, held identical to it by
 * `scripts/__tests__/merge-queue-reporting.test.ts`. So on a changeset-only PR
 * both workflows start, report, and skip every expensive step: no gate inside
 * either of them ever reads the changeset. The conclusion survives its premise —
 * `changeset-guard.yml` runs outside that in-job switch, with no install and no
 * build, so it is still the only thing that judges such a PR at all.
 *
 * This gate faces the other way. A PR which forgot its changeset, by definition,
 * does not touch `.changeset/**`: the one check that could notice is the one
 * check guaranteed not to run. Widening that workflow's paths would break the
 * case it was built for, so this gate is forward-triggered and lives alongside
 * it.
 *
 * ## What is guarded, and why it is derived rather than listed
 *
 * `<pkg>/src/**` for every workspace package NAMED IN the `fixed` group of
 * `.changeset/config.json`. That set is where the release actually is: changesets
 * versions those packages (and writes their CHANGELOGs) as one family, so a
 * source edit to any of them ships. Everything in the `ignore` list is skipped —
 * changesets never versions it, so demanding a declaration would be demanding a
 * declaration about nothing.
 *
 * Derived, not spelled out, and that is the load-bearing part. objectui#3387
 * proposed the surface as one literal glob — `packages`, any one package, `src`,
 * anything (not spelled out here: a glob whose star is followed by a slash closes
 * this comment block early, the trap `tsconfig.scripts.json`'s header records) —
 * which reads as
 * exhaustive and is not: `@object-ui/console` — the single most-edited published
 * package in this repository, and the one the platform's `bump-objectui.sh`
 * writes a changeset FOR — lives at `apps/console`, outside that glob entirely.
 * A hand-written surface would have shipped a gate that misses the package the
 * whole criterion is mostly about. Reading `.changeset/config.json` instead means
 * the guarded set follows the release configuration by construction, and
 * `scripts/check-changeset-fixed.mjs` already fails when a workspace package is
 * in neither `fixed` nor `ignore` — so the two gates compose into "every package
 * is classified, and every classified-as-released package's source is declared".
 *
 * ## Which files count as a package's source — the POPULATION (objectui#5733)
 *
 * `<pkg>/src/` is where nearly all of a package's published source is. It is not
 * all of it, and the difference was measured rather than argued. On `a1c41c516`,
 * a change confined to `apps/console/index.html` — the console's HTML entry,
 * which is compiled into the published `dist/` and carries two inline classic
 * scripts that run in every user's browser during parse (the pre-boot
 * branding/`runtime/config` script and the `crypto.randomUUID` shim for insecure
 * origins, both graded by tests in `apps/console/src/__tests__/` precisely
 * because they are shipped behaviour) — produced this verdict:
 *
 *     Compared the working tree with a1c41c516 (merge-base with origin/main):
 *     1 file(s) changed, 0 of them under the src/ of a package the release
 *     covers, 0 under a package changesets ignores, 0 changeset(s) added.
 *     ✅  No source of a released package changed in this range, so no changeset
 *     is owed.
 *
 * That verdict is quoted as it READ THEN. The summary line's wording moved with
 * this fix — it now says `published source of a package the release covers` —
 * so a grep for the old phrase finds this quotation and nothing else, which is
 * the intended result rather than a leftover.
 *
 * ### The rule this file implements
 *
 * A changed file counts when it is that package's **published, executable**
 * source. Concretely, it counts when ANY of these holds:
 *
 *   (a) it is under `<pkg>/src/`; or
 *   (b) it is `<pkg>/index.html` — the bundler's HTML entry, whose content
 *       (inline scripts included) is compiled into the published `dist/`; or
 *   (c) the package's own `package.json` `files` list publishes it verbatim —
 *       `apps/console`'s root `plugin.ts`, which is that package's `main`.
 *
 * …minus **documentation and licences** (`*.md`, `LICENSE*`), which do ship in
 * the tarball but are not behaviour. `<pkg>/src/` is exempt from that
 * subtraction: it keeps its existing all-of-it reading, unchanged, so nothing
 * that was guarded before is guarded less now.
 *
 * `isPublishedSource` below is that rule as code, in the same clause order.
 *
 * On this tree the widening adds exactly three files — `apps/console/index.html`,
 * `apps/console/plugin.ts`, `packages/runner/index.html` — and that number is the
 * point rather than a footnote. The population has a wrong answer in each
 * direction: too narrow and shipped executable code changes with nothing said, so
 * consumers get a release that does not mention it; too wide and every incidental
 * file in a package directory demands a declaration, the gate becomes noise, and
 * people answer it with empty changesets they did not read — which is how a gate
 * stops being read at all. "Published AND executable" is the line, and both words
 * are load-bearing.
 *
 * Deliberate boundaries, stated so they are not mistaken for oversights:
 *
 *   - **`package.json` is not a FILE in this population, and never becomes one.**
 *     Clause (c) reads that file; it does not match it, and no clause added
 *     since does either. What changed under objectui#6736 is a different
 *     question asked of the same file — see "The manifest's published contract"
 *     below — and it is deliberately not a fourth clause: `isPublishedSource`
 *     stays path-only, so a manifest edit can never be answered by "the file
 *     changed".
 *   - **`<pkg>/public/` does not count.** Vite copies it verbatim into the
 *     published `dist/`, so it genuinely IS published — a favicon, a logo, a PWA
 *     manifest. None of it is executable, and demanding a declaration for a logo
 *     swap is exactly the friction that teaches authors to silence this gate.
 *     Published-but-not-code sits with the READMEs.
 *   - **`<pkg>/*-preview.html` and `<pkg>/demo/` do not count**, because they are
 *     not build inputs. Vite's build entry is `index.html` alone unless
 *     `rollupOptions.input` names more, and neither `apps/console`'s five preview
 *     pages nor `plugin-grid`/`plugin-gantt`'s demo pages are named. They are
 *     dev-server pages that reach no tarball.
 *   - **Clause (b) tests the NAME, not the bundler config.** A package-root
 *     `index.html` in this repository is always the build entry — `apps/console`
 *     (`tsc && vite build && pnpm build:plugin`) and `packages/runner`
 *     (`vite build`) are the only two, and both are. If one ever is not, the cost
 *     is a single empty-frontmatter changeset. The other direction — deriving it
 *     from a build script's spelling — fails SILENTLY the day the spelling
 *     changes, and a silent narrowing of this population is the exact defect
 *     objectui#5733 reported.
 *   - **No carve-out for test files under `src/`.** A change confined to
 *     `src/__tests__/` is answered by the empty-frontmatter exemption, in one
 *     line. The alternative — teaching the gate which files "don't count" — is
 *     where the holes live, and this gate asks for a sentence, not a release.
 *
 * ## The manifest's published contract — a FIELD reading, not a file (objectui#6736)
 *
 * Everything above answers "did a published FILE change". A package's published
 * contract is not only files: `sideEffects` tells every consumer's bundler what
 * it may drop, `exports` decides what a consumer can import at all, `files`
 * decides what is in the tarball. None of those live under `src`, all of them
 * are read by consumers, and until objectui#6736 a change to any of them was
 * owed no declaration. The live instance the card was filed on is PR #6735,
 * which gave `@object-ui/app-shell` a `sideEffects` ARRAY — modules the array
 * does not name became droppable in every consumer's build — and got this
 * gate's own verdict, quoted as it read then:
 *
 *     7 file(s) changed, 0 of them published source of a package the release
 *     covers, 0 under a package changesets ignores, 1 changeset(s) added.
 *     OK  No source of a released package changed in this range, so no
 *     changeset is owed.
 *
 * That changeset was there because its author decided it was owed. Nothing
 * asked for it.
 *
 * ### The list is fixed, and adding to it is a ruling
 *
 * `CONTRACT_FIELDS` below is the list objectui#6736 named and triage ratified as
 * implementable-as-given. It is NOT a starting point to grow by taste: the
 * triage comment says in as many words that adding or dropping a field is the
 * step that needs a decision, not an implementation choice. What is in it:
 * `sideEffects`; `exports`, `main`, `module`, `types`; `files`;
 * `peerDependencies`, `engines`.
 *
 * ### What stays out, and why that is the SAME trade as before
 *
 * `version`, `dependencies`, `devDependencies`, `scripts`, `name`,
 * `publishConfig` and everything else are not read. Two of those are named
 * exclusions rather than leftovers, and they are the reason this is a field
 * reading rather than a file one:
 *
 *   - **`version`** is written by `changeset version` itself. A gate that went
 *     red on it would go red on the release commit that answers it.
 *   - **`devDependencies`** is what Dependabot bumps. Demanding a changeset per
 *     bot bump is the noise this gate cannot afford.
 *
 * Neither is special-cased in the code, and that is the point worth keeping:
 * they are excluded BY CONSTRUCTION, because the reading is an allowlist of
 * eight fields and they are not in it. There is no branch to forget, no bot
 * identity to sniff, and no commit message to parse — the two exclusions the
 * card names are properties of the list, and `check-changeset-presence.test.ts`
 * exercises both against real fixtures so that stays true.
 *
 * `dependencies` staying out is the part of the old trade that is KEPT rather
 * than reversed: a runtime dependency bump can be just as user-visible as any
 * of the eight, and this gate still does not see it. That was the first draft's
 * trade, it is narrowed here rather than abandoned, and it is stated so nobody
 * reads "the manifest is guarded now" off this section.
 *
 * ### Two readings of the same file, and why they do not collide
 *
 * `package.json` was already being read — clause (c) asks its `files` list
 * whether some OTHER changed path ships. That reading is about a different
 * path, takes the manifest as it stands AFTER the change (the tarball a
 * consumer will get is the one the new list describes), and is unchanged here.
 * The field reading asks whether the manifest's own guarded values MOVED, so it
 * needs both sides and reads them out of git.
 *
 * Where the two readings touch — `files` is in both — they are held to one
 * normalisation: `publishedEntries` is what clause (c) compares against, and it
 * is what the field diff compares too, so `dist` and `dist/` are one value to
 * both. Without that, the gate could demand a declaration for a `files` edit
 * that its own clause (c) reports as changing nothing shipped: code
 * contradicting itself inside one run.
 *
 * ### Why a diff of parsed values, and not the file's mtime
 *
 * Reformatting a manifest, sorting its keys, or bumping its version touches the
 * file. Only a value moving inside one of the eight fields is a contract
 * change, so both sides are PARSED and the guarded fields compared value by
 * value. Comparison is order-preserving serialisation, which is correct rather
 * than merely convenient: `exports` condition order is resolution order in
 * Node, so reordering conditions IS a behaviour change and must not compare
 * equal. For `peerDependencies` and `engines` a pure key reorder would be
 * reported too — accepted, and cheap: it costs one empty-frontmatter changeset,
 * and nobody reorders those keys without meaning something.
 *
 * An unparseable manifest on EITHER side is a hard failure, like every other
 * unreadable input here (see "Never silent" below). A manifest absent on one
 * side — a package added or removed — reads as every guarded field appearing
 * or disappearing, which is what it is.
 *
 * ## The empty-frontmatter exemption
 *
 * A changeset whose frontmatter declares no package (`---` immediately followed
 * by `---`) is a first-class pass. What is being demanded is a DECLARATION, once,
 * by the person who still knows what the change does — not a release. So:
 *
 *     ---
 *     ---
 *
 *     Internal refactor of the grid's column resolver; no behaviour change.
 *
 * is a complete, correct answer to this gate, and it leaves the reason in the
 * repository where the next reader finds it.
 *
 * An added `.changeset/*.md` with NO frontmatter block at all does not count: it
 * declares nothing, and changesets reads nothing out of it. That file is reported
 * as ignored rather than accepted, so a gate satisfied by an empty gesture cannot
 * be mistaken for a gate satisfied by a declaration.
 *
 * ## Never silent (objectui#4690, objectstack#4928)
 *
 * Every input this gate needs can be missing, and every one of them fails LOUD:
 * an unresolvable base commit, a `git diff` that errors, a missing `.changeset/`
 * directory, a changed source file belonging to a package that is in neither
 * `fixed` nor `ignore`. A diff gate that cannot compute its diff and exits 0
 * reports "declaration present" while having looked at nothing — which is the
 * same shape of green-while-blind that objectstack#4928 named the filter
 * contract, and the same one this gate exists to close one level up. Note the
 * direction: for a filter deciding whether to RUN work, "cannot tell" means run;
 * here the work IS the decision, so "cannot tell" means fail.
 *
 * ## A withdrawn sentence that survives in five released CHANGELOGs (objectui#5913)
 *
 * Recorded here once, because the five copies cannot be corrected in place and
 * this header is where findings of this shape live. objectui#4580's changeset —
 * the `SchemaNode` de-duplication — closed with:
 *
 *     Core's entry surface is unchanged: `dist/index.d.ts` is byte-identical
 *     across the change.
 *
 * That sentence is a VACUOUS MEASUREMENT. objectui#5673 withdrew it from the
 * source docstring it was also written into
 * (`packages/core/src/types/index.ts`), which now carries the full account and
 * the calibration recipe; this is the pointer for anyone who arrives from a
 * CHANGELOG instead.
 *
 * It is vacuous because `core/dist/index.d.ts` is emitted from a barrel that
 * only FORWARDS the symbol, and forwarding never restates a shape — not
 * `export` of everything, and not the named `export type { SchemaNode, … } from
 * './types/index.js'` line either. Only the module that DECLARES the symbol can
 * move. So that file is byte-identical under ANY change to a re-exported
 * declaration's shape, including one that breaks every consumer, and a gauge
 * that cannot fail for the change class it is quoted against has discharged
 * nothing. #5673's PR measured exactly that: a probe key added to the declaring
 * module moved `@object-ui/types`' `dist/base.d.ts` and brought it back, while
 * `core/dist/index.d.ts` and `core/dist/types/index.d.ts` held one hash across
 * all three legs. The withdrawn sentence was watching the two files that cannot
 * move.
 *
 * The five copies are NOT edited, and that is a ruling (maintainer, 2026-08-24),
 * not an omission. The release tooling composes CHANGELOGs from `.changeset/*.md`
 * at release time, so hand-editing the compiled artifact leaves the pipeline
 * this gate exists to protect; and the same text is already published to npm on
 * five packages, where a repo-side edit recalls nothing and only makes the
 * repository disagree with what shipped. The withdrawal is therefore recorded
 * once, here.
 *
 * Where the copies are, verified at `8d3a5294a`:
 *
 *     packages/components/CHANGELOG.md:1472
 *     packages/core/CHANGELOG.md:1021
 *     packages/plugin-dashboard/CHANGELOG.md:581
 *     packages/react/CHANGELOG.md:450
 *     packages/types/CHANGELOG.md:705
 *
 * CHANGELOGs are append-heavy and those line numbers move; the sentence does
 * not. Re-derive them with
 * `git grep -nI "is byte-identical across the change"`, which is a search and
 * its own control at once: the phrase is known-present, and it returned these
 * five plus one unrelated i18n test under `packages/fields`. Six files means the
 * search worked; zero means it broke, not that the copies are gone.
 *
 * ## Comment text in `src` DOES reach a published `.d.ts` (objectui#5666)
 *
 * Recorded here because this gate's own limitation is what let it through, and
 * because the FALSE version of the finding is already merged in a changeset
 * where the next author will reasonably cite it.
 *
 * `.changeset/page-source-tailwind-framing-5461.md` (PR #5471, `a691c0bee`)
 * justifies giving a comment-only edit to
 * `packages/components/src/renderers/layout/react-page.tsx` no entry of its own:
 *
 *     Those are internal comments — they do not project into any `.d.ts` and
 *     change no export — so they get no entry of their own; there is nothing an
 *     `@object-ui/components` consumer could read in a CHANGELOG and act on.
 *
 * The first clause is false, and it is false for that exact file. Re-measured
 * on `c9a725263` (the finding's own reading is from 2026-08-22 and was NOT
 * quoted forward), building `@object-ui/components` — 17.6.0, `private` unset,
 * `files` lists `dist`, so the emitted declarations are in the npm tarball:
 *
 *   - `src/renderers/layout/react-page.tsx`'s file header, including the whole
 *     styling paragraph #5461 added, is present VERBATIM in
 *     `dist/renderers/layout/react-page.d.ts` — `page-source-className-tailwind`
 *     on line 37 of the emitted file. The text the changeset said no consumer
 *     could read sits inside a file that is published verbatim.
 *   - Of #5461's THREE edits to that file, two are in the header and reach the
 *     emitted `.d.ts` (the injected-scope note losing `+ Tailwind`, and the new
 *     styling paragraph); the third does not. That third one is the
 *     `buildComponentScope` comment, which sits above a NON-EXPORTED function —
 *     the identifier `buildComponentScope` does not occur in the `.d.ts` at all,
 *     so neither does anything attached to it. One changeset, one file, both
 *     answers.
 *   - `src/renderers/basic/html-elements.tsx`'s file header likewise reaches
 *     `dist/renderers/basic/html-elements.d.ts`, whose only other content is
 *     `export {};` — there, the comment is very nearly the whole shipped file.
 *   - A comment inside a FUNCTION BODY does not project, and that half is
 *     load-bearing: without it this note would read as "comments project",
 *     which is false in the other direction. Control: the `kind === 'html'`
 *     dispatch arm inside `src/renderers/layout/page.tsx`'s `useMemo`. Three
 *     distinct phrases from it each occur exactly once under `src` and zero
 *     times anywhere under `dist`.
 *
 * ### Do NOT simplify this to "a file header projects"
 *
 * That is the shape the finding arrived in, and measuring the package instead
 * of two files does not support it. Of the 202 files under
 * `packages/components/src` that carry the licence file-header AND emit a
 * `.d.ts`, 165 have that header in the emitted file — and 37 do not.
 *
 * `page.tsx` is one of the 37, which makes it a single file demonstrating both
 * halves: its function-body comment is the negative control above, and its
 * header (`The Page renderer interprets PageSchema into structured layouts.`)
 * is likewise absent from all of `dist`, while its `PageRenderer` declaration
 * is emitted normally. Position in the file is NECESSARY, not SUFFICIENT.
 *
 * The 37 split by what the declaration emitter did with the statement the
 * header was attached to. 11 emit an empty `.d.ts` (barrels whose every line is
 * a side-effect import), so there is no node left for the comment to hang on.
 * In the other 26 the first statement the emitter produced is not the one the
 * header was attached to: `import React, { useMemo } from 'react'` is re-emitted
 * as `import { default as React } from 'react'`, `import type` becomes a value
 * import, an all-values import is dropped and a later one becomes first. A
 * rebuilt node carries no leading comment. That correlation holds across all 37
 * — but it is a reading of emitter behaviour, not a contract TypeScript
 * documents, and `vite-plugin-dts` post-processes on top of it.
 *
 * ### So do not reason about it — build and look
 *
 *     pnpm --filter '<pkg>^...' --filter <pkg> build
 *     git diff --stat -- <pkg>/dist
 *
 * If emitted `.d.ts` text moved, the package ships changed bytes and owes a
 * changeset that says so. THIS GATE CANNOT TELL YOU: it checks changeset
 * PRESENCE, not per-package correctness, so #5461 declaring `@object-ui/types`
 * satisfied it while `@object-ui/components`' emitted declarations changed with
 * nothing describing them. Making it per-package is a much larger change and was
 * deliberately not ruled here; the counter-statement is.
 *
 * One correction to the finding as filed, since it changes only the tense and
 * not the conclusion: at the time of writing the text had NOT yet been released.
 * `.changeset/page-source-tailwind-framing-5461.md` is still un-compiled in
 * `.changeset/` (its opening sentence appears in no CHANGELOG), so the release
 * that carries this declaration text is still ahead. The corrective entry
 * therefore lands WITH that release rather than apologising for it afterwards —
 * which is the outcome to aim for whenever this is caught in time.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * The separator `git -z` writes between paths, as a CODE POINT rather than a
 * character literal.
 *
 * `scripts/check-control-bytes.mjs` spells it exactly this way, and the reason is
 * the gate it implements: a raw control byte in a tracked file makes grep and
 * ripgrep classify the whole file as binary and return no matches at all, so the
 * file silently drops out of code search and out of every grep-based lint. Writing
 * the byte into this source — which happens most easily in the file that talks
 * about it — would take this gate out of every future grep, and a `.split()`
 * argument is the one place it is invisible on inspection. objectstack#4890 landed
 * a NUL in the very file that was documenting the rule against it.
 */
const NUL = 0x00;

/** Workspace directories that hold one package per subdirectory. */
export const PACKAGE_ROOTS = ['packages', 'apps'];

/** `.changeset/README.md` is documentation, not a declaration. */
export const NOT_A_CHANGESET = new Set(['README.md']);

// -- git ----------------------------------------------------------------------

/**
 * `git` in `root`, stderr piped.
 *
 * Piped rather than inherited because `resolveBaseRef` probes refs that
 * legitimately do not exist; git's "Not a valid object name" for a probe that was
 * supposed to miss reads as a real error in a CI log. Every call that MUST
 * succeed reports git's own message itself (see `changedFiles`).
 */
function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitQuiet(root, args) {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
}

/**
 * Which commit this change should be judged against.
 *
 * An explicitly NAMED base (`--base`, `OS_CHANGESET_BASE`) is authoritative and
 * is the only thing consulted when given. Otherwise: the merge base with the pull
 * request's own base branch (`GITHUB_BASE_REF`), then `origin/main`, then a local
 * `main`. The merge base — rather than the target branch's tip — is what makes a
 * branch answer for the edits IT made and not for whatever landed on `main` after
 * it forked. `check-i18n-en-drift.mjs` resolves its base from the same sources.
 *
 * This chain is also what makes the gate event-agnostic. On `pull_request`,
 * `GITHUB_BASE_REF` names the target branch; on a `merge_group` build there is no
 * such variable and no `github.event.pull_request` payload, and the fallback —
 * merge base with `origin/main` — resolves to the commit the queue built the
 * group on, so the diff is exactly the queued pull requests' changes. No
 * per-event YAML, and nothing to get wrong when a third event appears.
 *
 * A base that cannot be resolved is a HARD FAILURE, never a skip — and an
 * explicit one that cannot be resolved does NOT fall through to the discovery
 * candidates. That distinction was a real defect in the first draft of this gate,
 * caught by its own tests: with the fallthrough, `--base <sha not in this clone>`
 * silently judged the change against `main`'s tip instead and printed a
 * confident green. "The base you named is missing" and "you named no base" are
 * different facts, and only the second one may be answered by guessing. (The
 * sibling gate `check-i18n-en-drift.mjs` inherited the fallthrough shape from
 * this gate's first draft; it was fixed to match under objectui#3766, so the two
 * resolvers are the same shape again — keep them that way.)
 *
 * @returns {{ ok: true, ref: string, how: string } | { ok: false, tried: string[], shallow: boolean, named: boolean }}
 */
export function resolveBaseRef(root, { explicit = null, env = process.env } = {}) {
  const tried = [];
  const verify = (ref) => gitQuiet(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const shallow = () => gitQuiet(root, ['rev-parse', '--is-shallow-repository']) === 'true';

  const named = explicit
    ? { how: `--base ${explicit}`, ref: explicit }
    : env.OS_CHANGESET_BASE
      ? { how: `OS_CHANGESET_BASE=${env.OS_CHANGESET_BASE}`, ref: env.OS_CHANGESET_BASE }
      : null;

  if (named) {
    const resolved = verify(named.ref);
    tried.push(`${named.how}${resolved ? '' : ' (unresolved)'}`);
    return resolved
      ? { ok: true, ref: resolved, how: named.how }
      : { ok: false, tried, shallow: shallow(), named: true };
  }

  const attempt = (how, compute) => {
    const value = compute();
    tried.push(`${how}${value ? '' : ' (unresolved)'}`);
    return value ? { ok: true, ref: value, how } : null;
  };

  const candidates = [
    env.GITHUB_BASE_REF
      ? () =>
          attempt(`merge-base with origin/${env.GITHUB_BASE_REF}`, () =>
            gitQuiet(root, ['merge-base', 'HEAD', `origin/${env.GITHUB_BASE_REF}`]),
          )
      : null,
    () => attempt('merge-base with origin/main', () => gitQuiet(root, ['merge-base', 'HEAD', 'origin/main'])),
    () => attempt('merge-base with main', () => gitQuiet(root, ['merge-base', 'HEAD', 'main'])),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const hit = candidate();
    if (hit) return hit;
  }
  return { ok: false, tried, shallow: shallow(), named: false };
}

/**
 * `git diff --name-only` between `base` and `head`, or between `base` and the
 * WORKING TREE when `head` is null.
 *
 * The working tree is the default "after" side on purpose, exactly as in
 * `check-i18n-en-drift.mjs`: an author running this locally gets the answer
 * before committing. In CI the checkout is clean, so the two coincide.
 *
 * `-z` rather than newline-delimited output: it removes git's path quoting from
 * the picture entirely, so a non-ASCII or space-bearing path is read verbatim
 * instead of arriving as an escaped string this parser would have to unescape.
 * The NUL separator is written as an escape sequence and never as a raw byte
 * (objectui#3388 / objectstack#4890 — one raw control byte makes grep treat the
 * whole file as binary and every later grep over it silently returns nothing).
 *
 * Throws with git's own stderr on failure. The caller turns that into exit 1: a
 * diff that cannot be computed is not an empty diff.
 *
 * @param {string[]} pathspecs extra pathspecs; `[]` means the whole tree
 * @returns {string[]} repo-relative POSIX paths
 */
export function changedFiles(root, { base, head = null, filter = null, pathspecs = [] }) {
  const args = ['diff', '--name-only', '-z'];
  if (filter) args.push(`--diff-filter=${filter}`);
  args.push(base);
  if (head) args.push(head);
  if (pathspecs.length > 0) args.push('--', ...pathspecs);

  let out;
  try {
    out = git(root, args);
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`\`git ${args.join(' ')}\` failed${stderr ? `:\n    ${stderr}` : ''}`);
  }
  return out.split(String.fromCharCode(NUL)).filter((path) => path !== '');
}

/**
 * `.changeset/*.md` files that exist on disk but are not tracked yet.
 *
 * `git diff` against the working tree cannot see an untracked file, and
 * `pnpm changeset` leaves precisely that: a brand-new, unstaged file. Without
 * this, running the gate locally right after writing a changeset would report the
 * changeset missing — a false red that teaches the author the gate is broken.
 * Empty in CI, where the checkout has no untracked files.
 */
export function untrackedChangesets(root) {
  const out = gitQuiet(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    ':(glob).changeset/*.md',
  ]);
  return out === null ? [] : out.split(String.fromCharCode(NUL)).filter((path) => path !== '');
}

// -- the guarded surface ------------------------------------------------------

/** Turns a changesets `ignore` entry (`@object-ui/example-*`) into a matcher. */
function ignoreMatcher(patterns) {
  const expressions = patterns.map(
    (pattern) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '.*' : `\\${c}`))}$`),
  );
  return (name) => expressions.some((expression) => expression.test(name));
}

/**
 * The release configuration, read from `.changeset/config.json`.
 *
 * A missing `.changeset/` directory or an unreadable config THROWS. objectui#3387
 * names that case explicitly: the gate's whole job is to demand a declaration, so
 * losing the ability to tell what a declaration would even be about must be a red
 * build and not a quiet pass.
 */
export function readReleaseConfig(root) {
  const dir = join(root, '.changeset');
  if (!existsSync(dir)) {
    throw new Error(
      `${dir} does not exist. This gate reads \`.changeset/config.json\` to learn which ` +
        'packages a release covers; without it there is nothing to check against.',
    );
  }
  const configPath = join(dir, 'config.json');
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read .changeset/config.json: ${error.message}`);
  }
  const versioned = new Set((config.fixed ?? []).flat());
  if (versioned.size === 0) {
    throw new Error(
      '.changeset/config.json declares an empty `fixed` group, so this gate would guard nothing ' +
        'and pass everything. That is a configuration error, not an empty guarded set.',
    );
  }
  return { versioned, isIgnored: ignoreMatcher(config.ignore ?? []) };
}

/**
 * The package's own `files` list, normalised to repo-shaped relative paths.
 *
 * `['./plugin.ts', 'dist/']` and `['plugin.ts', 'dist']` describe the same
 * tarball, and npm accepts both spellings; clause (c) of the population rule
 * compares changed paths against these entries, so the two spellings must not
 * produce two different guarded surfaces.
 *
 * A package with NO `files` field publishes its whole directory. That is not read
 * as "everything counts": the one such package here (`packages/vscode-extension`)
 * is `private: true` and reaches no registry, and taking the absent field as a
 * blanket would guard every tsconfig and doc page in it. Absent means clause (c)
 * matches nothing, and clauses (a) and (b) still apply.
 */
function publishedEntries(manifest) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  return files
    .map((entry) => (typeof entry === 'string' ? entry.replace(/^\.\//, '').replace(/\/+$/, '') : ''))
    .filter((entry) => entry !== '');
}

/**
 * `directory -> { name, versioned, ignored, files }` for every workspace package.
 *
 * Scans the same roots as `scripts/check-changeset-fixed.mjs` — one package per
 * immediate subdirectory — so the two gates agree about what a package is.
 *
 * @returns {Map<string, { name: string, versioned: boolean, ignored: boolean, files: string[] }>}
 */
export function discoverPackages(root, { versioned, isIgnored }) {
  const packages = new Map();
  for (const parent of PACKAGE_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(root, parent));
    } catch {
      continue; // a root that does not exist in this checkout
    }
    for (const entry of entries.sort()) {
      const manifest = join(root, parent, entry, 'package.json');
      try {
        if (!statSync(manifest).isFile()) continue;
      } catch {
        continue;
      }
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
      const name = parsed.name;
      if (!name) continue;
      packages.set(`${parent}/${entry}`, {
        name,
        versioned: versioned.has(name),
        ignored: isIgnored(name),
        files: publishedEntries(parsed),
      });
    }
  }
  return packages;
}

/**
 * The package-root HTML file a bundler compiles into the published `dist/`.
 *
 * Vite's build entry is this file and no other unless `rollupOptions.input` names
 * more, and nothing in this repository does. Sibling HTML at a package root
 * (`apps/console`'s `*-preview.html` pages) and HTML one level down
 * (`packages/plugin-grid/demo/index.html`) are dev-server pages that reach no
 * tarball, and neither is matched by an equality test on this exact name.
 */
export const HTML_ENTRY = 'index.html';

/**
 * Documentation and licences: published in the tarball, but not behaviour.
 *
 * Subtracted from clauses (b) and (c) of the population rule — never from (a).
 * `<pkg>/src/` keeps its all-of-it reading, so this predicate cannot narrow what
 * the gate guarded before objectui#5733.
 */
export function isDocumentation(relative) {
  const name = relative.slice(relative.lastIndexOf('/') + 1);
  return /^LICEN[SC]E/i.test(name) || /\.md$/i.test(name);
}

/**
 * Does `relative` — a path INSIDE `directory`, with the package directory already
 * stripped — count as that package's published, executable source?
 *
 * The three clauses are the ones the header states, in the same order:
 *
 *   (a) under `src/`;
 *   (b) the bundler's HTML entry;
 *   (c) published verbatim by the package's own `files` list.
 *
 * Clause (a) answers first and unconditionally, so the documentation subtraction
 * that (b) and (c) are subject to can never remove a file `src/` already covered.
 *
 * @param {string} relative
 * @param {{ files: string[] }} pkg
 */
export function isPublishedSource(relative, pkg) {
  if (relative.startsWith('src/')) return true;
  if (isDocumentation(relative)) return false;
  if (relative === HTML_ENTRY) return true;
  return (pkg.files ?? []).some((entry) => relative === entry || relative.startsWith(`${entry}/`));
}

/**
 * Splits changed paths into the ones this gate demands a declaration for and the
 * ones it cannot classify.
 *
 * `unclassified` is a changed source file under a package that appears in neither
 * the `fixed` group nor `ignore`. It is a loud failure rather than a skip: the
 * gate genuinely cannot tell whether that source ships, and guessing "no" would
 * silently re-open the hole for exactly the newest package in the repository.
 * `scripts/check-changeset-fixed.mjs` is the gate that owns the classification
 * itself, and its message is the one to follow.
 *
 * @param {string[]} paths
 * @param {Map<string, { name: string, versioned: boolean, ignored: boolean }>} packages
 */
export function classifyChangedPaths(paths, packages) {
  const guarded = [];
  const unclassified = [];
  const skipped = [];

  for (const path of paths) {
    let owner = null;
    for (const [directory, pkg] of packages) {
      if (path.startsWith(`${directory}/`) && isPublishedSource(path.slice(directory.length + 1), pkg)) {
        owner = { directory, pkg };
        break;
      }
    }
    if (owner === null) continue;
    const entry = { file: path, pkg: owner.pkg.name, directory: owner.directory };
    if (owner.pkg.versioned) guarded.push(entry);
    else if (owner.pkg.ignored) skipped.push(entry);
    else unclassified.push(entry);
  }
  return { guarded, unclassified, skipped };
}

// -- the manifest's published contract (objectui#6736) ------------------------

/** A package's own manifest, by name. */
export const MANIFEST = 'package.json';

/**
 * The `package.json` fields whose VALUE is the package's published contract.
 *
 * FIXED BY RULING, not by taste. objectui#6736 named this list and triage
 * ratified it as implementable as given, with the explicit rider that adding or
 * dropping a field is a decision to be taken on the card and not in a patch. The
 * header section "The manifest's published contract" carries the reasoning,
 * including what is deliberately absent (`version`, `dependencies`,
 * `devDependencies`, `scripts`) and why the two exclusions the card names fall
 * out of the list itself rather than out of a special case.
 *
 * Sorted alphabetically so the fields a failure names come out in one order
 * whatever moved.
 */
export const CONTRACT_FIELDS = [
  'engines',
  'exports',
  'files',
  'main',
  'module',
  'peerDependencies',
  'sideEffects',
  'types',
];

/**
 * A field that is not present at all.
 *
 * A bare word rather than a sentinel object because it is compared against
 * `JSON.stringify` output, which can never produce it: a string serialises WITH
 * its quotes, and every other type starts with a digit, a sign, `t`, `f`, `n`,
 * `[` or `{`. So "absent" and "the value is the string absent" stay two
 * different readings. Not a control byte, deliberately — see the `NUL` comment
 * above for what one of those costs a repository.
 */
const ABSENT = 'absent';

/** The one field both readings of the manifest share. */
const MANIFEST_FILES = 'files';

/**
 * One guarded field of one manifest, as a comparable string.
 *
 * `files` goes through `publishedEntries` — the SAME normalisation clause (c)
 * compares changed paths against — so `['dist']` and `['dist/']` are one value
 * to both readings of that field. Anything else is compared by
 * order-preserving serialisation: `exports` condition order is resolution order
 * in Node, so a reorder is a behaviour change and must not compare equal.
 *
 * @param {Record<string, unknown> | null} manifest parsed manifest, or null when
 *   the file is absent on that side of the diff
 * @param {string} field
 */
function fieldValue(manifest, field) {
  if (manifest === null) return ABSENT;
  if (!Object.prototype.hasOwnProperty.call(manifest, field)) return ABSENT;
  if (field === MANIFEST_FILES) return JSON.stringify(publishedEntries(manifest));
  return JSON.stringify(manifest[field]);
}

/**
 * Which of `CONTRACT_FIELDS` moved between two parsed manifests.
 *
 * Either side may be `null` (the manifest does not exist there): a package added
 * or removed reads as every guarded field it declares appearing or
 * disappearing, which is what happened.
 *
 * @param {Record<string, unknown> | null} before
 * @param {Record<string, unknown> | null} after
 * @returns {string[]} field names, in `CONTRACT_FIELDS` order
 */
export function manifestFieldsChanged(before, after) {
  return CONTRACT_FIELDS.filter((field) => fieldValue(before, field) !== fieldValue(after, field));
}

/**
 * One manifest as parsed JSON at `ref`, or `null` when it is not there.
 *
 * `ref === null` means the WORKING TREE, matching `changedFiles`' default "after"
 * side and `check-changeset-overwrite`'s `contentAt`: an author running this
 * locally is judged on what is on disk, before committing.
 *
 * A manifest that will not parse THROWS. It is an unreadable input like any
 * other here, and the direction is the one "Never silent" fixes: this gate
 * decides whether a declaration is owed, so "cannot tell" is a red build.
 */
function manifestAt(root, ref, file) {
  let source;
  if (ref === null) {
    const onDisk = join(root, file);
    source = existsSync(onDisk) ? readFileSync(onDisk, 'utf8') : null;
  } else {
    source = gitQuiet(root, ['show', `${ref}:${file}`]);
  }
  if (source === null) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `cannot parse ${file} at ${ref === null ? 'the working tree' : ref}: ${error.message}`,
    );
  }
}

/**
 * The changed manifests whose published contract moved, split the same three
 * ways as `classifyChangedPaths`.
 *
 * Only a WORKSPACE PACKAGE's own manifest is read: the path has to be exactly
 * `<a discovered package directory>` + `/package.json`. The repository root
 * manifest publishes nothing, and a `package.json` deeper inside a package is a
 * fixture or a nested config, not that package's contract.
 *
 * `unclassified` carries the same meaning it does for source — a package in
 * neither the `fixed` group nor `ignore`, which this gate refuses to guess
 * about — so the two classifications compose into one verdict instead of two.
 *
 * @param {string[]} paths changed paths, as `changedFiles` returned them
 * @param {Map<string, { name: string, versioned: boolean, ignored: boolean, files: string[] }>} packages
 */
export function contractChanges(root, { base, head = null, paths, packages }) {
  const guarded = [];
  const unclassified = [];
  const skipped = [];

  for (const path of paths) {
    if (!path.endsWith(`/${MANIFEST}`)) continue;
    const directory = path.slice(0, path.length - MANIFEST.length - 1);
    const pkg = packages.get(directory);
    if (pkg === undefined) continue;

    const fields = manifestFieldsChanged(manifestAt(root, base, path), manifestAt(root, head, path));
    if (fields.length === 0) continue;

    const entry = { file: path, pkg: pkg.name, directory, fields };
    if (pkg.versioned) guarded.push(entry);
    else if (pkg.ignored) skipped.push(entry);
    else unclassified.push(entry);
  }
  return { guarded, unclassified, skipped };
}

// -- declarations -------------------------------------------------------------

/**
 * What a candidate changeset file declares.
 *
 * `kind: 'none'` means there is no `---` … `---` frontmatter block at all, so the
 * file declares nothing and cannot serve as the declaration this gate demands.
 * `entries` counts `name: bump` lines; zero of them is the empty-frontmatter
 * exemption and is a valid pass.
 *
 * The frontmatter dialect is hand-parsed for the same reason as in
 * `check-changeset-no-major.mjs`: this gate runs on a bare checkout with no
 * `pnpm install`, so it may not import a YAML parser or `@changesets/*`.
 *
 * @returns {{ kind: 'none' } | { kind: 'frontmatter', entries: number }}
 */
export function describeDeclaration(source) {
  const lines = source.split(/\r?\n/);
  const open = lines.findIndex((line) => line.trim() === '---');
  if (open === -1) return { kind: 'none' };
  let entries = 0;
  let closed = false;
  for (let i = open + 1; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text === '---') {
      closed = true;
      break;
    }
    if (text === '' || text.startsWith('#')) continue;
    if (/^(?:"[^"]+"|'[^']+'|[^:]+?)\s*:\s*(?:major|minor|patch)\s*$/.test(text)) entries += 1;
  }
  return closed ? { kind: 'frontmatter', entries } : { kind: 'none' };
}

/**
 * Every `.changeset/*.md` this change ADDS, with what each one declares.
 *
 * Added, not merely present: `.changeset/` accumulates until a release, so "a
 * changeset exists in the tree" is satisfied by somebody else's pending
 * declaration and would make the gate vacuous for every change that follows one.
 *
 * @returns {{ file: string, declaration: ReturnType<typeof describeDeclaration> }[]}
 */
export function addedDeclarations(root, { base, head = null }) {
  const added = changedFiles(root, { base, head, filter: 'A', pathspecs: [':(glob).changeset/*.md'] });
  const candidates = [...added, ...(head === null ? untrackedChangesets(root) : [])];

  const seen = new Set();
  const results = [];
  for (const file of candidates) {
    const name = file.slice(file.lastIndexOf('/') + 1);
    if (NOT_A_CHANGESET.has(name) || seen.has(file)) continue;
    seen.add(file);
    // Added at `head`, so it is readable there — from disk when `head` is the
    // working tree, out of the object store otherwise.
    const source = head === null ? readFileSync(join(root, file), 'utf8') : gitQuiet(root, ['show', `${head}:${file}`]);
    results.push({ file, declaration: source === null ? { kind: 'none' } : describeDeclaration(source) });
  }
  return results.sort((a, b) => a.file.localeCompare(b.file));
}

// -- the analysis -------------------------------------------------------------

/**
 * @typedef {object} Analysis
 * @property {{ file: string, pkg: string, directory: string }[]} guarded
 * @property {{ file: string, pkg: string, directory: string, fields: string[] }[]} contract
 * @property {{ file: string, pkg: string, directory: string, fields?: string[] }[]} unclassified
 * @property {{ file: string, pkg: string, directory: string, fields?: string[] }[]} skipped
 * @property {{ file: string, declaration: { kind: string, entries?: number } }[]} declarations
 * @property {number} changedFileCount
 */

/**
 * The whole judgement for one repo root and one revision range. Throws on any
 * unreadable input; the CLI below turns that into exit 1.
 *
 * @returns {Analysis}
 */
export function analyze(root, { base, head = null }) {
  const config = readReleaseConfig(root);
  const packages = discoverPackages(root, config);
  const paths = changedFiles(root, { base, head });
  const source = classifyChangedPaths(paths, packages);
  const contract = contractChanges(root, { base, head, paths, packages });
  return {
    guarded: source.guarded,
    contract: contract.guarded,
    unclassified: [...source.unclassified, ...contract.unclassified],
    skipped: [...source.skipped, ...contract.skipped],
    declarations: addedDeclarations(root, { base, head }),
    changedFileCount: paths.length,
  };
}

/** The declarations that actually declare something (frontmatter present). */
export const usableDeclarations = (analysis) => analysis.declarations.filter((d) => d.declaration.kind !== 'none');

/**
 * `0` when the change is either unguarded or declared, `1` otherwise.
 *
 * @param {Analysis} analysis
 */
export function verdict(analysis) {
  if (analysis.unclassified.length > 0) return 1;
  if (analysis.guarded.length + analysis.contract.length === 0) return 0;
  return usableDeclarations(analysis).length > 0 ? 0 : 1;
}

/**
 * What changed, as one noun phrase both the red and the green message open with.
 *
 * Source files and contract changes are counted separately because they are
 * answered by looking at different things — a path, and a field's value — and a
 * message that merged them would send an author to grep for a file that is
 * green.
 *
 * @param {Analysis} analysis
 */
export function subjectPhrase(analysis) {
  const parts = [];
  if (analysis.guarded.length > 0) parts.push(`${analysis.guarded.length} source file(s)`);
  if (analysis.contract.length > 0) parts.push(`${analysis.contract.length} published-contract change(s)`);
  const packages = new Set([...analysis.guarded, ...analysis.contract].map((entry) => entry.pkg));
  return `${parts.join(' and ')} of ${packages.size} released package(s)`;
}

// -- CLI ----------------------------------------------------------------------

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };

  // `--root` points the gate at another checkout — a worktree, or one of the
  // throwaway repositories `check-changeset-presence.test.ts` builds to exercise
  // these exit codes end to end. `--base` / `--head` name the two commits;
  // both default to "this branch against its merge base with the target branch".
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));
  const head = argOf('--head');

  const base = resolveBaseRef(root, { explicit: argOf('--base') });
  if (!base.ok) {
    console.error(
      '❌  Cannot resolve the commit to compare against, so there is nothing to diff.\n' +
        `    tried: ${base.tried.join(', ')}\n` +
        (base.named
          ? '    That base was named EXPLICITLY, so it is not guessed around: comparing against\n' +
            '    some other commit instead would answer a question nobody asked, and answer it\n' +
            '    confidently. Name a commit that exists in this clone, or pass none and let the\n' +
            '    merge base with the target branch be found.\n'
          : base.shallow
            ? '    This clone is SHALLOW. In CI, give the checkout `fetch-depth: 0`; locally,\n' +
              '    run `git fetch --no-tags origin main` (or `git fetch --unshallow`).\n'
            : '    Fetch the base branch (`git fetch --no-tags origin main`) and re-run.\n') +
        '    This is a failure, not a skip: a diff gate with no diff would report a\n' +
        '    declaration present while having looked at nothing (objectstack#4928).',
    );
    process.exit(1);
  }

  let analysis;
  try {
    analysis = analyze(root, { base: base.ref, head });
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: this gate demands a declaration, so\n' +
        '    losing an input means it cannot tell whether one is owed (objectui#4690).',
    );
    process.exit(1);
  }

  const usable = usableDeclarations(analysis);
  const unreadable = analysis.declarations.filter((d) => d.declaration.kind === 'none');

  console.log(
    `Compared ${head ?? 'the working tree'} with ${base.ref.slice(0, 9)} (${base.how}): ` +
      `${analysis.changedFileCount} file(s) changed, ${analysis.guarded.length} of them published ` +
      `source of a package the release covers, ${analysis.contract.length} of them a manifest whose ` +
      `published contract moved, ${analysis.skipped.length} under a package changesets ` +
      `ignores, ${analysis.declarations.length} changeset(s) added.`,
  );

  if (analysis.unclassified.length > 0) {
    const packages = [...new Set(analysis.unclassified.map((entry) => `${entry.pkg} (${entry.directory})`))];
    console.error(
      `\n❌  ${analysis.unclassified.length} changed file(s) belong to a package that is in ` +
        'neither the `fixed` group nor `ignore` of .changeset/config.json:\n' +
        packages.map((name) => `      • ${name}`).join('\n') +
        '\n\n    So this gate cannot tell whether that package ships, and it will not guess "no" —\n' +
        '    that would leave the newest package in the repository the one nothing guards.\n' +
        '    Classify it: `node scripts/check-changeset-fixed.mjs` is the gate that owns this,\n' +
        '    and its message says where to add the name.',
    );
    process.exit(1);
  }

  if (analysis.guarded.length + analysis.contract.length === 0) {
    console.log(
      '✅  No source or published contract of a released package changed in this range, so no ' +
        'changeset is owed.' +
        (analysis.skipped.length > 0
          ? `\n    (${analysis.skipped.length} file(s) under a package changesets ignores were skipped.)`
          : ''),
    );
    process.exit(0);
  }

  if (usable.length > 0) {
    const releaseNothing = usable.every((d) => d.declaration.entries === 0);
    console.log(
      `✅  ${subjectPhrase(analysis)} changed, and this change declares ` +
        `${usable.length} changeset(s): ${usable.map((d) => d.file).join(', ')}.` +
        (releaseNothing
          ? '\n    Every one of them has an EMPTY frontmatter — declared as releasing nothing, which\n' +
            '    is the explicit exemption and a complete answer to this gate.'
          : ''),
    );
    if (unreadable.length > 0) {
      console.log(
        `    Note: ${unreadable.length} added file(s) under .changeset/ have no frontmatter block ` +
          `and declare nothing: ${unreadable.map((d) => d.file).join(', ')}.`,
      );
    }
    process.exit(0);
  }

  // A contract change names its FIELDS. Without them the line reads "your
  // package.json changed", which is true of a version bump this gate passes —
  // an author sent to look for a change the gate did not object to.
  const byPackage = new Map();
  for (const entry of [...analysis.guarded, ...analysis.contract]) {
    if (!byPackage.has(entry.pkg)) byPackage.set(entry.pkg, []);
    byPackage.get(entry.pkg).push(entry.fields ? `${entry.file} — ${entry.fields.join(', ')}` : entry.file);
  }

  console.error(`\n❌  ${subjectPhrase(analysis)} changed, and this change adds no changeset:\n`);
  for (const [pkg, lines] of [...byPackage].sort()) {
    console.error(`      ${pkg}`);
    for (const line of lines.slice(0, 5)) console.error(`          ${line}`);
    if (lines.length > 5) console.error(`          … and ${lines.length - 5} more`);
  }
  if (unreadable.length > 0) {
    console.error(
      `\n    ${unreadable.length} added file(s) under .changeset/ have no \`---\` frontmatter block, ` +
        `so they declare nothing: ${unreadable.map((d) => d.file).join(', ')}.`,
    );
  }
  console.error(`
    Run \`pnpm changeset\` and describe the change. It is what puts this work into a
    CHANGELOG, a version number and the platform's release notes: objectstack#4731 /
    #4843 made the DECLARED changesets the only criterion for what shipped, so an
    undeclared fix is invisible everywhere afterwards — objectui#3387 found three of
    them, including a user-visible chart fix and an i18n fix that no release record
    mentions.

    If this change really should release nothing, say so — that is a pass, not a
    workaround. Add .changeset/<name>.md with an EMPTY frontmatter:

        ---
        ---

        Test-only change to the grid column resolver; no published behaviour changes.

    A published-contract line above names FIELDS rather than a file: what moved is one
    of ${CONTRACT_FIELDS.join(', ')} in that package's
    package.json, and each of those is read by consumers of the tarball. \`version\`,
    \`dependencies\`, \`devDependencies\` and \`scripts\` are NOT guarded — a
    \`changeset version\` bump and a Dependabot devDependency bump go green here by
    construction (objectui#6736).

    Scored \`minor\` at most, never \`major\`: every package is in one fixed group, so
    one major carries all of them off the @objectstack major this repo is pinned to
    (AGENTS.md §版本号策略, enforced by scripts/check-changeset-no-major.mjs).

    See the header of scripts/check-changeset-presence.mjs.`);
  process.exit(1);
}
