#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * gen-sdui-manifest-node — regenerate the repo-root `sdui.manifest.json` from
 * objectui's registry AT THE PIN, read out of the pin's BUILT tree, without a
 * browser. The one producer of the tracked artefact (ruling 丙 on #17735).
 *
 *   pnpm objectui:build                    # build objectui at .objectui-sha into .cache/objectui-<SHA12>/
 *   node scripts/gen-sdui-manifest-node.mjs
 *
 * No flags. The modules root is DERIVED from `.objectui-sha` —
 * `.cache/objectui-<SHA12>/apps/console`, the directory `scripts/build-console.sh`
 * materialises — and the version recorded is READ from the tree, so neither can
 * be named by hand and disagree with the pin.
 *
 * ## What this produces, and from what
 *
 * The ADR-0080 public-tier component manifest that `resolveSduiManifest()`
 * (packages/cli) picks up from the project root, switching `validateJsxPages`
 * from parse-only to full `validateTree` validation (#12924, ruled 2026-08-29:
 * wire it). The enumeration mirrors objectui's own generator page
 * (`apps/console/dev/manifest-dump.tsx`) exactly: eager-import the 16 registry
 * modules IN ITS ORDER, read `ComponentRegistry.getPublicConfigs()`, and
 * serialize through `manifestFromConfigs` from `@objectstack/sdui-parser` —
 * the hoisted, lockstep-pinned copy of objectui's adapter
 * (`pnpm check:sdui-lockstep` holds the two copies byte-equal).
 *
 * `apps/console/node_modules/@object-ui/` in the built tree carries every
 * registry package as a workspace symlink whose `exports["."].import` is
 * `./dist/index.js`, so stock resolution from that directory lands on the
 * BUILT dist of the pinned SOURCE and keeps one `@object-ui/core` registry
 * instance. The objectui repo root is NOT a valid modules root: its
 * `node_modules/@object-ui/` holds none of the registry packages.
 *
 * ## Why the built tree, and never an npm install
 *
 * `.objectui-sha` pins a COMMIT. The `@object-ui` version that commit's
 * `packages/core/package.json` declares names a tarball built from an EARLIER
 * commit, because objectui bumps its version only at release — so installing
 * "the version the pin declares" from npm described a registry up to one
 * release behind the pin (measured on #17735: 18 of 57 components differed,
 * every divergence landed in objectui inside that window). This script used to
 * default to exactly that install; the default is deleted, and there is no
 * other input route.
 *
 * ## Plain Node is a valid producer
 *
 * The registry imports under plain Node once `.css` side-effect imports resolve
 * to an empty module — the only failure without that hook is
 * `ERR_UNKNOWN_FILE_EXTENSION .css` (plugin-dashboard, plugin-map), a loader
 * limitation, not a browser API. 57 configs, 0 lazy stubs, a few seconds, no
 * Playwright. Regeneration is byte-deterministic (two runs over one built tree
 * `cmp` identical).
 *
 * ## Preconditions (all loud)
 *
 *   - `packages/sdui-parser/dist` exists (`pnpm --filter @objectstack/sdui-parser build`):
 *     the adapter is consumed exactly as production consumes it.
 *   - `.cache/objectui-<SHA12>/` is a checkout AT the pin (its HEAD equals
 *     `.objectui-sha`), and it is BUILT: `apps/console/node_modules/@object-ui/core/dist/index.js`
 *     exists. Either missing ⇒ exit 1 naming `pnpm objectui:build`.
 *
 * The runner this spawns is written to a fresh temp dir and removed afterwards:
 * nothing is written into the objectui build tree.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD_PATH = join(ROOT, 'scripts', 'sdui-manifest.record.json');
const OUT_PATH = join(ROOT, 'sdui.manifest.json');
const PARSER_DIST = join(ROOT, 'packages', 'sdui-parser', 'dist', 'index.mjs');

/** What the record's `source` says for every artefact this script writes. */
const SOURCE = 'built-tree';

/** The registration set, in objectui's `apps/console/dev/manifest-dump.tsx` order. */
const REGISTRY_MODULES = [
  '@object-ui/components',
  '@object-ui/plugin-grid',
  '@object-ui/plugin-form',
  '@object-ui/plugin-view',
  '@object-ui/plugin-list',
  '@object-ui/plugin-detail',
  '@object-ui/plugin-dashboard',
  '@object-ui/plugin-charts',
  '@object-ui/plugin-kanban',
  '@object-ui/plugin-calendar',
  '@object-ui/plugin-gantt',
  '@object-ui/plugin-timeline',
  '@object-ui/plugin-map',
  '@object-ui/plugin-markdown',
  '@object-ui/plugin-report',
  '@object-ui/plugin-tree',
];

function fail(msg) {
  console.error(`✗ gen-sdui-manifest-node: ${msg}`);
  process.exit(1);
}

if (process.argv.length > 2) {
  fail(
    `takes no arguments (got: ${process.argv.slice(2).join(' ')}).\n` +
      '  The modules root is derived from .objectui-sha and the version is read from the built tree;\n' +
      '  the retired --modules-root / --objectui-version routes are what let the artefact describe a\n' +
      '  registry the pin does not name.',
  );
}

if (!existsSync(PARSER_DIST)) {
  fail(
    `packages/sdui-parser/dist is missing — the adapter is consumed as production consumes it.\n` +
      `  Run: pnpm --filter @objectstack/sdui-parser build`,
  );
}

const pinPath = join(ROOT, '.objectui-sha');
if (!existsSync(pinPath)) fail('.objectui-sha is missing — cannot derive the objectui build tree.');
const pin = readFileSync(pinPath, 'utf8').trim();
if (!/^[0-9a-f]{40}$/.test(pin)) fail(`.objectui-sha does not hold a 40-character commit sha (got ${JSON.stringify(pin)}).`);

// Repo-relative, POSIX-separated: this string is what the record carries.
const BUILD_TREE_REL = `.cache/objectui-${pin.slice(0, 12)}`;
const MODULES_ROOT_REL = `${BUILD_TREE_REL}/apps/console`;
const BUILD_TREE = join(ROOT, ...BUILD_TREE_REL.split('/'));
const MODULES_ROOT = join(ROOT, ...MODULES_ROOT_REL.split('/'));
const CORE_PKG = join(MODULES_ROOT, 'node_modules', '@object-ui', 'core', 'package.json');
const BUILT_SENTINEL = join(MODULES_ROOT, 'node_modules', '@object-ui', 'core', 'dist', 'index.js');
const REMEDY = '  Run `pnpm objectui:build` first — it builds objectui at the pin into that directory.';

if (!existsSync(BUILD_TREE)) {
  fail(`no objectui build tree at ${BUILD_TREE_REL}/ for pin ${pin.slice(0, 12)}….\n${REMEDY}`);
}
let head = '';
try {
  head = execFileSync('git', ['-C', BUILD_TREE, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch (e) {
  fail(`${BUILD_TREE_REL}/ is not a git checkout (${String(e?.stderr || e?.message || e).trim().split('\n')[0]}).\n${REMEDY}`);
}
if (head !== pin) {
  fail(`${BUILD_TREE_REL}/ is checked out at ${head.slice(0, 12)}…, not at the pin ${pin.slice(0, 12)}….\n${REMEDY}`);
}
if (!existsSync(BUILT_SENTINEL)) {
  fail(
    `objectui at ${pin.slice(0, 12)}… is checked out but NOT BUILT: ${MODULES_ROOT_REL}/node_modules/@object-ui/core/dist/index.js is missing.\n${REMEDY}`,
  );
}

let workspaceVersion;
try {
  workspaceVersion = JSON.parse(readFileSync(CORE_PKG, 'utf8'))?.version;
} catch (e) {
  fail(`cannot read ${MODULES_ROOT_REL}/node_modules/@object-ui/core/package.json: ${e.message}`);
}
if (typeof workspaceVersion !== 'string' || workspaceVersion === '') {
  fail(`${MODULES_ROOT_REL}/node_modules/@object-ui/core/package.json declares no string \`version\`.`);
}

let record = {};
if (existsSync(RECORD_PATH)) {
  try {
    record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  } catch {
    fail(`${RECORD_PATH} exists but does not parse — fix or delete it first.`);
  }
}

// The runner lives in its own temp dir, so bare specifiers are re-anchored to
// the modules root by the resolve hook below: resolution is exactly what it
// would be for a file sitting in `apps/console/`, and the build tree gets no
// file written into it. The one other accommodation plain Node needs: `.css`
// side-effect imports (plugin-dashboard, plugin-map) resolve to an empty module.
const runnerDir = mkdtempSync(join(tmpdir(), 'sdui-manifest-runner-'));
const runnerPath = join(runnerDir, 'sdui-manifest-runner.mjs');
const runnerUrl = pathToFileURL(runnerPath).href;
const anchorUrl = pathToFileURL(join(MODULES_ROOT, 'package.json')).href;
const hooks =
  `const RUNNER = ${JSON.stringify(runnerUrl)};\n` +
  `const ANCHOR = ${JSON.stringify(anchorUrl)};\n` +
  'const BARE = (s) => !/^(\\.{0,2}\\/|[a-z][a-z0-9+.-]*:)/i.test(s);\n' +
  'export async function resolve(s, c, n) {\n' +
  '  if (s.endsWith(".css")) return { url: "data:text/javascript,", shortCircuit: true };\n' +
  '  if (c.parentURL === RUNNER && BARE(s)) return n(s, { ...c, parentURL: ANCHOR });\n' +
  '  return n(s, c);\n' +
  '}\n';
const runner = `
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hooks)}), import.meta.url);
const MODULES = ${JSON.stringify(REGISTRY_MODULES)};
const failures = [];
for (const m of MODULES) {
  try { await import(m); } catch (e) { failures.push(m + ': ' + String(e).slice(0, 200)); }
}
if (failures.length) {
  console.error('IMPORT FAILURES:\\n' + failures.join('\\n'));
  process.exit(1);
}
const { ComponentRegistry } = await import('@object-ui/core');
const parser = await import(${JSON.stringify(pathToFileURL(PARSER_DIST).href)});
const configs = ComponentRegistry.getPublicConfigs();
if (!configs.length) { console.error('getPublicConfigs() returned 0 configs'); process.exit(1); }
const lazy = configs.filter((c) => c.lazy);
if (lazy.length) { console.error('lazy stubs present (their inputs would be missing): ' + lazy.map((c) => c.type).join(', ')); process.exit(1); }
const manifest = parser.manifestFromConfigs(configs);
if (!Object.keys(manifest.components).length) { console.error('manifestFromConfigs produced 0 components'); process.exit(1); }
// Same serialization as objectui's dump (JSON.stringify(manifest, null, 2), no trailing newline).
process.stdout.write(JSON.stringify(manifest, null, 2));
`;

let json;
let enumerationError;
try {
  writeFileSync(runnerPath, runner);
  console.error(`→ enumerating the registry (${REGISTRY_MODULES.length} modules) from ${MODULES_ROOT_REL}/...`);
  json = execFileSync(process.execPath, [runnerPath], { cwd: MODULES_ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
} catch (e) {
  enumerationError = e;
} finally {
  // Before any exit: `process.exit` inside the catch would skip this.
  rmSync(runnerDir, { recursive: true, force: true });
}
if (enumerationError) {
  fail(`the registry enumeration failed (exit ${enumerationError?.status ?? '?'}); its stderr is above.`);
}

const manifest = JSON.parse(json);
const count = Object.keys(manifest.components).length;
writeFileSync(OUT_PATH, json);
const sha256 = createHash('sha256').update(json).digest('hex');
const nextRecord = {
  '//': record['//'] ?? [],
  objectuiSha: pin,
  source: SOURCE,
  modulesRoot: MODULES_ROOT_REL,
  objectuiWorkspaceVersion: workspaceVersion,
  generator: 'scripts/gen-sdui-manifest-node.mjs',
  generatedAt: new Date().toISOString().slice(0, 10),
  sha256,
  components: count,
};
writeFileSync(RECORD_PATH, JSON.stringify(nextRecord, null, 2) + '\n');
console.error(`✓ wrote sdui.manifest.json (${count} components, ${Buffer.byteLength(json)} bytes, sha256 ${sha256.slice(0, 12)}…)`);
console.error(
  `✓ re-recorded scripts/sdui-manifest.record.json at pin ${pin.slice(0, 12)} — ${SOURCE} ${MODULES_ROOT_REL}, ` +
    `@object-ui/core workspace version ${workspaceVersion}`,
);
