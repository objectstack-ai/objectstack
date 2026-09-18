#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * gen-sdui-manifest-node — regenerate the repo-root `sdui.manifest.json` from
 * objectui's PUBLISHED registry packages, without a browser.
 *
 *   node scripts/gen-sdui-manifest-node.mjs                      # temp npm install (network); version from the PIN
 *   node scripts/gen-sdui-manifest-node.mjs --modules-root DIR   # use a preinstalled node_modules parent
 *   node scripts/gen-sdui-manifest-node.mjs --objectui-version V # override the version to install
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
 * ## Why plain Node is a valid producer (the browser-only claim is expired)
 *
 * `packages/spec/CHANGELOG.md` records (twice, byte-identically) that only a
 * real browser can enumerate the registry. Measured false on 2026-08-29 and
 * re-measured on 2026-08-30 against published `@object-ui/*` 17.6.0: all 16
 * modules import under plain Node once `.css` imports resolve to an empty
 * module — the ONLY failure without the hook is
 * `ERR_UNKNOWN_FILE_EXTENSION .css` on plugin-dashboard/plugin-map, a loader
 * limitation, not a browser API. 57 configs, 0 lazy stubs, ~4.5 s, no
 * Playwright, no objectui build. Reproduced independently in review of #18608:
 * the 17 published `@object-ui/*` 17.6.0 packages installed from npm,
 * `sdui-parser` bundled, this generator run under plain Node — `sha256
 * 49211fee7792` / `git hash-object 78f870e42fe9`, `cmp` byte-identical to the
 * tracked artefact. The browser route (`pnpm sdui:manifest`) still exists for
 * operators holding an objectui checkout; both routes serialize the same
 * registry through the same adapter.
 *
 * ⛔ Do not put an objectui issue number back on the 2026-08-29 measurement.
 * The citation this paragraph used to carry resolves to nothing — 404 for both
 * the issue and the PR at that number, while seven neighbouring objectui
 * numbers answer 200 as controls, so the zero is that NUMBER, not the endpoint
 * and not the token — and the readings above stand without one. #18608 dropped
 * the same citation from the two sibling gate scripts (check-generated.ts,
 * check-react-blocks-declaration-parity.ts) and left the same number-free
 * tombstone there; this header is what both of them now send readers to for
 * the readings.
 *
 * ## Versioning contract — ONE oracle, shared with the gate
 *
 * The manifest must describe the registry the SHIPPED console runs — i.e. the
 * `@object-ui/*` version that `.objectui-sha` ships. This script installs that
 * version from npm. Which version that is has exactly one source:
 * `--objectui-version` when it is passed, otherwise what
 * `packages/core/package.json` DECLARES at the pinned commit — read through
 * `check-sdui-manifest.mjs`'s exported `readPinnedDeclaredVersion`, the SAME
 * function its check 4 judges the written record with, imported rather than
 * re-typed.
 *
 * ⛔ The version is NOT defaulted from `scripts/sdui-manifest.record.json`.
 * That default is what this file was fixed for: `objectuiSha` below is re-read
 * from the LIVE pin while `objectuiPackagesVersion` fell back to the value
 * already in the record, so the two fields were read at two different moments.
 * A regeneration after a pin bump therefore wrote the NEW pin under the OLD
 * version string — a record whose two objectui fields describe two different
 * commits, which check 4 reds. The person it reds is the one who followed the
 * documented bump procedure, so the producer is where it is fixed. Two readers
 * consulting two oracles is precisely where that drift came from; there is now
 * one oracle and both read it.
 *
 * When the oracle cannot answer — no objectui checkout, or one that does not
 * carry the pinned commit — this script REFUSES. An unread version is never
 * converted into a version string (Route & surface ownership §3: prefer failing
 * to falling back). Point `OBJECTUI_ROOT` at a checkout that carries the pin,
 * or pass `--objectui-version` explicitly.
 *
 * ## Preconditions (all loud)
 *
 * `packages/sdui-parser/dist` must exist (`pnpm --filter @objectstack/sdui-parser build`):
 * the adapter is consumed exactly as production consumes it. Absence exits 1.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { readPinnedDeclaredVersion } from './check-sdui-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD_PATH = join(ROOT, 'scripts', 'sdui-manifest.record.json');
const OUT_PATH = join(ROOT, 'sdui.manifest.json');
const PARSER_DIST = join(ROOT, 'packages', 'sdui-parser', 'dist', 'index.mjs');

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

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (!existsSync(PARSER_DIST)) {
  fail(
    `packages/sdui-parser/dist is missing — the adapter is consumed as production consumes it.\n` +
      `  Run: pnpm --filter @objectstack/sdui-parser build`,
  );
}

const pinPath = join(ROOT, '.objectui-sha');
if (!existsSync(pinPath)) fail('.objectui-sha is missing — cannot record provenance.');
const pin = readFileSync(pinPath, 'utf8').trim();

let record = {};
if (existsSync(RECORD_PATH)) {
  try {
    record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  } catch {
    fail(`${RECORD_PATH} exists but does not parse — fix or delete it first.`);
  }
}

// The version this run installs AND records. `--objectui-version` wins; the
// default is what the PIN declares, through check 4's own oracle — never the
// version already sitting in the record (see the versioning contract above).
const explicitVersion = arg('--objectui-version');
let version = explicitVersion;
let versionSource = '--objectui-version, as passed';
if (!version) {
  const leg = readPinnedDeclaredVersion(pin, { root: ROOT });
  if (leg.status !== 'resolved') {
    fail(
      `no --objectui-version, and the pinned commit's declared version could not be read: ${leg.reason}\n` +
        '  ⛔ This script does NOT fall back to the version in scripts/sdui-manifest.record.json: after a pin\n' +
        '  bump that re-records the NEW pin under the OLD version string, and check-sdui-manifest.mjs check 4\n' +
        '  reds exactly that record. Either:\n' +
        `    - point OBJECTUI_ROOT at an objectui checkout carrying ${pin.slice(0, 12)}…, or\n` +
        '    - pass --objectui-version {the @object-ui version that pin ships} explicitly.',
    );
  }
  version = leg.version;
  versionSource = `packages/core/package.json at objectui ${pin.slice(0, 12)}… (read from ${leg.where})`;
}

let modulesRoot = arg('--modules-root');
if (modulesRoot) {
  if (!existsSync(join(modulesRoot, 'node_modules'))) {
    fail(`--modules-root ${modulesRoot} has no node_modules/ — point it at a directory whose install carries the @object-ui set.`);
  }
} else {
  modulesRoot = mkdtempSync(join(tmpdir(), 'sdui-manifest-gen-'));
  const deps = Object.fromEntries(REGISTRY_MODULES.concat('@object-ui/core').map((m) => [m, version]));
  deps.react = '18.3.1';
  deps['react-dom'] = '18.3.1';
  writeFileSync(
    join(modulesRoot, 'package.json'),
    JSON.stringify({ name: 'sdui-manifest-gen', private: true, type: 'module', dependencies: deps }, null, 2),
  );
  console.error(`→ installing @object-ui/* ${version} into ${modulesRoot} (npm, network)...`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: modulesRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

// The one loader accommodation plain Node needs: `.css` side-effect imports
// (plugin-dashboard, plugin-map) resolve to an empty module. Everything else
// is stock resolution from the install above.
const runner = `
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
  'export async function resolve(s, c, n) {' +
  '  if (s.endsWith(".css")) return { url: "data:text/javascript,", shortCircuit: true };' +
  '  return n(s, c);' +
  '}'), import.meta.url);
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
const runnerPath = join(modulesRoot, 'sdui-manifest-runner.mjs');
writeFileSync(runnerPath, runner);
console.error(`→ enumerating the registry (${REGISTRY_MODULES.length} modules)...`);
const json = execFileSync(process.execPath, [runnerPath], { cwd: modulesRoot, maxBuffer: 64 * 1024 * 1024 }).toString();

const manifest = JSON.parse(json);
const count = Object.keys(manifest.components).length;
writeFileSync(OUT_PATH, json);
const sha256 = createHash('sha256').update(json).digest('hex');
const nextRecord = {
  '//': record['//'] ?? [],
  objectuiSha: pin,
  objectuiPackagesVersion: version,
  generator: 'scripts/gen-sdui-manifest-node.mjs',
  generatedAt: new Date().toISOString().slice(0, 10),
  sha256,
  components: count,
};
writeFileSync(RECORD_PATH, JSON.stringify(nextRecord, null, 2) + '\n');
console.error(`✓ wrote sdui.manifest.json (${count} components, ${Buffer.byteLength(json)} bytes, sha256 ${sha256.slice(0, 12)}…)`);
console.error(
  `✓ re-recorded scripts/sdui-manifest.record.json at pin ${pin.slice(0, 12)} / @object-ui ${version}\n` +
    `  (version from ${versionSource})`,
);
