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
 *   node scripts/gen-sdui-manifest-node.mjs  # no .objectui-sha: builds the in-tree registry, then regenerates
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
 *
 * ## With no pin: the in-tree console (#25712)
 *
 * Once objectui's tree lives under `ui/` and `.objectui-sha` is gone (#25677),
 * the modules root is `ui/apps/console` and the registry is this tree's own.
 * The run is then one command with no prior step: it builds the registry
 * closure with turbo (`buildInTree`, a cache hit when nothing moved), refusing
 * registry sources the index does not hold, then enumerates exactly as above.
 * The record gains an `inTree` block — the modules root, the version read off
 * the build (provenance only), and where the per-package records live — and
 * keeps the pin-keyed fields only while the artefact is byte-identical to the
 * one they describe. With the pin present, nothing here runs differently.
 *
 * ## One record per registry package, re-recorded only when it moved (#26051)
 *
 * Each registry package's source digest (`registrySourceDigests` in
 * scripts/check-sdui-manifest.mjs, which the gate recomputes) goes into its own
 * one-line record under `scripts/sdui-manifest.sources/`, beside the sha256 of
 * the artefact it was verified against. A run rewrites a package's record only
 * when that line changes: when one package's sources moved and the artefact did
 * not, exactly that package's record changes, so ui PRs that touch different
 * packages touch different files. When the artefact moved, every record names
 * the new sha256, so every in-flight branch that regenerated against the old
 * artefact conflicts once and regenerates on the merged tree. The shared record
 * moves with the artefact and nothing else: `generatedAt` and the provenance
 * version are carried while the artefact is byte-identical.
 *
 * It still BUILDS on every run, including one where only a package's sources
 * moved: the build and the enumeration are the only oracle that says whether
 * the artefact moved, and a record written without them would stamp a current
 * digest on a manifest no run has checked. What makes that cheap is turbo's
 * input hashing — measured on objectstack 0a6948210c, one container, no remote
 * cache: cold 8m43s (0 of 63 tasks cached); one edit under
 * `ui/packages/plugin-grid/src` 33s (61 of 63 cached); one under
 * `ui/packages/core/src` 2m50s (41 of 63 cached); nothing moved 6s.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { gitFreeEnv } from './git-env.mjs';

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

/** The in-tree console this reads when the tree has no pin (#25712). */
const UI_CONSOLE = 'ui/apps/console';

/**
 * The record's `//` note for an in-tree run. A pinned run carries whatever note
 * the record already has, exactly as before; that note names the pin's build
 * route, which is false the moment there is no pin, so an in-tree run writes
 * this one.
 */
const IN_TREE_NOTE = [
  'Provenance record for the repo-root `sdui.manifest.json` (ADR-0080; #12924 wiring ruling 2026-08-29).',
  "The artefact is the console's public-tier component manifest, generated from THIS tree's registry by",
  'scripts/gen-sdui-manifest-node.mjs, the one producer (ruling 丙 on #17735): it builds the registry packages under',
  'ui/packages/, then enumerates them from `inTree.modulesRoot` exactly as ui/apps/console/dev/manifest-dump.tsx',
  'does: eager-import the 16 registry modules, ComponentRegistry.getPublicConfigs(), manifestFromConfigs from',
  '@objectstack/sdui-parser. Each registry package has a one-line record under `inTree.registryRecords` (#26051): a',
  "digest of that package's own src/ as the index holds them, and the sha256 of the artefact it was verified against.",
  '`scripts/check-sdui-manifest.mjs` recomputes every digest, so a registry source edit without regeneration goes RED',
  'there naming the package. This record moves only with the artefact; a run where only sources moved re-records only',
  'their packages. `inTree.objectuiWorkspaceVersion` is provenance, not a verdict (#25712). Pin-keyed fields, where',
  'present, say the artefact is byte-identical to the one generated at that pin.',
  'Regenerate + re-record: node scripts/gen-sdui-manifest-node.mjs',
];

/** Lines of `git status --porcelain` under `dirs` that the INDEX does not hold: unstaged edits and untracked files. */
function unindexed(dirs) {
  const status = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=all', '--', ...dirs], {
    // #16644: `-C ROOT` alone names the repository — the gate's self-test runs
    // this file inside a mkdtemp fixture, where an inherited GIT_DIR outranks it.
    env: gitFreeEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return status.split('\n').filter((line) => line.length > 2 && line[1] !== ' ');
}

/**
 * No pin — the merged layout (#25712): build the registry's packages from this
 * tree's own sources, then read that build. Returns the gate module and the
 * per-package reading of the sources the build was made from.
 *
 * The build is THIS script's step here, not the caller's: the records name the
 * sources by digest (`registrySourceDigests` in scripts/check-sdui-manifest.mjs,
 * which the gate recomputes), and only a build of exactly those sources makes
 * the artefact describe them — a run over a stale dist would stamp a fresh
 * digest on a stale manifest. Turbo's input hashing makes an up-to-date build a
 * cache hit. Refused before anything is built: no in-tree console, a registry
 * list that disagrees with the gate's, unreadable sources, or bytes under them
 * the index does not hold (the digest reads the index, the build the working
 * tree). Refused after: a build that moved them.
 */
async function buildInTree() {
  if (!existsSync(join(ROOT, ...UI_CONSOLE.split('/'), 'package.json'))) {
    fail(
      `.objectui-sha is missing and there is no in-tree console (${UI_CONSOLE}) either — nothing to generate from.\n` +
        '  With the pin this reads objectui\'s build at that commit; without it, the console under ui/.',
    );
  }
  const gate = await import(new URL('./check-sdui-manifest.mjs', import.meta.url).href);
  if (JSON.stringify(gate.REGISTRY_MODULES) !== JSON.stringify(REGISTRY_MODULES)) {
    fail(
      'REGISTRY_MODULES here and in scripts/check-sdui-manifest.mjs disagree, so the digest the gate recomputes\n' +
        '  would describe a different registry than the one enumerated here. Make the two lists equal.',
    );
  }
  const before = gate.registrySourceDigests(ROOT);
  if (before.problem) fail(`cannot digest the registry sources: ${before.problem}`);
  const sources = before.packages.map(({ dir }) => `${dir}/src`);
  const notIndexed = unindexed(sources);
  if (notIndexed.length > 0) {
    fail(
      'the registry sources carry bytes the index does not hold, so the build would read what the digest does not name:\n' +
        notIndexed.slice(0, 20).map((line) => `    ${line}`).join('\n') +
        (notIndexed.length > 20 ? `\n    … and ${notIndexed.length - 20} more` : '') +
        '\n  Stage or discard them, then re-run.',
    );
  }

  const turbo = join(ROOT, 'node_modules', '.bin', 'turbo');
  if (!existsSync(turbo)) fail('no turbo at node_modules/.bin/turbo — run `pnpm install` first.');
  const filters = ['@object-ui/core', ...REGISTRY_MODULES].map((name) => `--filter=${name}...`);
  console.error(
    `→ building the registry from this tree: ${before.packages.length} package(s), ` +
      `${before.packages.reduce((sum, { files }) => sum + files, 0)} source(s) (turbo — a cache hit when nothing moved)`,
  );
  const build = spawnSync(turbo, ['run', 'build', ...filters, '--filter=@objectstack/sdui-parser', '--output-logs=errors-only'], {
    cwd: ROOT,
    stdio: ['ignore', 2, 2],
  });
  if (build.status !== 0) fail(`the in-tree build exited ${build.status ?? build.signal}; its output is above.`);

  const after = gate.registrySourceDigests(ROOT);
  if (after.problem || JSON.stringify(after.packages) !== JSON.stringify(before.packages) || unindexed(sources).length > 0) {
    fail('the build moved the registry sources it was meant to read (their digest or their untracked files changed). Nothing was written.');
  }
  if (!existsSync(join(ROOT, ...UI_CONSOLE.split('/'), 'node_modules', '@object-ui', 'core', 'dist', 'index.js'))) {
    fail(`${UI_CONSOLE}/node_modules/@object-ui/core/dist/index.js is missing after the build, so ${UI_CONSOLE} does not resolve the registry the build made.`);
  }
  return { gate, packages: before.packages };
}

if (process.argv.length > 2) {
  fail(
    `takes no arguments (got: ${process.argv.slice(2).join(' ')}).\n` +
      '  The modules root is derived from .objectui-sha and the version is read from the built tree;\n' +
      '  the retired --modules-root / --objectui-version routes are what let the artefact describe a\n' +
      '  registry the pin does not name.',
  );
}

const PARSER_DIST_MISSING =
  `packages/sdui-parser/dist is missing — the adapter is consumed as production consumes it.\n` +
  `  Run: pnpm --filter @objectstack/sdui-parser build`;

const pinPath = join(ROOT, '.objectui-sha');
const pinned = existsSync(pinPath);

let pin = null;
let MODULES_ROOT_REL;
let inTree = null;
if (pinned) {
  if (!existsSync(PARSER_DIST)) fail(PARSER_DIST_MISSING);

  pin = readFileSync(pinPath, 'utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(pin)) fail(`.objectui-sha does not hold a 40-character commit sha (got ${JSON.stringify(pin)}).`);

  // Repo-relative, POSIX-separated: this string is what the record carries.
  const BUILD_TREE_REL = `.cache/objectui-${pin.slice(0, 12)}`;
  MODULES_ROOT_REL = `${BUILD_TREE_REL}/apps/console`;
  const BUILD_TREE = join(ROOT, ...BUILD_TREE_REL.split('/'));
  const BUILT_SENTINEL = join(ROOT, ...MODULES_ROOT_REL.split('/'), 'node_modules', '@object-ui', 'core', 'dist', 'index.js');
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
} else {
  inTree = await buildInTree();
  if (!existsSync(PARSER_DIST)) fail(PARSER_DIST_MISSING);
  MODULES_ROOT_REL = UI_CONSOLE;
}
const MODULES_ROOT = join(ROOT, ...MODULES_ROOT_REL.split('/'));
const CORE_PKG = join(MODULES_ROOT, 'node_modules', '@object-ui', 'core', 'package.json');

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
//
// The hook re-anchors only when `parentURL` EQUALS `RUNNER`, and Node reports a
// module's URL by its REALPATH. So the directory is resolved before any URL is
// built from it: a temp base reached through a symlink (macOS's default TMPDIR,
// `/var` -> `/private/var`) otherwise leaves `RUNNER` naming a path Node never
// reports, nothing is re-anchored, and every registry import fails with
// `Cannot find package`. `ANCHOR` is only handed on as a parent and never
// compared, so it needs no resolving. Pinned with a symlinked TMPDIR by
// `scripts/check-sdui-manifest.mjs --self-test`.
const runnerDir = realpathSync(mkdtempSync(join(tmpdir(), 'sdui-manifest-runner-')));
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
// Pinned, the record is exactly what it has always been. In-tree, the record
// describes an ARTEFACT, so everything in it that is not read off this run —
// the pin-keyed fields, `generatedAt`, the provenance version — is carried only
// while the regenerated artefact is byte-identical to the one it was written
// for (the same sha256), when it still says something true about these bytes,
// and replaced the moment it is not. That is what keeps this file out of the
// diff of a run where only registry sources moved (#26051). `undefined` keys
// are left out of the JSON.
const carried = !pinned && record.sha256 === sha256 ? record : {};
const today = new Date().toISOString().slice(0, 10);
const nextRecord = {
  '//': pinned ? record['//'] ?? [] : IN_TREE_NOTE,
  objectuiSha: pinned ? pin : carried.objectuiSha,
  source: SOURCE,
  modulesRoot: pinned ? MODULES_ROOT_REL : carried.modulesRoot,
  objectuiWorkspaceVersion: pinned ? workspaceVersion : carried.objectuiWorkspaceVersion,
  generator: 'scripts/gen-sdui-manifest-node.mjs',
  generatedAt: pinned ? today : carried.generatedAt ?? today,
  sha256,
  components: count,
  inTree: pinned
    ? undefined
    : {
        modulesRoot: MODULES_ROOT_REL,
        objectuiWorkspaceVersion: carried.inTree?.objectuiWorkspaceVersion ?? workspaceVersion,
        registryRecords: inTree.gate.REGISTRY_RECORDS,
      },
};

// One record per registry package, written only where its line changed; a
// record for a package the registry no longer reaches is removed (#26051).
const rerecorded = [];
const removed = [];
if (!pinned) {
  const { gate } = inTree;
  const recordsDir = join(ROOT, ...gate.REGISTRY_RECORDS.split('/'));
  mkdirSync(recordsDir, { recursive: true });
  const keep = new Set();
  for (const pkg of inTree.packages) {
    const rel = gate.registryRecordPath(pkg.dir);
    keep.add(rel);
    const path = join(ROOT, ...rel.split('/'));
    const line = gate.registryRecordLine(pkg, sha256);
    if (existsSync(path) && readFileSync(path, 'utf8') === line) continue;
    writeFileSync(path, line);
    rerecorded.push(pkg.dir);
  }
  for (const name of readdirSync(recordsDir).sort()) {
    if (keep.has(`${gate.REGISTRY_RECORDS}/${name}`)) continue;
    rmSync(join(recordsDir, name), { recursive: true, force: true });
    removed.push(`${gate.REGISTRY_RECORDS}/${name}`);
  }
}
const nextRecordText = JSON.stringify(nextRecord, null, 2) + '\n';
const recordMoved = !existsSync(RECORD_PATH) || readFileSync(RECORD_PATH, 'utf8') !== nextRecordText;
writeFileSync(RECORD_PATH, nextRecordText);
console.error(`✓ wrote sdui.manifest.json (${count} components, ${Buffer.byteLength(json)} bytes, sha256 ${sha256.slice(0, 12)}…)`);
if (pinned) {
  console.error(
    `✓ re-recorded scripts/sdui-manifest.record.json at pin ${pin.slice(0, 12)} — ${SOURCE} ${MODULES_ROOT_REL}, ` +
      `@object-ui/core workspace version ${workspaceVersion}`,
  );
} else {
  const { packages } = inTree;
  console.error(
    `✓ ${recordMoved ? 're-recorded' : 'left unchanged'} scripts/sdui-manifest.record.json in-tree — ${SOURCE} ${MODULES_ROOT_REL}, ` +
      `@object-ui/core workspace version ${nextRecord.inTree.objectuiWorkspaceVersion}` +
      (carried.sha256 ? ` (artefact unchanged since ${nextRecord.generatedAt}, so the record is carried)` : '') +
      '; ' +
      (carried.objectuiSha ? `pin fields kept (artefact unchanged since pin ${carried.objectuiSha.slice(0, 12)})` : 'no pin fields'),
  );
  console.error(
    `✓ ${rerecorded.length} of ${packages.length} registry package record(s) re-recorded under ${inTree.gate.REGISTRY_RECORDS}/` +
      (rerecorded.length > 0 ? `: ${rerecorded.map((dir) => dir.slice(dir.lastIndexOf('/') + 1)).join(', ')}` : '') +
      (carried.sha256 ? '' : ' (the artefact moved, so every record names its new sha256)') +
      (removed.length > 0 ? `; removed ${removed.join(', ')} (no longer reached)` : '') +
      ` — ${packages.reduce((sum, { files }) => sum + files, 0)} source(s) in all.`,
  );
}
