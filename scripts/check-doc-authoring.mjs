#!/usr/bin/env node
// check-doc-authoring.mjs — guard the docs/skills corpus against the bare
// metadata-literal anti-pattern (#2035 / ADR-0059).
//
// The example apps are kept on the `defineX` factories by an ESLint rule, but
// TypeScript code blocks inside Markdown/MDX are not type-checked or linted by
// anything — which is exactly how skills/ and content/docs/ drifted back to
// teaching `: Page = {}` while the examples stayed clean. Skills are the corpus
// AI authors from, so a bad sample there is worse than one in app code.
//
// This scans ```ts|typescript|tsx fenced blocks for an exported metadata literal
// annotated with one of the 16 factory domains (or its `Input` alias) instead of
// being wrapped in the `defineX(...)` factory, and fails if it finds one.
//
//   node scripts/check-doc-authoring.mjs
//   node scripts/check-doc-authoring.mjs --self-test
//
// ## Scope (#4913)
//
// `.claude/` is in scope for the same reason `skills/` is, and more so: the
// published `skills/` corpus is what AI authors *apps* from, while `.claude/`
// (skills, agent definitions, workflows) is the operating manual every agent
// session loads and copies from. A bare literal taught there is copied into app
// code by the next agent that reads it. The root was `['skills', 'content']`
// until #4913 — top-level `skills/` only — so nothing checked the corpus the
// agents themselves read. The root is `.claude`, not `.claude/skills`, so the
// next subdirectory added under it is covered on arrival rather than missed the
// same way twice.
//
// ## `docs/` is corpus too — but not all of it (#4929)
//
// #4916 fixed one direction (a root declared but no longer resolvable). This is
// the symmetric one: a directory that really exists, really teaches metadata
// authoring, and was simply never declared. `docs/` was that directory —
// `docs/notes/crm-development-standards.mdx` alone carries 16 ts blocks, and
// ADR-0010 / 0015 / 0017 / 0057 plus `docs/design/permission-model.md` all show
// `defineX(...)` calls. AGENTS.md Prime Directive #13 sends every agent to grep
// the ADRs before changing behaviour under them, so a bare literal in an ADR is
// copied into app code exactly the way one in `skills/` is. It was added while
// the corpus was still at zero violations: that window is the cheapest possible
// moment to take a directory in, and once it closes the same decision becomes an
// argument about either rewriting history or granting an exemption.
//
// Three subtrees are exempt **by path** below. They are process records, not
// corpus — read the SKIP_PATHS comment for why that is a permanent exemption and
// not a backlog item.
//
// The root is `docs`, not the three live subdirectories, for the same reason
// #4913 took `.claude` rather than `.claude/skills`: a new subdirectory under it
// is covered on arrival instead of being missed the same way twice. That also
// covers the hand-written top-level guides (`docs/protocol-upgrade-guide.md`,
// `docs/upgrading-to-11.md`, …), which are live instructions to the reader and
// belong in scope.
//
// ## Dead roots are a hard error (#4916)
//
// `collectFiles()` used to walk each root inside `try { ... } catch {}`. Rename,
// move or delete any one of them and the ENOENT was swallowed in place: the scan
// finished the *remaining* roots and printed `✓ ... N files clean`, exit 0. From
// outside, "every root is clean" and "one root was never opened" are the
// same output with a smaller N, and nobody reads N. So every ROOT is now resolved
// at startup and an unresolvable one fails the gate **by name**. There is no
// optional root and no empty catch — see `assertRootsResolvable` for why a
// whitelist would be the wrong shape here rather than merely unnecessary.
//
// ## A scan that finds nothing is a hard error too (#4932)
//
// #4916 closed one spelling of the evaporation: the ROOT no longer resolves.
// This closes the other, which that assertion cannot see — the root resolves and
// the corpus is no longer inside it. A subtree moves out, a `SKIP_PATHS` entry
// widens, an authoring convention changes the extension: the root is still a
// directory, so `assertRootsResolvable` is satisfied, the walk returns fewer
// files, and the printed count drops in silence. `✓ 362 files clean` and
// `✓ 0 files clean` are the same sentence to every reader and the same exit code
// to CI — which is all of #4932: the count was printed and never asserted.
//
// The floor is PER ROOT, not on the total. A total floor is held up by whichever
// root still has files while another empties (`.claude` alone keeps it positive),
// and "part of the corpus was read" is precisely the verdict this gate must not
// resolve in the corpus's favour. It is a floor of one file per declared root,
// derived from the walk that just ran — deliberately NOT a ratchet against a
// recorded high-water mark, which would have to be maintained and would turn
// every legitimate deletion into an argument with a number.
//
// It lives in `collectFiles`, not in `main`, so the self-test drives the
// invariant itself rather than a proxy for it.
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

const ROOTS = ['.claude', 'docs', 'skills', 'content'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'references']);
// Whole subtrees skipped by path, not by directory name — a bare name would also
// skip a legitimately-named directory anywhere else in the corpus.
//
// `.claude/worktrees/` is where an agent's per-task git worktree lands in the
// environments that keep them inside the repo (it is gitignored, and AGENTS.md
// Prime Directive #11 makes one per task). This walker is `readdirSync`, not
// `git ls-files`, so .gitignore does not exclude it: without this entry the scan
// descends into a FULL SECOND COPY of the repository per parallel agent, which
// is both slow and — worse — reports violations that belong to some other
// branch's working tree. A gate whose failures are not about your change is a
// gate people learn to ignore.
//
// `docs/audits`, `docs/handoff` and `docs/plans` are the historical exemption
// (#4929) — NOT an oversight, and NOT a backlog item to shrink later. They are
// dated, one-shot process records: an audit report, a handoff note, a plan
// written on a particular day about the state of the repo on that day. Nothing
// in them is offered to the reader as "author it this way"; they are evidence of
// what was true then. Putting them in scope would subject a two-month-old
// handoff to today's lint permanently, and the only two ways out of that red are
// to edit the record — which falsifies it — or to add the exemption anyway, one
// argument later. The rest of `docs/` is live instruction and stays in scope, so
// the line is "does this document tell you how to write metadata now?", not
// "is it under docs/?". A doc that starts as a plan and becomes the standing
// guide should be moved out of `docs/plans` rather than exempted in place.
//
// (If one of these directories is ever renamed the skip silently stops matching
// and its files enter the scan — a loud red, not a silent hole, which is the
// safe direction for a stale entry to fail in.)
const SKIP_PATHS = new Set([
  '.claude/worktrees',
  'docs/audits',
  'docs/handoff',
  'docs/plans',
]);
// Generated from spec/frontmatter — not hand-authored, don't police.
const SKIP_FILES = new Set(['content/docs/ai/skills-reference.mdx']);

/**
 * ROOTS above, written in the subtree spelling `scripts/pm/dispatch-gates.mjs`
 * compares in. Provenance ONLY: nothing in this gate reads this list, and the
 * scan behaves exactly as it did without it.
 *
 * ## The gap this closes (#9964's declaration pattern, sixth instance)
 *
 * That tool builds every dispatch's gate list by scanning each gate's own source
 * for the path literals it operates on, and "looks like a path" there means
 * "carries a separator" — or names a top-level DOTTED directory, which is the
 * one arm that saved `.claude`. So three of the four ROOTS were bare words that
 * never became a hint, while `SKIP_PATHS` below spells its entries with
 * separators, and those DID.
 *
 * The result was a declaration almost exactly inverted. Measured on `main` at
 * 9dd192d48b, this gate's whole hint set was:
 *
 *   .claude                                  the one live root the dotted-dir
 *                                            arm admitted —  6 of 389 files
 *   .claude/worktrees, docs/audits,          the exemptions, i.e. subtrees it
 *   docs/handoff, docs/plans,                deliberately does NOT read
 *   content/docs/ai/skills-reference.mdx
 *
 * — five of its six declared paths were exclusions, and 383 of its 389 walked
 * files (98.5%) were declared by nothing at all. `docs/**`, `skills/**` and
 * `content/**` below are what close that; `.claude/**` is redundant with the
 * bare `.claude` the extractor already takes, and is kept so the declaration is
 * uniform across ROOTS rather than depending on which arm happened to admit
 * which root.
 *
 * That is worse than declaring nothing, and worse in the direction that hides
 * it: the residue line still PRINTED gate names, so the row read as "declared,
 * just not relevant to you". A card editing `docs/qa/platform-checklist/` — a
 * file this gate does read — derived an EMPTY union and met this REQUIRED gate
 * (lint.yml, `Doc/skill authoring guard`) as red CI instead of as a local
 * command. That is the cost this file's own header opens with, one level up:
 * a check that reported on a corpus nobody could see it was reading.
 *
 * ## Why the subtree spelling, and not a wider extractor
 *
 * `hintCovers` refuses a bare single-segment literal (`docs`) as too generic BY
 * DESIGN, and that refusal is measured rather than incidental: teaching the
 * extractor to accept bare top-level directory words was priced at +139084
 * fabricated (gate, file) pairs, because `packages`, `apps` and `examples` are
 * path COMPONENTS in dozens of gates that never read those roots. A declared
 * subtree is a different claim from a bare word — an author stating what the
 * gate reads, in the syntax the repo uses for that everywhere else — and the
 * glob collapse reduces each of these back to one ROOTS entry and to nothing
 * else.
 *
 * ## Why the ROOT, and not the live subtrees under it (the SKIP_PATHS question)
 *
 * `hintCovers` has no way to SUBTRACT: hints are positive containment, so
 * "`docs/**` except `docs/plans`" is not expressible. The exempt subtrees are
 * therefore claimed by this declaration, and that is a DELIBERATE, bounded
 * residual rather than an oversight — pinned as such in the self-test, so it
 * cannot silently grow past the exemptions it is accounted for.
 *
 * Declaring the live subtrees instead was considered and refused on three
 * grounds. It does not remove the residual (`SKIP_PATHS` spells those paths as
 * module-body literals, so they stay hints whatever this list says — only
 * unquoting them the way `DEFAULT_BASE_REF` is assembled would, at the cost of
 * obscuring this file's most safety-critical constant). It contradicts the
 * reason the ROOT is `docs` and not its three live subdirectories, argued at
 * the top of this file: a new subdirectory is covered on arrival instead of
 * being missed the same way twice — and a declaration that has to be extended
 * by hand is the same silent narrowing, one tool over. And it strands the
 * twelve hand-written top-level guides (`docs/protocol-upgrade-guide.md`,
 * `docs/upgrading-to-11.md`, …), which are files rather than a subtree and
 * would have to be enumerated one literal each.
 *
 * The residual is also not new: those four subtrees derive this gate TODAY, via
 * the `SKIP_PATHS` literals. This declaration subsumes those hints and adds
 * nothing to that side while closing all 389 files of the missing side.
 *
 * What the precedent does draw a line at is claiming a tree the ROOTS do not
 * reach at all, and the self-test in `scripts/pm/dispatch-gates.mjs` pins that
 * negative half against the real extractor — the load-bearing direction for a
 * declaration this broad, since a gate named on EVERY card is the louder
 * version of naming none. Carve-outs INSIDE a walked root are the tolerated
 * case there: `check:role-word` declares `skills/**` while skipping every
 * `references/` directory under it, and `check:slot-lookup-ratchet` declares
 * the whole of `packages/**`.
 *
 * ## Provenance, never a lookup key
 *
 * The glob form appearing in ROOTS would send `walk()` at a directory that does
 * not exist — since #4916 a hard refusal rather than a silent skip, but one
 * that fails naming the wrong problem. The self-test pins both halves.
 */
const ROOT_WATCH_HINTS = ['.claude/**', 'docs/**', 'skills/**', 'content/**'];

const DOMAINS = [
  'Datasource', 'Connector', 'Policy', 'SharingRule', 'Position', 'PermissionSet',
  'EmailTemplateDefinition', 'Report', 'Webhook', 'ObjectExtension', 'Cube',
  'Mapping', 'Theme', 'TranslationBundle', 'Page', 'Action',
].join('|');
const NS = '(?:UI\\.|Data\\.|System\\.|Security\\.|Identity\\.|Automation\\.|Integration\\.)?';
// The optional `Input` suffix is a LEGACY spelling as of protocol 17: ADR-0122
// phase 2 (#6083) moved the author state onto the bare name and retired every
// `XInput` synonym of it. The arm stays anyway — this gate reads the corpus that
// gets pasted into app code, where a sample carrying the retired spelling is
// still the anti-pattern AND now names a type that no longer exists.
const BARE = new RegExp(`^export const \\w+:\\s*${NS}(?:${DOMAINS})(?:Input)?\\s*=\\s*\\{`);
const FENCE_OPEN = /^```(?:ts|typescript|tsx)\s*$/;
const FENCE_CLOSE = /^```\s*$/;

const posix = (p) => p.split(sep).join('/');

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (SKIP_PATHS.has(posix(p))) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.mdx?$/.test(e) && !SKIP_FILES.has(posix(p))) out.push(p);
  }
}

/** A declared ROOT that could not be resolved to a directory. Carries the names. */
class DeadRootError extends Error {
  constructor(dead) {
    super(`unresolvable ROOT(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
    this.name = 'DeadRootError';
    this.dead = dead;
    /** @type {string[]} just the root names, for callers that only need to point. */
    this.roots = dead.map((d) => d.root);
  }
}

/**
 * Resolve every declared ROOT before scanning anything; throw naming the ones that
 * are not directories.
 *
 * Deliberately no whitelist / no "optional root" flag. A whitelist is the right
 * shape when a root is *legitimately* absent in some checkout form, and none of
 * these are: `.claude`, `docs`, `skills` and `content` are all git-tracked
 * directories with tracked files in them, so any checkout that can run
 * `pnpm check:doc-authoring` at the repo root has all of them. Adding an optional
 * marker "just in case" would hand the next author a supported way to silence this
 * failure (`optional: true`) instead of fixing the rename — which is the empty
 * `catch {}` again, only spelled politely. If a root ever does become legitimately
 * absent, that is a real decision: add the entry *with* its condition and a test,
 * don't relax the check.
 *
 * @throws {DeadRootError}
 */
function assertRootsResolvable(roots = ROOTS) {
  const dead = [];
  for (const root of roots) {
    let stat = null;
    try {
      stat = statSync(root);
    } catch (err) {
      dead.push({ root, reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})` });
      continue;
    }
    if (!stat.isDirectory()) dead.push({ root, reason: 'exists but is not a directory' });
  }
  if (dead.length) throw new DeadRootError(dead);
}

/**
 * A declared ROOT that resolved to a directory and yielded no file to scan.
 * Carries the names, and the total the run would otherwise have reported.
 */
class EmptyRootError extends Error {
  constructor(empty, total) {
    super(`ROOT(s) contributed no Markdown/MDX file: ${empty.join(', ')} (total scanned: ${total})`);
    this.name = 'EmptyRootError';
    /** @type {string[]} the roots that yielded nothing. */
    this.roots = empty;
    /** @type {number} files found across all roots — 0 when the whole scan evaporated. */
    this.total = total;
  }
}

/**
 * Every Markdown/MDX file in scope, relative to the current working directory.
 *
 * Nothing here is wrapped in a catch: an unreadable root fails loudly above, and an
 * error *inside* `walk` (a vanished file, a permission fault) means the corpus was
 * only partly read — which must not be reported as a clean scan either.
 *
 * Each root must also actually YIELD something (#4932). A root that resolves but
 * holds no Markdown is the same evaporation as a root that does not resolve, minus
 * the ENOENT that made the first kind detectable: the walk succeeds, the count
 * shrinks, and nothing in the output distinguishes "clean" from "never read".
 *
 * @throws {DeadRootError} a declared ROOT is not a directory.
 * @throws {EmptyRootError} a declared ROOT resolved but contributed no file.
 */
function collectFiles() {
  assertRootsResolvable();
  const files = [];
  const empty = [];
  for (const r of ROOTS) {
    const before = files.length;
    walk(r, files);
    if (files.length === before) empty.push(r);
  }
  if (empty.length) throw new EmptyRootError(empty, files.length);
  return files;
}

/** Bare metadata literals inside ts/tsx fenced blocks of one file's source. */
function findViolations(source, file) {
  const out = [];
  const lines = source.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!inBlock) { if (FENCE_OPEN.test(ln)) inBlock = true; continue; }
    if (FENCE_CLOSE.test(ln)) { inBlock = false; continue; }
    if (BARE.test(ln)) out.push({ file: posix(file), line: i + 1, text: ln.trim() });
  }
  return out;
}

// The reverse proof, made permanent (#4913). `.claude/` currently holds zero ts
// code blocks, so adding it to ROOTS leaves the gate green — which is exactly
// what "added it and it still cannot see the directory" looks like from outside.
// Five defects of that family closed in one week (#4690 / #4804 / #4835 / #4868
// / #4890): a gate running, green, and structurally unable to reach the thing it
// claims to check. So the wiring is asserted against a real temporary tree —
// walked with the real walker, from the real ROOTS — rather than only the regex.
function selfTest() {
  const bare = ['```ts', 'export const dashboard: Page = {', "  name: 'dashboard',", '};', '```'].join('\n');
  const bareNs = ['```tsx', 'export const settings: UI.PageInput = {', '};', '```'].join('\n');
  const wrapped = ['```ts', 'export const ok = definePage({', '});', '```'].join('\n');
  const jsFence = ['```js', 'export const dashboard: Page = {', '};', '```'].join('\n');
  const prose = ['Do not write `export const dashboard: Page = {` in app code.'].join('\n');

  const tree = {
    // The whole point of #4913: a violation here must be found.
    '.claude/skills/demo/SKILL.md': bare,
    '.claude/agents/os-dev.md': bareNs,
    // ...and one in another agent's worktree copy must NOT be, or every parallel
    // agent's in-flight branch becomes this gate's problem.
    '.claude/worktrees/other-agent/skills/demo/SKILL.md': bare,
    // #4929, both directions. The live `docs/` corpus is in scope...
    'docs/adr/0010-metadata-protection-model.md': bare,
    'docs/notes/crm-development-standards.mdx': bareNs,
    'docs/design/permission-model.md': wrapped,
    // ...including hand-written top-level guides, since the root is `docs`.
    'docs/protocol-upgrade-guide.md': bare,
    // ...and the dated process records are exempt by path. The SAME violating
    // body sits in each of these three: if the exemption ever stops matching,
    // these turn red and say so, instead of the pair of assertions below both
    // passing for the wrong reason.
    'docs/audits/2026-06-spec-audit.md': bare,
    'docs/handoff/2026-06-handoff.md': bare,
    'docs/plans/v18-rollout.md': bare,
    // Pre-existing roots keep working.
    'skills/legit/SKILL.md': wrapped,
    'content/docs/ui/pages.mdx': [jsFence, prose].join('\n\n'),
    // Not Markdown, and an explicitly exempt file.
    '.claude/settings.json': '{}',
    'content/docs/ai/skills-reference.mdx': bare,
  };

  const dir = mkdtempSync(join(tmpdir(), 'doc-authoring-selftest-'));
  const cwd = process.cwd();
  const failures = [];
  const expect = (label, got, want) => {
    if (got !== want) failures.push(`  ✗ self-test "${label}": expected ${want}, got ${got}`);
  };

  try {
    for (const [rel, body] of Object.entries(tree)) {
      const full = join(dir, ...rel.split('/'));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    process.chdir(dir);
    const files = collectFiles().map(posix);
    const violations = files.flatMap((f) => findViolations(readFileSync(f, 'utf8'), f));

    expect('.claude is walked', files.includes('.claude/skills/demo/SKILL.md'), true);
    expect('.claude is not limited to skills/', files.includes('.claude/agents/os-dev.md'), true);
    expect(
      '.claude/worktrees is skipped',
      files.some((f) => f.startsWith('.claude/worktrees/')),
      false,
    );
    expect('SKIP_FILES still applies', files.includes('content/docs/ai/skills-reference.mdx'), false);
    expect('markdown files collected', files.length, 8);
    expect('bare literal in .claude/skills is a violation', violations.some((v) => v.file === '.claude/skills/demo/SKILL.md'), true);
    expect('namespaced Input alias in .claude/agents is a violation', violations.some((v) => v.file === '.claude/agents/os-dev.md'), true);
    expect('defineX factory form passes', violations.some((v) => v.file === 'skills/legit/SKILL.md'), false);
    expect('non-ts fence and prose pass', violations.some((v) => v.file === 'content/docs/ui/pages.mdx'), false);

    // --- #4929: the live docs/ corpus is reachable, the process records are not. ---
    // Stated as two halves of one claim, because either half alone is satisfied by
    // a scope that is simply wrong in the other direction: "docs/adr is red" is
    // also true of a scope that swallows the whole of docs/, and "docs/handoff is
    // green" is also true of the pre-#4929 scope that never opened docs/ at all.
    expect('docs/adr is walked', files.includes('docs/adr/0010-metadata-protection-model.md'), true);
    expect('docs/notes is walked', files.includes('docs/notes/crm-development-standards.mdx'), true);
    expect('docs/design is walked', files.includes('docs/design/permission-model.md'), true);
    expect('top-level docs guides are walked', files.includes('docs/protocol-upgrade-guide.md'), true);
    expect('bare literal in docs/adr is a violation', violations.some((v) => v.file === 'docs/adr/0010-metadata-protection-model.md'), true);
    expect('namespaced Input alias in docs/notes is a violation', violations.some((v) => v.file === 'docs/notes/crm-development-standards.mdx'), true);
    expect('bare literal in a top-level docs guide is a violation', violations.some((v) => v.file === 'docs/protocol-upgrade-guide.md'), true);
    expect('defineX form in docs/design passes', violations.some((v) => v.file === 'docs/design/permission-model.md'), false);
    for (const exempt of ['docs/audits', 'docs/handoff', 'docs/plans']) {
      expect(`${exempt} is not walked`, files.some((f) => f.startsWith(`${exempt}/`)), false);
      expect(`${exempt} reports no violation`, violations.some((v) => v.file.startsWith(`${exempt}/`)), false);
    }

    expect('total violations', violations.length, 5);

    // --- Reverse proof for the dead-root hard error (#4916), made permanent. ---
    // Everything above ran green over a tree where all three roots resolve. That
    // observation is worth nothing on its own: the defect being fixed here is a
    // gate that goes green *because* it could not reach a root. So break one root
    // the way a rename breaks it in the real repo, require red, require the red to
    // name the root that died and not the survivors, then restore it and require
    // green again. Red-then-green, in the same run, every run.
    const renamedRoot = join(dir, '.claude-renamed-by-self-test');
    renameSync(join(dir, '.claude'), renamedRoot);
    let deadErr = null;
    try { collectFiles(); } catch (err) { deadErr = err; }
    renameSync(renamedRoot, join(dir, '.claude'));

    expect('a renamed ROOT throws instead of quietly scanning less', deadErr instanceof DeadRootError, true);
    expect('the failure names the dead root', deadErr?.roots?.join(',') ?? '<none>', '.claude');
    expect('the failure does not blame the surviving roots', /docs|skills|content/.test(deadErr?.message ?? ''), false);

    // A ROOT that exists but is not a directory is dead in the same way: the old
    // `catch {}` swallowed its ENOTDIR exactly as it swallowed ENOENT.
    renameSync(join(dir, 'skills'), join(dir, 'skills-renamed-by-self-test'));
    writeFileSync(join(dir, 'skills'), 'not a directory');
    let notDirErr = null;
    try { collectFiles(); } catch (err) { notDirErr = err; }
    rmSync(join(dir, 'skills'));
    renameSync(join(dir, 'skills-renamed-by-self-test'), join(dir, 'skills'));

    expect('a ROOT that is a file is dead too', notDirErr?.dead?.[0]?.reason ?? '<none>', 'exists but is not a directory');

    // ...and restoring both roots restores the green, so the red above was caused
    // by the broken root and nothing else.
    expect('restoring the roots makes the scan green again', collectFiles().length, files.length);

    // --- Reverse proof for the empty-scan hard error (#4932), same discipline. ---
    // The direction was decided before it was run: a root that resolves and yields
    // nothing must be RED, and the red must name that root only. This is the case
    // #4916's assertion cannot reach — nothing is renamed, nothing is unreadable,
    // the corpus is simply not there any more.
    const emptiedRoot = join(dir, 'skills', 'legit', 'SKILL.md');
    rmSync(emptiedRoot);
    let emptyErr = null;
    try { collectFiles(); } catch (err) { emptyErr = err; }
    writeFileSync(emptiedRoot, wrapped);

    expect('a root that resolves but yields nothing is red', emptyErr instanceof EmptyRootError, true);
    expect('the failure names the empty root', emptyErr?.roots?.join(',') ?? '<none>', 'skills');
    expect('the failure does not blame the populated roots', /\.claude|docs|content/.test(emptyErr?.roots?.join(',') ?? ''), false);
    // The other roots were still scanned, so the total proves the run was not
    // simply aborted: 8 files minus the one just removed.
    expect('the failure reports what the run did find', emptyErr?.total ?? -1, files.length - 1);
    expect('restoring the file makes the scan green again', collectFiles().length, files.length);

    // ...and the extreme the issue named: every root resolves, the whole scan
    // finds nothing, and the old code printed `✓ 0 files clean` and exited 0.
    const bare2 = mkdtempSync(join(tmpdir(), 'doc-authoring-selftest-empty-'));
    let allEmptyErr = null;
    try {
      for (const r of ROOTS) mkdirSync(join(bare2, r), { recursive: true });
      process.chdir(bare2);
      try { collectFiles(); } catch (err) { allEmptyErr = err; }
    } finally {
      process.chdir(dir);
      rmSync(bare2, { recursive: true, force: true });
    }
    expect('a scan that finds nothing at all is red, not "0 files clean"', allEmptyErr instanceof EmptyRootError, true);
    expect('every empty root is named', allEmptyErr?.roots?.join(',') ?? '<none>', ROOTS.join(','));
    expect('the zero total is reported', allEmptyErr?.total ?? -1, 0);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The dispatch-gates declaration (#9964's pattern, sixth instance) ───────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or stale one runs green here forever and pays
  // itself out as a dev dispatched on a docs card with this REQUIRED gate
  // missing from the brief — which is exactly how it stood before this block.
  // Both sides are derived from ROOTS rather than re-spelled, so renaming or
  // widening a root cannot leave the declaration describing the old population.
  const separatorless = ROOTS.filter((r) => !r.includes('/'));
  expect('the declaration exists for every ROOT the hint extractor cannot see (a root with no '
    + 'path separator is refused as too generic, so it needs the subtree spelling)',
    separatorless.every((r) => ROOT_WATCH_HINTS.includes(`${r}/**`)), true);
  expect('and it declares no root this gate does not walk (a declaration that can drift from the '
    + 'scan is worse than none — it replaces a silent gate with a lying one)',
    ROOT_WATCH_HINTS.every((h) => ROOTS.includes(h.replace(/\/\*+$/, ''))), true);
  // Provenance, never a lookup key: the glob form appearing in ROOTS would send
  // `walk()` at a directory that does not exist. Since #4916 that is a hard
  // refusal rather than a silent skip, but it fails naming the wrong problem.
  expect('the declared form is NOT a ROOTS entry',
    ROOT_WATCH_HINTS.some((h) => ROOTS.includes(h)), false);
  // The residual, pinned rather than hidden. `hintCovers` is positive
  // containment with no way to subtract, so declaring a ROOT necessarily claims
  // the exempt subtrees carved out of it. That is accounted for — but only for
  // the exemptions themselves: every SKIP_PATHS entry must sit UNDER a declared
  // root, so a future exemption somewhere this declaration does not reach fails
  // here instead of quietly widening the over-claim.
  expect('every skipped subtree is one this declaration knowingly over-claims, and none is a '
    + 'surprise from outside the declared roots',
    [...SKIP_PATHS].every((p) => ROOTS.some((r) => p.startsWith(`${r}/`))), true);
  // The exemptions must stay a strict SUBSET of the walked roots: an entry that
  // WAS a whole root would mean the gate declares a population it never reads.
  expect('no exemption swallows a declared root whole',
    [...SKIP_PATHS].some((p) => ROOTS.includes(p)), false);

  if (failures.length) {
    console.error(`\n✗ check-doc-authoring self-test failed:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log('✓ check-doc-authoring self-test: scope wiring (.claude and the live docs/ corpus in, .claude/worktrees and docs/{audits,handoff,plans} out), detection, the dead-root hard error (red when a ROOT is renamed, green when restored), the empty-scan hard error (red when a root yields nothing and when the whole scan does, green when restored) and the dispatch-gates declaration (every separator-less ROOT declared as a subtree, nothing declared this gate does not walk, the over-claim bounded to SKIP_PATHS) all hold.');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let files;
  try {
    files = collectFiles();
  } catch (err) {
    if (err instanceof DeadRootError) {
      console.error(`\n✗ doc authoring guard: declared ROOT(s) do not resolve, so the scan would have been silently narrower:\n`);
      for (const d of err.dead) console.error(`  ${d.root} — ${d.reason}`);
      console.error(
        `\nEvery entry in ROOTS (scripts/check-doc-authoring.mjs) must be a directory in the checkout,` +
        `\nand this check runs from the repo root. If a corpus directory was renamed or moved, update` +
        `\nROOTS to follow it; if it was deleted, remove the entry deliberately. Do NOT restore a` +
        `\ntolerant skip: this used to be \`catch {}\`, and a dead root simply shrank the reported file` +
        `\ncount while the gate kept printing green (#4916).\n`,
      );
      process.exit(1);
      return;
    }
    if (err instanceof EmptyRootError) {
      console.error(
        `\n✗ doc authoring guard: declared ROOT(s) resolved but contributed no Markdown/MDX file, so` +
        `\nthis run would have reported a clean corpus it never read:\n`,
      );
      for (const r of err.roots) console.error(`  ${r} — 0 files`);
      console.error(
        `\n${err.total} file(s) were found in total across all of ROOTS.` +
        `\n\nEvery entry in ROOTS (scripts/check-doc-authoring.mjs) must yield at least one .md/.mdx` +
        `\nfile. The root still being a directory is not enough — that is all #4916's check can see.` +
        `\nIf the corpus moved to a new directory, point ROOTS at it; if a subtree was deliberately` +
        `\nemptied or removed, remove its ROOT entry in the same change. Do NOT lower this to a total` +
        `\ncount: one populated root would then cover for every evaporated one, which is the silent` +
        `\nnarrowing this assertion exists to stop (#4932).\n`,
      );
      process.exit(1);
      return;
    }
    throw err;
  }
  const violations = files.flatMap((file) => findViolations(readFileSync(file, 'utf8'), file));

  if (violations.length === 0) {
    console.log(`✓ doc authoring guard: ${files.length} files clean — no bare metadata literals.`);
    return;
  }

  console.error(`\n✗ Bare metadata-literal authoring found in docs/skills (#2035). Use the defineX factory instead:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}`);
  }
  console.error(`\n${violations.length} violation(s). Author via e.g. \`definePage({ ... })\` — a value import that fails loudly, validates at parse time, and is the one pattern AI should learn. See ADR-0059.\n`);
  process.exit(1);
}

main();
