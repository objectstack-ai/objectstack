#!/usr/bin/env node
/**
 * check-shell-escape-residue -- rejects a known MACHINE-PRODUCED shell-quote
 * escape run that has leaked into a fenced code block in agent-facing markdown.
 *
 *   node scripts/check-shell-escape-residue.mjs          (pnpm check:shell-escape-residue)
 *   node scripts/check-shell-escape-residue.mjs --list   every fence the walk examined
 *   node scripts/check-shell-escape-residue.mjs --json
 *
 * Exit: 0 = no enumerated residue inside a fenced block, and the population did
 *       not collapse. 1 = one of those.
 *
 * ## ⛔ WHAT THIS GATE DOES NOT DO -- read this before citing it as coverage
 *
 * It checks ONE ENUMERATED LITERAL (`RESIDUE_PATTERNS`, currently a single
 * entry) inside fenced blocks in five roots. That is the whole of it.
 *
 *   ⛔ It does NOT make fenced shell examples executable-by-construction, and
 *      nothing in this repository does. A ```bash block may be syntactically
 *      invalid, may never terminate, may reference a flag that does not exist,
 *      may `rm -rf` the wrong path -- this gate is green on every one of them.
 *      EXECUTABILITY IS UNGUARDED. `scripts/__tests__/check-shell-escape-residue.test.ts`
 *      asserts that as a FACT rather than as a sentence in this header: it feeds
 *      the gate a fence carrying an unterminated heredoc and a broken `if`, and
 *      requires a PASS.
 *
 *   ⛔ The unbuilt option is objectui#5151's "direction 1": run `bash -n` over
 *      every ```bash / ```sh block. It was ruled out of this card, not rejected
 *      on the merits, and it carries a dependency worth recording so nobody
 *      re-proposes it blindly -- IT IS ONLY AS GOOD AS ITS EXTRACTION
 *      CONVENTION. In objectui#5150's own example the block sits inside a
 *      numbered list, so in the raw file both lines carry a two-space indent,
 *      and a heredoc opened `<<` + a quoted terminator requires that terminator
 *      at COLUMN 0. Rendered markdown strips the container indent and the block
 *      looks fine. ⭐ Agents read these files by `cat`, not by rendering them,
 *      so a verbatim copy INCLUDING the indent hangs in exactly the way the
 *      original defect did. Whether `bash -n` catches that depends entirely on
 *      whether the extractor dedents first -- so if direction 1 is ever built,
 *      decide and STATE what the extractor does with container indentation, and
 *      pick the answer matching how the file is actually consumed.
 *
 *   ⛔ It does not judge text OUTSIDE a fenced block. See "The one deliberate
 *      narrowing" below; the census counts those occurrences so the exclusion is
 *      a number rather than a silence.
 *
 *   ⛔ It does not JUDGE text outside `SCAN_ROOTS`. It does make one narrow
 *      claim ABOUT what is outside them: every `.md`/`.mdx` under a
 *      `COVERAGE_TREES` entry must be reached by some declared root, so an
 *      agent-tree document no row covers is RED rather than a silent gap
 *      (objectui#7413). That is a membership test over the walk's own output --
 *      it never reads a file the scan did not read, and it never judges one.
 *
 * The name is chosen to say all of that: `shell-escape-residue`, not
 * `shell-examples`. A gate named for a general property while checking a literal
 * list is how "no gate covers this" becomes "a gate covers this" in someone's
 * head a month later (objectui#5151 triage, made binding at dispatch).
 *
 * ## The defect (objectui#5150, fixed by PR #5152; the class is objectui#5151)
 *
 * `AGENTS.md` §9 recommends `git commit -F -` with a heredoc. The line landed as
 * the heredoc introducer with its `EOF` wrapped in the single-quote-inside-
 * single-quote shell escape -- five characters, all printable ASCII. Copied
 * verbatim it opens a heredoc whose terminator is not `EOF`, so the closing line
 * never matches.
 *
 * Two amplifiers, and the card's weight is both of them together:
 *
 *   1. **There is no error to look at.** It does not exit with a message. It
 *      HANGS. A reader will not attribute a hung terminal to the document, and
 *      will fall back to exactly the workaround the clause argues against.
 *   2. **Agent-facing text is re-read once per session.** `AGENTS.md`,
 *      `CLAUDE.md`, `skills/**` and `.claude/skills/**` are inputs to every
 *      seat, so a bad example is not paid once -- it is paid by every reader.
 *      Those are also where this repository does most of its shell
 *      demonstrating. ⭐ The contributor tree under `.claude/skills/**` is on
 *      this surface for exactly that reason and no other (objectui#7403): it is
 *      not published, but it is agent-WRITTEN and agent-READ, which is both
 *      halves of the generating mechanism below.
 *
 * And the GENERATING MECHANISM IS FIXED AND REPRODUCIBLE: an agent writing a
 * file through a shell heredoc that is itself nested inside a single-quoted
 * argument leaks that escape run into the content. Neither side guarded it --
 * not the producing side, not the checking side.
 *
 * ## What was measured, and why a gate rather than a note (objectui#5151)
 *
 * The broken bytes were re-planted on the fix branch and the FULL derived gate
 * union for a change to `AGENTS.md` was run against them:
 *
 *     check-control-bytes       exit 0   -- judges control bytes; 0x27 and 0x22
 *                                          are printable, so out of set BY DESIGN
 *     check-doc-links           exit 0   -- has AGENTS.md in scope, but parses
 *                                          LINKS; block contents are not read
 *     check-changeset-presence  exit 0   -- judges declarations, never content
 *     check-changeset-no-major  exit 0   -- likewise
 *
 * All green. Not one of them was negligent: the residue is printable ASCII in a
 * code block, and no scan surface in this repository reached it. That is the
 * hole, and this file is the narrow half of it.
 *
 * ## ⚠️ GREEN AT REST -- so the ablation is the only evidence this gate exists
 *
 * There were ZERO occurrences in the tree when this landed (PR #5152 removed the
 * only one) and there should stay zero. A green run over today's tree therefore
 * proves only that today's tree is clean; it cannot distinguish a working gate
 * from one matching nothing at all -- which is objectui#5151's own defect, one
 * level up. Two consequences, both load-bearing and both copied deliberately
 * from `check-vi-mock-specifiers.mjs` (objectui#5646), which is green at rest
 * for the same reason:
 *
 *   1. **The population must refuse to collapse.** Zero roots resolved, zero
 *      files scanned, or a fence count under `FENCE_FLOOR` is not a clean tree;
 *      it is a broken walk, and reporting OK for it would be this card's defect
 *      wearing the gate's uniform. Each is a FAILURE.
 *   2. **⚠️ A root that does not exist is LOUD, never a silent zero.** A
 *      mistyped root and a clean root produce identical output otherwise, and
 *      the mistyped one reads as coverage forever. `SCAN_ROOTS` declares each
 *      root's `kind`, so a root that vanished, moved, or turned from a file into
 *      a directory is reported by name and separately from an ordinary finding.
 *   3. **The verdict line carries the census** -- files and fences PER ROOT --
 *      so a reader sees the population the green was computed over.
 *
 * `scripts/__tests__/check-shell-escape-residue.test.ts` carries the ablation:
 * objectui#5150's exact shipped line, reconstructed on a fixture tree.
 *
 * ## The enumeration, and why it has exactly one member
 *
 * `RESIDUE_PATTERNS` is a list of literals OBSERVED to be produced by a machine
 * and shipped. It has one entry because exactly one has been observed. ⛔ Adding
 * a second requires an observed instance, not a plausible one: the entire value
 * of this direction over direction 1 is that its false-positive rate is zero,
 * and the first speculative entry spends that.
 *
 * The measured population of the current entry across the four roots, at the
 * commit this landed on, is ZERO inside fences and ZERO outside them. Still
 * ZERO on both counts across five roots when objectui#7403 added
 * `.claude/skills` -- 20 fences in 4 files arrived clean.
 *
 * ## ⚠️ The literal is legitimate shell -- so the claim here is narrower
 *
 * `'` + `"` + `'` + `"` + `'` is the standard way to put a literal single quote
 * inside a single-quoted string, and a hand-written one-liner may use it
 * correctly. This gate does not claim otherwise. It claims something smaller and
 * checkable: in THESE ROOTS the sequence has never once been intentional, and
 * every occurrence so far was a write-path leak.
 *
 * If a deliberate instance is ever genuinely needed in a documented example, the
 * equivalent `'\''` spelling is not matched here and is the documented remedy.
 * ⛔ There is deliberately no allowlist, baseline or inline opt-out: with a
 * measured population of zero, a permit mechanism would be the only thing in
 * this file anyone ever reached for.
 *
 * ## The one deliberate narrowing: fenced blocks only
 *
 * Occurrences are JUDGED inside a fenced code block and COUNTED everywhere else,
 * with the outside-fence count reported in the census. The reason is that prose
 * about this defect class has to be able to NAME the literal -- objectui#5151's
 * own body does, and a future `AGENTS.md` clause documenting this very gate
 * would too -- and no mechanical rule separates "quoting the residue" from
 * "shipping it" in running text.
 *
 * ⚠️ This is a known gap, not a claim of completeness: residue inside an INLINE
 * code span is just as copy-pasteable and is NOT judged here. The census figure
 * is what keeps that visible -- a non-zero `outsideFences` is a number a reader
 * can act on. An exclusion nobody can see in the census is how a scan narrows
 * itself into vacuity.
 *
 * ## One fence walker, not a second copy
 *
 * `scanFences` is imported from `check-doc-fence-languages.mjs` rather than
 * re-implemented. Fence scanning is already this repository's answer to "where
 * does a code block start and end", it is pinned by that gate's own test, and
 * objectui#3261/#3279 are the standing lesson that a second copy of one fact is
 * a second answer that drifts. It costs nothing: that module's whole import
 * graph is node builtins plus `./invoked-as.mjs`, so this gate stays in the
 * cheap pre-install tier that `check-pre-install-import-graph.mjs` enforces.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { scanFences } from './check-doc-fence-languages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root -- this file lives at `scripts/` depth 0. */
export function repoRoot() {
  return resolve(HERE, '..');
}

/** Documents the walk reads. */
const DOC_EXTENSIONS = ['.mdx', '.md'];

/**
 * The scan surface, declared -- objectui#5151's dispatch ruling, verbatim:
 * `AGENTS.md`, `CLAUDE.md`, `skills/**`, `content/docs/**`; widened to
 * `.claude/skills/**` by objectui#7403, for the reason recorded below.
 *
 * `kind` and `minFiles` exist for the "loud, never a silent zero" rule above.
 * `minFiles` is a COLLAPSE floor set with room, not today's count: the point is
 * to catch a walk that broke, not to pin figures that move every day. Measured
 * when this landed: 1 / 1 / 18 / 184 files, 12 / 2 / 235 / 1056 fences.
 *
 * ## ⭐ objectui#7403 -- a per-root floor measures the roots that are DECLARED,
 * never the tree that walked out of them
 *
 * objectui#7251 moved two contributor guides from `skills/objectui/` into
 * `.claude/skills/objectui-contributor/`. No row reached the new location, so 18
 * fenced blocks left this gate's surface in one commit and NOTHING WENT RED: the
 * `skills` row carries `minFiles: 5` and 16 files stayed behind it, so the floor
 * was satisfied by the tree that REMAINED while the tree that LEFT went
 * unmeasured. A floor is a collapse detector, not a coverage detector, and no
 * floor can be made to do the second job -- the only thing that catches a move
 * is declaring the new location, which is why a move and its `SCAN_ROOTS` row
 * belong in one change (the unresolved-root text in `main()` says the same for a
 * root that vanishes; this is its blind side). The sibling gate
 * `check-skills-paths.mjs` lost 55 stated paths to the same move and was widened
 * the same way in objectui#7358.
 *
 * Measured for the widening (objectui#7403, `6aeba67`): 4 files, 20 fences under
 * `.claude/skills` --
 * `objectui-contributor/guides/console-development.md` 9,
 * `objectui-contributor/rules/no-touch-zones.md` 9, `verify/SKILL.md` 2,
 * `objectui-contributor/SKILL.md` 0. The first two carry the 18 blocks
 * objectui#7251 moved; the other two had never been on this surface at all. All
 * four arrived with zero residue, inside fences and outside them.
 *
 * ⛔ `minFiles: 3` for that row -- PER ROOT, never a whole-surface floor, which
 * is the shape that failed: on a day this root reads ZERO the other four still
 * return all but its handful of documents, so any total floor is green through
 * the whole outage. The relation is the whole argument and it needs no figure:
 * every run prints each root's own population through `summarise()` below, and
 * that verdict line is where a reader takes today's counts. A count copied into
 * this comment is true only on the day it is written -- this paragraph carried
 * two that were not (objectui#8122). Seeded the way the others were, under the
 * count at the time, with room for ordinary movement, and still red for the
 * shape that caused this card -- the `objectui-contributor` tree leaving reads
 * 1, the two guides alone leaving reads 2.
 *
 * ⚠️ The row is `.claude/skills`, not `.claude` -- and the difference is only
 * about files that do not exist yet. Every `.md`/`.mdx` under `.claude/` today
 * is under `.claude/skills/` (4 of 4), so the two specs read the same tree; the
 * narrower one was declared because it is the subtree whose contents are
 * agent-read prose by construction. ⛔ It therefore does NOT reach a future
 * `.claude/agents/*.md` or `.claude/commands/*.md` -- which is this card's own
 * class one step out. That is objectui#7413, and it is closed by
 * `COVERAGE_TREES` below rather than by widening this row: the row keeps
 * declaring what is SCANNED, and the coverage tree turns a document the row
 * does not reach into a RED gate that names the file.
 *
 * ⚠️ `AGENTS.md`, `CLAUDE.md`, `skills/**` and `.claude/**` are GOVERNED SURFACE
 * (AGENTS.md §受管面). This gate READS them and never writes: a finding in one of
 * those is reported for a human to act on, and fixing it is a separate,
 * human-merged change. That is a property of the remedy, not of the scan.
 */
export const SCAN_ROOTS = Object.freeze([
  { spec: 'AGENTS.md', kind: 'file', minFiles: 1 },
  { spec: 'CLAUDE.md', kind: 'file', minFiles: 1 },
  { spec: 'skills', kind: 'dir', minFiles: 5 },
  { spec: '.claude/skills', kind: 'dir', minFiles: 3 },
  { spec: 'content/docs', kind: 'dir', minFiles: 100 },
]);

/**
 * ## objectui#7413 -- coverage, which no floor can express
 *
 * Trees in which EVERY `.md`/`.mdx` must be reached by some `SCAN_ROOTS` row. A
 * document under one of these that no row reaches is a FAILURE naming the file.
 *
 * ⭐ This is the second half of objectui#7403's lesson, and the half a floor
 * cannot do. `minFiles` asks "did this root still return enough files?" -- a
 * COLLAPSE detector, and collapse is only one of the two ways coverage is lost:
 *
 *   root walked to zero      -> `minFiles` fires        (objectui#7251's move)
 *   root declared, file NEW  -> nothing fires           (this card)
 *   root ROW DELETED         -> nothing fires           (this card, worse)
 *
 * On the day `.claude/agents/reviewer.md` is written with a fenced shell
 * example, `.claude/skills` still returns its 4 files, every floor is satisfied,
 * every root resolves, and the new document is simply not on the surface. That
 * is objectui#5151's own defect one level up -- a green that means "nothing was
 * looked at" -- and it is only ever noticed by someone going and looking. Row
 * deletion is the same shape with no signal at all: an unresolved root is loud,
 * but a row someone REMOVED leaves nothing behind to be loud about.
 *
 * ## ⛔ Why it cannot disagree with the scan about what a document is
 *
 * Coverage is a set-membership test over the walk's OWN output: `scan` collects
 * every path `listDocuments` returned for every resolved root, then asks the
 * same `listDocuments` for the tree. One walk, one `DOC_EXTENSIONS`, one
 * definition of "document". A re-derivation -- a second glob, a prefix match on
 * the row's `spec` -- would be a second answer to one fact, free to drift from
 * the first (objectui#3261/#3279), and the drift would land on the side that
 * reads as coverage. ⛔ Do not reintroduce one.
 *
 * ## The rows, and why `skills` is here while `content/docs` is not
 *
 * `.claude` is the card's own case: the declared row is a PROPER SUBTREE of it,
 * so the tree can grow documents outside the row. Measured on `e1545cf`: 4 of 4
 * `.claude` documents under `.claude/skills`, so this row is green today by
 * construction and its whole job is the next file.
 *
 * `skills` is the generalisation objectui#7413 asked to be measured. Its row is
 * the WHOLE tree, so today the test is a tautology -- 16 of 16 -- and it costs
 * one extra walk of 16 files and nothing else. It is declared anyway because a
 * tautology is exactly what it stops being under the one edit nothing else here
 * catches: NARROWING the `skills` row to a subtree, or deleting it. Neither
 * shows up as unresolved, and both leave the published skills tree unscanned.
 *
 * ⛔ `content/docs` is deliberately NOT a coverage tree. Same mechanics, but a
 * different claim: this gate's roots are the agent-facing surface (objectui#5151
 * ruled it, objectui#7403 widened it), and `content/docs` is published prose
 * that happens to share the scan. Declaring coverage over it would assert a
 * completeness promise about the docs tree that no card has ruled. If that is
 * ever wanted, rule it on its own card -- the mechanism takes one row.
 *
 * ⛔ This is not an allowlist and there is no per-file opt-out: the two ways to
 * clear a finding are to move the document under a declared root, or to declare
 * a new root for it. Both are the deliberate decision the gap deserves.
 */
export const COVERAGE_TREES = Object.freeze([
  { spec: '.claude', kind: 'dir' },
  { spec: 'skills', kind: 'dir' },
]);

/**
 * Literals OBSERVED to be machine-produced and shipped. One entry; see the
 * header for why a second one needs an observed instance rather than an
 * argument.
 *
 * This source file is not itself in `SCAN_ROOTS`, so the literal is written out
 * plainly here rather than assembled from code points.
 */
export const RESIDUE_PATTERNS = Object.freeze([
  {
    id: 'single-quote-in-single-quote',
    literal: `'"'"'`,
    /** What a reader sees when this fires. */
    what: 'the single-quote-inside-single-quote shell escape',
    instance: 'objectui#5150 -- AGENTS.md §9 shipped `git commit -F -` with its heredoc terminator wrapped in it',
    remedy: "Delete the escape run. Inside a fenced example the quotes are already literal, so the intended text is the bare form (`<<` + 'EOF' quoted once). If a literal single quote inside a single-quoted string is genuinely meant, spell it '\\'' -- that form is not matched here.",
  },
]);

/**
 * Total fenced blocks below which the walk did not happen. 1305 were examined
 * when this landed; the floor is set far under that on purpose -- it catches a
 * fence walker that stopped matching, not a day when the docs got shorter.
 */
export const FENCE_FLOOR = 400;

/** Every document under one resolved root, repo-relative, in a stable order. */
export function listDocuments(root, spec, kind) {
  const abs = join(root, spec);
  if (kind === 'file') return [spec];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (DOC_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(abs);
  return out;
}

/**
 * Resolve one declared root, or say precisely how it failed to resolve.
 *
 * @returns {{ spec: string, kind: string, ok: boolean, problem: string | null }}
 */
export function resolveRoot(root, { spec, kind }) {
  const abs = join(root, spec);
  if (!existsSync(abs)) return { spec, kind, ok: false, problem: 'does not exist' };
  const isDir = statSync(abs).isDirectory();
  if (kind === 'file' && isDir) return { spec, kind, ok: false, problem: 'is declared a file but is a directory' };
  if (kind === 'dir' && !isDir) return { spec, kind, ok: false, problem: 'is declared a directory but is a file' };
  return { spec, kind, ok: true, problem: null };
}

/** Every occurrence of every pattern on one line, as 1-based columns. */
function occurrencesOn(line) {
  const found = [];
  for (const pattern of RESIDUE_PATTERNS) {
    let from = 0;
    for (;;) {
      const at = line.indexOf(pattern.literal, from);
      if (at === -1) break;
      found.push({ patternId: pattern.id, column: at + 1 });
      from = at + 1; // overlapping runs are separate findings, not one
    }
  }
  return found;
}

/**
 * One finding: a residue occurrence inside a fenced block.
 *
 * @typedef {{
 *   line: number,
 *   column: number,
 *   patternId: string,
 *   fenceLine: number,
 *   language: string,
 *   text: string,
 * }} ResidueHit
 */

/**
 * One document's residue, split into what is judged and what is only counted.
 *
 * Pure -- the test drives it over fixture sources rather than over the tree.
 *
 * @returns {{ fences: number, hits: ResidueHit[], outsideFences: number }}
 */
export function findResidue(source) {
  const lines = source.split('\n');
  const blocks = scanFences(source);

  const hits = [];
  for (const block of blocks) {
    const body = block.body === '' ? [] : block.body.split('\n');
    body.forEach((text, i) => {
      for (const o of occurrencesOn(text)) {
        hits.push({
          // `fenceLine` is the 1-based line of the OPENING fence, so the body
          // starts on the line after it.
          line: block.fenceLine + 1 + i,
          column: o.column,
          patternId: o.patternId,
          fenceLine: block.fenceLine,
          language: block.language,
          text: text.trim().slice(0, 100),
        });
      }
    });
  }

  let total = 0;
  for (const text of lines) total += occurrencesOn(text).length;

  return { fences: blocks.length, hits, outsideFences: total - hits.length };
}

/**
 * The one scan. `main()`, `--list`, `--json` and the test suite all go through
 * here, so the tests exercise the real code path rather than an imitation.
 *
 * @param {string} root Repository root to scan.
 * @param {{ roots?: ReadonlyArray<object>, fenceFloor?: number,
 *          coverageTrees?: ReadonlyArray<object> }} [options]
 *   `roots` overrides `SCAN_ROOTS` (fixtures declare their own); `fenceFloor`
 *   overrides `FENCE_FLOOR` -- pass 0 for a fixture tree, which is legitimately
 *   far below any repo floor; `coverageTrees` overrides `COVERAGE_TREES`.
 */
export function scan(root, { roots = SCAN_ROOTS, fenceFloor = FENCE_FLOOR, coverageTrees = COVERAGE_TREES } = {}) {
  const perRoot = [];
  const unresolved = [];
  const hits = [];
  /**
   * Every document the walk reached, repo-relative. objectui#7413's coverage
   * test is membership in THIS set -- the scan's own output, never a second
   * derivation of it.
   */
  const scanned = new Set();
  let outsideFences = 0;

  for (const declared of roots) {
    const resolved = resolveRoot(root, declared);
    if (!resolved.ok) {
      unresolved.push({ ...resolved, role: 'scan root' });
      perRoot.push({ spec: declared.spec, files: 0, fences: 0, minFiles: declared.minFiles, resolved: false });
      continue;
    }

    const documents = listDocuments(root, declared.spec, declared.kind);
    for (const rel of documents) scanned.add(rel);
    let fences = 0;
    for (const rel of documents) {
      let source;
      try {
        source = readFileSync(join(root, rel), 'utf8');
      } catch {
        continue; // symlink, gitlink, unreadable -- nothing to judge
      }
      const found = findResidue(source);
      fences += found.fences;
      outsideFences += found.outsideFences;
      for (const hit of found.hits) hits.push({ file: rel, root: declared.spec, ...hit });
    }

    perRoot.push({
      spec: declared.spec,
      files: documents.length,
      fences,
      minFiles: declared.minFiles,
      resolved: true,
    });
  }

  // objectui#7413 -- every document under a coverage tree must have been reached
  // by some declared root above. A tree that does not resolve is LOUD for the
  // same reason a scan root is: a mistyped coverage tree covers nothing, and
  // reads as coverage forever.
  const uncovered = [];
  const coverage = [];
  for (const tree of coverageTrees) {
    const resolved = resolveRoot(root, tree);
    if (!resolved.ok) {
      unresolved.push({ ...resolved, role: 'coverage tree' });
      coverage.push({ spec: tree.spec, documents: 0, uncovered: 0, resolved: false });
      continue;
    }
    const documents = listDocuments(root, tree.spec, tree.kind);
    const missing = documents.filter((rel) => !scanned.has(rel));
    for (const rel of missing) uncovered.push({ file: rel, tree: tree.spec });
    coverage.push({ spec: tree.spec, documents: documents.length, uncovered: missing.length, resolved: true });
  }

  const census = {
    roots: roots.length,
    rootsResolved: perRoot.filter((r) => r.resolved).length,
    files: perRoot.reduce((n, r) => n + r.files, 0),
    fences: perRoot.reduce((n, r) => n + r.fences, 0),
    perRoot,
    outsideFences,
    coverage,
  };

  // The population, checked for collapse. See "GREEN AT REST" in the header.
  const vacuous = [];
  for (const r of perRoot) {
    if (r.resolved && r.files < r.minFiles) {
      vacuous.push({ what: `files under ${r.spec}`, value: r.files, floor: r.minFiles });
    }
  }
  if (census.fences < fenceFloor) {
    vacuous.push({ what: 'fenced blocks examined', value: census.fences, floor: fenceFloor });
  }

  return { census, hits, unresolved, uncovered, vacuous };
}

/** The census, as one line, for the verdict. */
export function summarise({ census }) {
  const per = census.perRoot
    .map((r) => `${r.spec}: ${r.resolved ? `${r.files} file(s), ${r.fences} fence(s)` : 'UNRESOLVED'}`)
    .join('; ');
  // The coverage figure is in the verdict for the same reason the per-root
  // census is: a reader has to see the population a green was computed over.
  const cover = census.coverage
    .map((c) => `${c.spec}: ${c.resolved ? `${c.documents - c.uncovered}/${c.documents}` : 'UNRESOLVED'}`)
    .join('; ');
  return (
    `${census.rootsResolved}/${census.roots} root(s) resolved -- ${per}; ` +
    `${census.files} file(s) and ${census.fences} fenced block(s) examined in total; ` +
    `${census.outsideFences} occurrence(s) outside a fence (counted, not judged); ` +
    `coverage -- ${cover} document(s) under a declared root`
  );
}

function main() {
  const result = scan(repoRoot());
  const { hits, unresolved, uncovered, vacuous } = result;

  if (hits.length === 0 && unresolved.length === 0 && uncovered.length === 0 && vacuous.length === 0) {
    console.log(`✅  check-shell-escape-residue: OK (${summarise(result)}).`);
    process.exit(0);
  }

  if (hits.length > 0) {
    const plural = hits.length === 1 ? 'fenced block carries' : 'fenced blocks carry';
    console.error(`❌  check-shell-escape-residue: ${hits.length} ${plural} machine-produced shell-escape residue\n`);
    console.error('  Copied verbatim, an example carrying this run does not fail with a message --');
    console.error('  it HANGS on a heredoc terminator that never matches. A reader will not');
    console.error('  attribute that to the document (objectui#5150 / objectui#5151):\n');
    for (const hit of hits) {
      const pattern = RESIDUE_PATTERNS.find((p) => p.id === hit.patternId);
      console.error(`    - ${hit.file}:${hit.line}:${hit.column} -- ${pattern.what}`);
      console.error(`      in the \`${hit.language || '(no info string)'}\` fence opened at line ${hit.fenceLine}:`);
      console.error(`        ${hit.text}`);
    }
    const remedies = [...new Set(hits.map((h) => RESIDUE_PATTERNS.find((p) => p.id === h.patternId).remedy))];
    console.error(`\n${remedies.map((r) => `  ${r}`).join('\n\n')}`);
    console.error(`
⚠️  AGENTS.md, CLAUDE.md, skills/** and .claude/** are GOVERNED SURFACE. A
finding in one of those is for a human to fix in its own change -- report it, do
not fold the fix into an unrelated pull request. A finding under content/docs/**
is an ordinary docs fix.

⛔ This gate checks an enumerated literal. It does NOT check that fenced shell
examples are executable -- nothing does. See this script's header.`);
  }

  if (unresolved.length > 0) {
    console.error('\n❌  check-shell-escape-residue: a declared root did not resolve\n');
    for (const u of unresolved) console.error(`    - ${u.spec} (${u.role}, declared ${u.kind}) ${u.problem}`);
    console.error(`
A root that is gone is reported rather than skipped, because a MISTYPED root and
a CLEAN root produce identical output otherwise -- and the mistyped one reads as
coverage for as long as nobody checks. If the file genuinely moved, move it in
\`SCAN_ROOTS\` -- or in \`COVERAGE_TREES\` for a coverage tree -- in the same
change.`);
  }

  if (uncovered.length > 0) {
    const plural = uncovered.length === 1 ? 'document is' : 'documents are';
    console.error(`\n❌  check-shell-escape-residue: ${uncovered.length} agent-tree ${plural} on no scan root\n`);
    for (const u of uncovered) console.error(`    - ${u.file} (under the coverage tree \`${u.tree}\`)`);
    console.error(`
These files exist, they are markdown in a tree this gate claims, and NO
\`SCAN_ROOTS\` row reaches them -- so their fenced blocks are unjudged and every
floor above is still satisfied by the files that ARE covered (objectui#7413).
A \`minFiles\` floor detects a root that COLLAPSED; it cannot detect a document
that was never on the surface, which is why this is a separate judgement.

Two ways to clear it, both deliberate -- there is no per-file opt-out:
  - move the document under a root \`SCAN_ROOTS\` already declares, or
  - add a \`SCAN_ROOTS\` row for its location, in the same change that adds it.`);
  }

  if (vacuous.length > 0) {
    console.error('\n❌  check-shell-escape-residue: the population COLLAPSED -- this run proves nothing\n');
    for (const v of vacuous) console.error(`    - ${v.what}: found ${v.value}, floor is ${v.floor}`);
    console.error(`
This gate is GREEN AT REST -- there is nothing to find on an ordinary day -- so a
scan that silently examined nothing is indistinguishable from a passing one. That
is objectui#5151's own defect, one level up, so it is a FAILURE here instead.

Something upstream of the judgement broke: a root moved, the document walk
stopped matching \`.md\`/\`.mdx\`, or the fence walker in
\`check-doc-fence-languages.mjs\` changed shape. Fix the walk. If a floor is
genuinely too high because the tree changed, move it in \`SCAN_ROOTS\` /
\`FENCE_FLOOR\` deliberately and say why -- never to make a red run green.

Census: ${summarise(result)}`);
  }

  process.exit(1);
}

// Run only when invoked directly -- the test suite imports `scan` and friends
// and must not trigger a repo scan (or a `process.exit`) on import.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--json')) {
    const result = scan(repoRoot());
    console.log(JSON.stringify({ census: result.census, hits: result.hits, unresolved: result.unresolved, uncovered: result.uncovered, vacuous: result.vacuous }, null, 2));
  } else if (process.argv.includes('--list')) {
    const result = scan(repoRoot());
    for (const r of result.census.perRoot) {
      console.log(`${r.resolved ? 'ok        ' : 'UNRESOLVED'}  ${r.spec.padEnd(16)} ${r.files} file(s), ${r.fences} fence(s)`);
    }
    for (const c of result.census.coverage) {
      console.log(`${c.resolved ? 'coverage  ' : 'UNRESOLVED'}  ${c.spec.padEnd(16)} ${c.documents - c.uncovered}/${c.documents} document(s) under a declared root`);
    }
    for (const hit of result.hits) console.log(`RESIDUE     ${hit.file}:${hit.line}:${hit.column}  ${hit.patternId}`);
    for (const u of result.uncovered) console.log(`UNCOVERED   ${u.file}  (tree ${u.tree})`);
    console.log(`\n${summarise(result)}`);
  } else {
    main();
  }
}
