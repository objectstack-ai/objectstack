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
// ## Dead roots are a hard error (#4916)
//
// `collectFiles()` used to walk each root inside `try { ... } catch {}`. Rename,
// move or delete any one of them and the ENOENT was swallowed in place: the scan
// finished the *remaining* roots and printed `✓ ... N files clean`, exit 0. From
// outside, "all three roots are clean" and "one root was never opened" are the
// same output with a smaller N, and nobody reads N. So every ROOT is now resolved
// at startup and an unresolvable one fails the gate **by name**. There is no
// optional root and no empty catch — see `assertRootsResolvable` for why a
// whitelist would be the wrong shape here rather than merely unnecessary.
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

const ROOTS = ['.claude', 'skills', 'content'];
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
const SKIP_PATHS = new Set(['.claude/worktrees']);
// Generated from spec/frontmatter — not hand-authored, don't police.
const SKIP_FILES = new Set(['content/docs/ai/skills-reference.mdx']);

const DOMAINS = [
  'Datasource', 'Connector', 'Policy', 'SharingRule', 'Position', 'PermissionSet',
  'EmailTemplateDefinition', 'Report', 'Webhook', 'ObjectExtension', 'Cube',
  'Mapping', 'Theme', 'TranslationBundle', 'Page', 'Action',
].join('|');
const NS = '(?:UI\\.|Data\\.|System\\.|Security\\.|Identity\\.|Automation\\.|Integration\\.)?';
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
 * these three are: `.claude`, `skills` and `content` are all git-tracked
 * directories with tracked files in them, so any checkout that can run
 * `pnpm check:doc-authoring` at the repo root has all three. Adding an optional
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
 * Every Markdown/MDX file in scope, relative to the current working directory.
 *
 * Nothing here is wrapped in a catch: an unreadable root fails loudly above, and an
 * error *inside* `walk` (a vanished file, a permission fault) means the corpus was
 * only partly read — which must not be reported as a clean scan either.
 */
function collectFiles() {
  assertRootsResolvable();
  const files = [];
  for (const r of ROOTS) walk(r, files);
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
    expect('markdown files collected', files.length, 4);
    expect('bare literal in .claude/skills is a violation', violations.some((v) => v.file === '.claude/skills/demo/SKILL.md'), true);
    expect('namespaced Input alias in .claude/agents is a violation', violations.some((v) => v.file === '.claude/agents/os-dev.md'), true);
    expect('defineX factory form passes', violations.some((v) => v.file === 'skills/legit/SKILL.md'), false);
    expect('non-ts fence and prose pass', violations.some((v) => v.file === 'content/docs/ui/pages.mdx'), false);
    expect('total violations', violations.length, 2);

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
    expect('the failure does not blame the surviving roots', /skills|content/.test(deadErr?.message ?? ''), false);

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
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n✗ check-doc-authoring self-test failed:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log('✓ check-doc-authoring self-test: scope wiring (.claude in, .claude/worktrees out), detection, and the dead-root hard error (red when a ROOT is renamed, green when restored) all hold.');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let files;
  try {
    files = collectFiles();
  } catch (err) {
    if (!(err instanceof DeadRootError)) throw err;
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
