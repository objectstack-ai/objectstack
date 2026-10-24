#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-ui-root-lookups -- a repo-root lookup by MARKER belongs to
 * `scripts/ui-root.mjs` alone.
 *
 *   node scripts/check-ui-root-lookups.mjs             # scan the tree (`pnpm check:ui-root-lookups`)
 *   node scripts/check-ui-root-lookups.mjs --list      # every hit, allowed or not, with its shape
 *   node scripts/check-ui-root-lookups.mjs --json
 *   node scripts/check-ui-root-lookups.mjs --self-test # the detector's own cases, no tree scan
 *
 * Exit: 0 = no lookup outside the helper and the allowlist is live
 *       1 = a lookup outside the helper, or an allowlist entry that matches
 *           nothing any more (stale), or the scan found no files at all
 *
 * ## The class (objectstack ruling D1: objectui becomes `ui/` of the monorepo)
 *
 * Standalone, "the directory that holds `.git`" and "the directory that holds
 * `pnpm-workspace.yaml`" and "`git rev-parse --show-toplevel`" all name the
 * objectui root. Inside the monorepo every one of them names the OBJECTSTACK
 * root, one level up, and the nested `pnpm-workspace.yaml` is gone because a
 * nested workspace root is ignored. A test that joins that answer with
 * `packages/core/...` then reads a path that does not exist. Measured on the
 * merge spike: one such test already failed, and 71 files carried one of the
 * spellings. `scripts/ui-root.mjs` resolves the root from its own location,
 * which is true in both layouts; this gate keeps the marker lookups from
 * growing back once they are migrated.
 *
 * ## What is a LOOKUP, and what is not
 *
 * The gate judges the call target, not the spelling, so the marker's name in a
 * string is not by itself a finding:
 *
 *   - FIRES  an existence probe (`existsSync`, `statSync`, `lstatSync`,
 *            `accessSync`) whose path names `.git` or `pnpm-workspace.yaml`,
 *            directly or through a `const` bound earlier in the file;
 *   - FIRES  a `git rev-parse --show-toplevel` / `--git-common-dir` argument;
 *   - FIRES  an import of `find-up` or a call of `findUp(...)`;
 *   - SILENT a `readFileSync` of `pnpm-workspace.yaml`: that reads the
 *            workspace's package globs as DATA from a root already known, and
 *            whether the file exists after the merge is the workspace card's
 *            question, not this one's;
 *   - SILENT a `.git` entry in a directory skip-list, a fixture that WRITES a
 *            `pnpm-workspace.yaml`, and any mention inside a comment.
 *
 * ## The allowlist is a ledger, not a bypass
 *
 * Every entry names a file and the reason its probe is not a repo-root lookup
 * (a CLI asking whether the USER's cwd is a workspace; the pin script, which
 * the merge deletes). An entry whose file no longer carries a hit is STALE and
 * reds the run, so the list can only shrink without being tended.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';
import { uiRoot } from './ui-root.mjs';

/** The one file that may look the root up -- it does not, but it is where a lookup would belong. */
export const HELPER = 'scripts/ui-root.mjs';
/** This gate names every spelling it hunts, so it is the one other file the scan skips. */
export const SELF = 'scripts/check-ui-root-lookups.mjs';

/** Directories scanned, relative to the objectui root. */
export const SCAN_ROOTS = ['scripts', 'packages', 'apps'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.vite', '.cache']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js']);

/** Markers whose EXISTENCE is what a root walk probes for -- as a whole literal or as a path's last segment. */
export const MARKERS = new Set(['.git', 'pnpm-workspace.yaml']);
const MARKER_SEGMENT = /(^|[\\/])(\.git|pnpm-workspace\.yaml)$/;
const namesMarkerText = (text) => MARKERS.has(text) || MARKER_SEGMENT.test(text);
const PROBES = new Set(['existsSync', 'statSync', 'lstatSync', 'accessSync']);
const GIT_ROOT_FLAGS = new Set(['--show-toplevel', '--git-common-dir']);

/**
 * Files that carry a probe this gate recognises and that is NOT a repo-root
 * lookup. Path → reason. A path listed here that carries no hit is stale.
 */
export const ALLOWLIST = new Map([
  [
    'scripts/objectstack-pin.mjs',
    'packs the pin from an objectstack tree and refuses one with no pnpm-workspace.yaml -- a probe of THAT tree, not of this root; the file itself is deleted at cutover',
  ],
  [
    'scripts/check-new-cross-file-line-citations.mjs',
    "the gate's subject is the REPOSITORY AT THE CWD (its self-test drives it against a scratch repository), so `gateRoot()` reads the toplevel and narrows to `uiRoot()` only when the objectui tree lies inside it -- a probe of THAT repository, not a lookup of this root",
  ],
  ['packages/cli/src/utils/app-generator.ts', "asks whether the USER's cwd is a pnpm workspace to choose the scaffold shape -- product behaviour, not a repo-root lookup"],
  ['packages/cli/src/utils/workspace-vite.ts', "asks whether the USER's cwd is a pnpm workspace before reading its globs -- product behaviour, not a repo-root lookup"],
  ['packages/cli/src/__tests__/app-generator.test.ts', 'mirrors the generator\'s own cwd predicate to compute the expected scaffold shape'],
]);

// Cheap pre-filter: a file that spells none of these cannot carry a hit. It is
// a SPEED filter only; every file that mentions one is parsed in full.
const PREFILTER = /\.git['"`]|pnpm-workspace\.yaml|--show-toplevel|--git-common-dir|find-up|findUp/;

function calleeName(node) {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Every `const`/`let` initializer in the file, by name (first declaration wins). */
function bindingsOf(src) {
  const binds = new Map();
  const walk = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !binds.has(node.name.text)) {
      binds.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(src, walk);
  return binds;
}

/** Whether `node` (followed one hop through a binding) holds a marker literal. */
function namesMarker(node, binds, depth = 0) {
  if (!node || depth > 4) return false;
  let found = false;
  const walk = (n) => {
    if (found) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && namesMarkerText(n.text)) { found = true; return; }
    // A template's literal parts: `${dir}/.git` names the marker in its tail.
    if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (namesMarkerText(n.text)) { found = true; return; }
    }
    if (ts.isIdentifier(n) && binds.has(n.text) && n !== node) {
      if (namesMarker(binds.get(n.text), binds, depth + 1)) { found = true; return; }
    }
    ts.forEachChild(n, walk);
  };
  if (ts.isIdentifier(node) && binds.has(node.text)) return namesMarker(binds.get(node.text), binds, depth + 1);
  walk(node);
  return found;
}

/**
 * Every root lookup in one source text.
 *
 * @param {string} file  Path used for reporting and for the script kind.
 * @param {string} text
 * @returns {{ line: number, shape: 'marker-probe' | 'git-toplevel' | 'find-up', text: string }[]}
 */
export function lookupsIn(file, text) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const binds = bindingsOf(src);
  const hits = [];
  const record = (node, shape) => {
    hits.push({
      line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1,
      shape,
      text: node.getText(src).replace(/\s+/g, ' ').slice(0, 120),
    });
  };
  const walk = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'find-up') {
      record(node, 'find-up');
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'find-up') record(node, 'find-up');
      else if (name === 'findUp' || name === 'findUpSync') record(node, 'find-up');
      else if (PROBES.has(name) && namesMarker(node.arguments[0], binds)) record(node, 'marker-probe');
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && GIT_ROOT_FLAGS.has(node.text)) {
      record(node, 'git-toplevel');
    }
    ts.forEachChild(node, walk);
  };
  walk(src);
  return hits;
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walkFiles(join(dir, entry.name));
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

/**
 * @param {string} root the objectui tree
 * @returns {{ scanned: number, parsed: number, hits: {file: string, line: number, shape: string, text: string, allowed: string | null}[], stale: string[] }}
 */
export function scan(root = uiRoot()) {
  const hits = [];
  let scanned = 0;
  let parsed = 0;
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const abs of walkFiles(dir)) {
      const rel = relative(root, abs).split('\\').join('/');
      if (rel === HELPER || rel === SELF) continue;
      scanned += 1;
      const text = readFileSync(abs, 'utf8');
      if (!PREFILTER.test(text)) continue;
      parsed += 1;
      for (const hit of lookupsIn(rel, text)) hits.push({ file: rel, ...hit, allowed: ALLOWLIST.get(rel) ?? null });
    }
  }
  const live = new Set(hits.map((h) => h.file));
  const stale = [...ALLOWLIST.keys()].filter((file) => !live.has(file));
  return { scanned, parsed, hits, stale };
}

export function selfTest() {
  const cases = [];
  const run = (name, source, want, file = 'fixture/x.test.ts') => {
    const hits = lookupsIn(file, source);
    const ok = want === 'fires' ? hits.length > 0 : hits.length === 0;
    cases.push({ name, ok, detail: ok ? '' : `${hits.length} hit(s): ${hits.map((h) => `${h.shape} \`${h.text}\``).join('; ')}` });
  };
  const head = "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\nimport { join, dirname } from 'node:path';\nimport { execFileSync } from 'node:child_process';\n";
  // ── FIRES ────────────────────────────────────────────────────────────────
  run('a walk up to pnpm-workspace.yaml', `${head}let dir = __dirname;\nwhile (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);`, 'fires');
  run('a walk up to .git through a namespace import', `import fs from 'node:fs';\nimport path from 'node:path';\nif (fs.existsSync(path.join(dir, '.git'))) return dir;`, 'fires');
  run('the marker laundered through a const', `${head}const marker = join(dir, '.git');\nif (existsSync(marker)) return dir;`, 'fires');
  run('`git rev-parse --show-toplevel`', `${head}const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();`, 'fires');
  run('`--git-common-dir`', `${head}const common = execFileSync('git', ['rev-parse', '--git-common-dir']);`, 'fires');
  run('an import of find-up', `import { findUp } from 'find-up';\nconst root = await findUp('pnpm-workspace.yaml');`, 'fires');
  run('a statSync probe in a .mjs file', `import { statSync } from 'node:fs';\ntry { statSync(\`\${dir}/.git\`); } catch {}`, 'fires', 'scripts/x.mjs');
  // ── SILENT ───────────────────────────────────────────────────────────────
  run('reading the workspace globs as data from a known root', `${head}const yaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');`, 'silent');
  run('a directory skip-list naming .git', `const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo']);`, 'silent');
  run('a fixture that writes a pnpm-workspace.yaml', `${head}writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\\n  - 'packages/*'\\n");`, 'silent');
  run('a comment that mentions every spelling', `// walks up to .git or pnpm-workspace.yaml, like git rev-parse --show-toplevel or find-up\nexport const x = 1;`, 'silent');
  run('the helper itself', `import { uiRoot } from '../../../../scripts/ui-root.mjs';\nconst README = join(uiRoot(), 'packages/core/README.md');\nif (existsSync(README)) {}`, 'silent');
  run('an existsSync of something else', `${head}if (existsSync(join(root, 'packages/types/package.json'))) {}`, 'silent');
  return cases;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const cases = selfTest();
    for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
    const failed = cases.filter((c) => !c.ok);
    console.log(failed.length ? `✗ ${failed.length} of ${cases.length} self-test case(s) failed` : `✓ ${cases.length} self-test case(s) passed`);
    return failed.length ? 1 : 0;
  }
  const result = scan();
  const offending = result.hits.filter((h) => h.allowed === null);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, offending }, null, 2));
    return offending.length || result.stale.length || result.scanned === 0 ? 1 : 0;
  }
  if (argv.includes('--list')) {
    for (const h of result.hits) console.log(`${h.allowed ? 'allowed ' : 'LOOKUP  '} ${h.file}:${h.line}  ${h.shape}  ${h.text}${h.allowed ? `  -- ${h.allowed}` : ''}`);
  }
  if (result.scanned === 0) {
    console.error(`✗ check-ui-root-lookups: scanned no files under ${SCAN_ROOTS.join(', ')} -- a scan of nothing is not a reading.`);
    return 1;
  }
  for (const h of offending) {
    console.error(`✗ ${h.file}:${h.line}  ${h.shape}  ${h.text}`);
  }
  for (const file of result.stale) console.error(`✗ stale allowlist entry: ${file} carries no lookup any more -- delete its line from ALLOWLIST.`);
  if (offending.length || result.stale.length) {
    console.error(
      `\n✗ check-ui-root-lookups: ${offending.length} repo-root lookup(s) outside ${HELPER}` +
        `${result.stale.length ? ` and ${result.stale.length} stale allowlist entr${result.stale.length === 1 ? 'y' : 'ies'}` : ''}.\n` +
        `  Standalone these find the objectui root; inside the objectstack monorepo (\`ui/\`) they find the OBJECTSTACK root.\n` +
        `  Import { uiRoot } from scripts/ui-root.mjs instead -- it resolves the tree from its own location in both layouts.`,
    );
    return 1;
  }
  console.log(
    `✅  check-ui-root-lookups: OK (${result.scanned} file(s) scanned, ${result.parsed} parsed, ` +
      `${result.hits.length} probe(s) all on the allowlist, ${ALLOWLIST.size} allowlist entr${ALLOWLIST.size === 1 ? 'y' : 'ies'} live).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
