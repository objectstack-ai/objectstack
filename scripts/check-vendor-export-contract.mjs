#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-vendor-export-contract — the version a CONSUMER resolves must export
 * every symbol our published source statically imports from it.
 *
 *   node scripts/check-vendor-export-contract.mjs [--resolve] [--self-test]
 *
 * ## The defect (#16186)
 *
 * `@objectstack/plugin-auth` compiles this line into its shipped `dist`:
 *
 *   import { createLocalAccountIssuer, createOAuthAccountIssuer }
 *     from '@better-auth/core/db';
 *
 * and declared `"@better-auth/core": "^1.7.2"`. `@better-auth/core@1.7.3` — a
 * PATCH — deleted both names, and the `account.issuer` column behind them,
 * because upstream rolled the issuer-scoped account identity back
 * (better-auth/better-auth#10909). A static ESM named import of a missing
 * export is a link-time `SyntaxError`, so the plugin could not load AT ALL:
 * published 17.1.0, 17.2.0 and 17.3.0 never created a system table and never
 * seeded, on every fresh install, for three releases.
 *
 * ## Why nothing in this repository noticed for three releases
 *
 * `pnpm-lock.yaml` held `@better-auth/core@1.7.2`. Every job in this repo
 * therefore imported the version that still had the symbol and was green,
 * while every consumer — who has no lockfile of ours — resolved `^1.7.2` to
 * 1.7.3 and got the SyntaxError. **The lockfile protected the producer from
 * the defect it was shipping.** Pinning the version fixes today's break; it
 * does not fix that, and the next vendor patch would do it again.
 *
 * `scripts/check-override-consistency.mjs` is the neighbouring gate and does
 * NOT cover this: it asks whether the workspace override target is REACHABLE
 * from the declared range. `^1.7.2` and `^1.7.2` agreed perfectly while both
 * floated onto a version nothing here had ever imported.
 *
 * ## What this gate asserts
 *
 * For every governed vendor package (`GOVERNED_VENDORS`) that a PUBLISHABLE
 * workspace package statically imports runtime values from:
 *
 *   1. some publishable manifest DECLARES it — we never import a runtime
 *      symbol out of a package no shipped manifest names;
 *   2. every declaring range is an EXACT version and they all agree — a range
 *      that admits more than one version cannot state which export surface we
 *      compiled against, and semver does not protect the surface anyway (the
 *      removal above shipped in a patch);
 *   3. the version installed in this workspace IS that version — so "what CI
 *      imported" and "what a consumer resolves" are the same string; and
 *   4. importing each specifier really yields every named symbol our source
 *      takes from it.
 *
 * (2) + (3) are what make (4) a statement about consumers rather than about
 * our lockfile: an exact range resolves to exactly one version everywhere, so
 * the surface this gate just verified is the surface a fresh install gets.
 * That is the property the card asked for, proved rather than measured — and
 * `--resolve` measures it too.
 *
 * ## `--resolve` — the network leg
 *
 * `--resolve` enumerates EVERY registry version satisfying each declared range
 * (no lockfile involved, exactly how npm resolves for a downstream project),
 * installs each one into a scratch project outside this workspace, and checks
 * the export surface there. It fails if ANY satisfying version is missing a
 * symbol we import — the literal reading of "the declared range can resolve to
 * a version missing what we import". Under (2) that is a single version and
 * costs one small install; under a caret it is however many the vendor has
 * published, which is the cost of the risk being taken.
 *
 * It is opt-in because it needs the network: wired into `validate-deps.yml`,
 * which already installs from the registry, and not into the PR lint farm.
 * ⛔ It never "passes" when it cannot measure — an unreachable registry is
 * EXIT_PREREQUISITE_NOT_MET, never a green.
 *
 * ## Scope: why a ledger of vendor NAMES and not every dependency
 *
 * Requiring an exact pin on every third-party range would be a different
 * decision with a real cost (a release for every upstream patch). This gate
 * governs the vendors whose export surface we compile against AND which have
 * been observed to remove public exports without a major bump. Add a name to
 * `GOVERNED_VENDORS` with the evidence, never a blanket rule.
 *
 * ⛔ Type-only imports are deliberately out of scope: they are erased before
 * runtime, so a missing type is a `typecheck` finding, not a load failure.
 * `import type { … }` and inline `type` specifiers are skipped.
 *
 * ⛔ Test files are out of scope for the same reason the published artifact is
 * the subject here: a test importing a vendor symbol fails in `pnpm test`,
 * loudly, on the same install. What this gate exists to catch is the failure
 * that is invisible in-repo.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { workspacePackages } from './workspace-enumerator.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, requireDefaultExport } from './import-prerequisite.mjs';

const semver = await requireDefaultExport('semver', () => import('semver'), import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * Vendor package names — or `@scope/` prefixes — whose runtime export surface
 * this repo compiles against and whose declared range must therefore pin one
 * version. Every entry states the evidence that put it here.
 */
export const GOVERNED_VENDORS = [
  {
    match: (name) => name === 'better-auth' || name.startsWith('@better-auth/'),
    label: 'the better-auth family',
    evidence:
      '#16186 — @better-auth/core@1.7.3 (a PATCH) deleted createLocalAccountIssuer / ' +
      'createOAuthAccountIssuer from the declared `./db` exports subpath, which made ' +
      'published @objectstack/plugin-auth 17.1.0-17.3.0 unloadable on every fresh install.',
  },
];

/** @returns {boolean} whether `name` is a governed vendor package. */
export function isGovernedVendor(name) {
  return GOVERNED_VENDORS.some((v) => v.match(name));
}

/**
 * The package name a bare module specifier belongs to.
 * `@better-auth/core/db` -> `@better-auth/core`; `better-auth/adapters` ->
 * `better-auth`. Returns null for relative and absolute specifiers.
 */
export function packageNameOf(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Static VALUE imports only.
 *
 * Deliberately hand-rolled rather than TypeScript-AST based: this gate has to
 * run on a fresh worktree in the lint farm, and its finding is about text a
 * regex reads exactly as well. Three shapes carry runtime symbols —
 * `import { a, b } from`, `import d from`, `import * as ns from` — and the
 * fourth, `import 'x'`, imports no symbol but still LINKS the module, so it is
 * recorded with an empty symbol set.
 *
 * @returns {Array<{ specifier: string, symbols: string[] }>}
 */
export function parseStaticValueImports(source) {
  const found = new Map();
  const add = (specifier, symbols) => {
    const prev = found.get(specifier) ?? new Set();
    for (const s of symbols) prev.add(s);
    found.set(specifier, prev);
  };
  // `import type { … } from` / `import type X from` — erased, skipped whole.
  const named = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = named.exec(source))) {
    if (m[1]) continue;
    const symbols = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      // `type Foo` inside a value import list is erased too.
      .filter((s) => !/^type\s/.test(s))
      // `foo as bar` — the VENDOR side is the name before `as`.
      .map((s) => s.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    add(m[3], symbols);
  }
  const defaultOrNamespace =
    /import\s+(type\s+)?(?:\*\s*as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"]([^'"]+)['"]/g;
  while ((m = defaultOrNamespace.exec(source))) {
    if (m[1]) continue;
    add(m[2], []);
  }
  const bare = /import\s*['"]([^'"]+)['"]/g;
  while ((m = bare.exec(source))) add(m[1], []);
  return [...found].map(([specifier, symbols]) => ({ specifier, symbols: [...symbols].sort() }));
}

/** Every `.ts`/`.mts`/`.js`/`.mjs` under `dir/src` that is not a test file. */
function shippedSourceFiles(dir) {
  const out = [];
  const src = join(dir, 'src');
  if (!existsSync(src)) return out;
  const walk = (d) => {
    for (const entry of readdirSyncSafe(d)) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__fixtures__') continue;
        walk(full);
      } else if (/\.(m?ts|m?js)$/.test(entry.name) && !/\.(test|spec)\.(m?ts|m?js)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(src);
  return out;
}

function readdirSyncSafe(d) {
  try {
    return readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Collect the governed vendor import edges of every PUBLISHABLE workspace
 * package, plus the ranges those packages declare for them.
 *
 * @returns {{ edges: Map<string, Map<string, Set<string>>>, declarations: Map<string, Array<{ pkg: string, range: string }>> }}
 *   `edges`: vendor package name -> specifier -> symbols.
 *   `declarations`: vendor package name -> the publishable manifests declaring it.
 */
export function collectVendorEdges(root = repoRoot) {
  const edges = new Map();
  const declarations = new Map();
  for (const { dir, manifest } of workspacePackages(root)) {
    if (manifest.private === true) continue;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (!isGovernedVendor(name)) continue;
        if (typeof range !== 'string' || range.startsWith('workspace:')) continue;
        if (!declarations.has(name)) declarations.set(name, []);
        declarations.get(name).push({ pkg: manifest.name ?? dir, dir, field, range });
      }
    }
    for (const file of shippedSourceFiles(join(root, dir))) {
      const source = readFileSync(file, 'utf8');
      for (const { specifier, symbols } of parseStaticValueImports(source)) {
        const name = packageNameOf(specifier);
        if (!name || !isGovernedVendor(name)) continue;
        if (!edges.has(name)) edges.set(name, new Map());
        const bySpecifier = edges.get(name);
        if (!bySpecifier.has(specifier)) bySpecifier.set(specifier, new Set());
        for (const s of symbols) bySpecifier.get(specifier).add(s);
      }
    }
  }
  return { edges, declarations };
}

/**
 * The named exports a specifier really yields, imported from `fromDir`.
 * Returns null when the specifier cannot be loaded at all — the caller
 * distinguishes "not installed" from "installed but missing a symbol".
 */
/**
 * ⚠️ The probe file needs a UNIQUE name per call. ESM caches by resolved URL,
 * so reusing one path makes the second `import()` return the FIRST probe's
 * module — every specifier after the first is then measured against the wrong
 * namespace, which reads as a missing export on a package that has it.
 */
let probeSeq = 0;
async function namespaceKeys(specifier, fromDir) {
  const probe = join(fromDir, `.vendor-export-probe-${process.pid}-${probeSeq++}.mjs`);
  try {
    writeFileSync(probe, `export const ns = await import(${JSON.stringify(specifier)});\n`);
    const mod = await import(pathToFileURL(probe).href);
    return Object.keys(mod.ns);
  } catch {
    return null;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      /* the probe is scratch; a failed unlink is not this gate's finding */
    }
  }
}

/** The version of `name` installed in this workspace, or null. */
function installedVersion(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8')).version ?? null;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── the offline verdict ────────────────────────────────────────────────────

async function runOffline(root = repoRoot) {
  const findings = [];
  const { edges, declarations } = collectVendorEdges(root);
  const checked = [];

  for (const [vendor, bySpecifier] of [...edges].sort()) {
    const declared = declarations.get(vendor) ?? [];
    if (declared.length === 0) {
      findings.push(
        `${vendor}: publishable source statically imports runtime values from it, but NO publishable ` +
          `manifest declares it. A consumer's install has no reason to contain it at all.`,
      );
      continue;
    }
    const ranges = [...new Set(declared.map((d) => d.range))];
    const inexact = declared.filter((d) => semver.valid(d.range) === null);
    for (const d of inexact) {
      findings.push(
        `${d.pkg} declares "${vendor}": "${d.range}" — a governed vendor range must be an EXACT ` +
          `version. A range cannot state which export surface we compiled against, and this family ` +
          `removes public exports in patch releases, so semver does not protect it either.`,
      );
    }
    if (ranges.length > 1) {
      findings.push(
        `${vendor} is declared with ${ranges.length} different ranges (${ranges.join(', ')}). ` +
          `The family moves as one line; a consumer resolving two of them gets a mix nothing tested.`,
      );
    }
    if (inexact.length > 0) continue;

    const pinned = ranges[0];
    const fromDir = join(root, declared[0].dir);
    const installed = installedVersion(vendor, fromDir);
    if (installed === null) {
      console.error(
        `PREREQUISITE NOT MET: ${vendor} is declared by ${declared[0].pkg} but is not installed.\n` +
          `  Run \`pnpm install\` — this gate imports the vendor to read its real export surface.`,
      );
      process.exit(EXIT_PREREQUISITE_NOT_MET);
    }
    if (installed !== pinned) {
      findings.push(
        `${vendor}: declared "${pinned}" but ${installed} is installed here. The version this repo ` +
          `imports and the version a consumer resolves must be the same string, or CI certifies a ` +
          `surface the artifact never runs on.`,
      );
      continue;
    }

    for (const [specifier, symbols] of [...bySpecifier].sort()) {
      const keys = await namespaceKeys(specifier, fromDir);
      if (keys === null) {
        findings.push(`${specifier}: cannot be imported from ${declared[0].pkg} at ${vendor}@${installed}.`);
        continue;
      }
      const missing = [...symbols].filter((s) => !keys.includes(s)).sort();
      if (missing.length > 0) {
        findings.push(
          `${specifier} at ${vendor}@${installed} does not export ${missing.join(', ')} — ` +
            `imported statically by ${declared[0].pkg}. A static ESM named import of a missing ` +
            `export is a link-time SyntaxError: the package does not load at all.`,
        );
      }
      checked.push(`${specifier} @ ${vendor}@${installed} (${symbols.size} symbol(s): ${[...symbols].sort().join(', ')})`);
    }
  }
  return { findings, checked };
}

// ── the network leg ────────────────────────────────────────────────────────

function registryVersions(name) {
  const raw = execFileSync('npm', ['view', name, 'versions', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function runResolve(root = repoRoot) {
  const findings = [];
  const checked = [];
  const { edges, declarations } = collectVendorEdges(root);
  const scratch = mkdtempSync(join(tmpdir(), 'os-vendor-export-'));
  try {
    for (const [vendor, bySpecifier] of [...edges].sort()) {
      const declared = declarations.get(vendor) ?? [];
      if (declared.length === 0) continue;
      for (const range of [...new Set(declared.map((d) => d.range))]) {
        let all;
        try {
          all = registryVersions(vendor);
        } catch (e) {
          console.error(
            `PREREQUISITE NOT MET: could not read ${vendor} from the npm registry (${e?.message ?? e}).\n` +
              `  --resolve measures what a consumer resolves; an unreachable registry is NOT a pass.`,
          );
          process.exit(EXIT_PREREQUISITE_NOT_MET);
        }
        const satisfying = all.filter((v) => semver.satisfies(v, range, { includePrerelease: false }));
        if (satisfying.length === 0) {
          findings.push(`${vendor}: the declared range "${range}" matches no published version.`);
          continue;
        }
        for (const version of satisfying) {
          const dir = join(scratch, `${vendor.replace(/[@/]/g, '_')}-${version}`);
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, 'package.json'),
            `${JSON.stringify({ name: 'vendor-export-probe', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
          );
          try {
            execFileSync('npm', ['install', `${vendor}@${version}`, '--no-package-lock', '--no-audit', '--no-fund'], {
              cwd: dir,
              stdio: ['ignore', 'ignore', 'pipe'],
            });
          } catch (e) {
            console.error(
              `PREREQUISITE NOT MET: could not install ${vendor}@${version} (${e?.message ?? e}).`,
            );
            process.exit(EXIT_PREREQUISITE_NOT_MET);
          }
          for (const [specifier, symbols] of [...bySpecifier].sort()) {
            const keys = await namespaceKeys(specifier, dir);
            if (keys === null) {
              findings.push(
                `${specifier} cannot be imported at ${vendor}@${version}, which the declared range ` +
                  `"${range}" admits — a consumer resolving it gets a package that does not load.`,
              );
              continue;
            }
            const missing = [...symbols].filter((s) => !keys.includes(s)).sort();
            if (missing.length > 0) {
              findings.push(
                `${specifier} does not export ${missing.join(', ')} at ${vendor}@${version}, which ` +
                  `the declared range "${range}" admits. Our lockfile hides this; a consumer's ` +
                  `install does not.`,
              );
            }
            checked.push(
              `${specifier} @ ${vendor}@${version} (via "${range}", ${symbols.size} symbol(s))`,
            );
          }
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { findings, checked };
}

// ── self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const failures = [];
  const eq = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${name}: expected ${e}, got ${a}`);
  };

  // ── parseStaticValueImports ───────────────────────────────────────────────
  const parsed = parseStaticValueImports(
    [
      "import { createLocalAccountIssuer, createOAuthAccountIssuer } from '@better-auth/core/db';",
      "import type { Auth } from 'better-auth';",
      "import { type WhereOperator, createAdapterFactory } from 'better-auth/adapters';",
      "import { socialProviders as factories } from '@better-auth/core/social-providers';",
      "const { x } = await import('@better-auth/core/error');",
    ].join('\n'),
  );
  const bySpec = Object.fromEntries(parsed.map((p) => [p.specifier, p.symbols]));
  eq('named value import', bySpec['@better-auth/core/db'], [
    'createLocalAccountIssuer',
    'createOAuthAccountIssuer',
  ]);
  eq('import type is erased', bySpec['better-auth'], undefined);
  eq('inline type specifier is erased', bySpec['better-auth/adapters'], ['createAdapterFactory']);
  eq('renamed import keeps the VENDOR name', bySpec['@better-auth/core/social-providers'], [
    'socialProviders',
  ]);
  eq('dynamic import is not static', bySpec['@better-auth/core/error'], undefined);

  // ── packageNameOf ─────────────────────────────────────────────────────────
  eq('scoped subpath', packageNameOf('@better-auth/core/db'), '@better-auth/core');
  eq('unscoped subpath', packageNameOf('better-auth/adapters/memory'), 'better-auth');
  eq('relative is not a package', packageNameOf('./local'), null);

  // ── the ledger ────────────────────────────────────────────────────────────
  eq('better-auth is governed', isGovernedVendor('better-auth'), true);
  eq('@better-auth/* is governed', isGovernedVendor('@better-auth/kysely-adapter'), true);
  eq('an ungoverned vendor stays ungoverned', isGovernedVendor('zod'), false);
  if (GOVERNED_VENDORS.length < 1) failures.push('GOVERNED_VENDORS is empty — the gate checks nothing.');
  for (const v of GOVERNED_VENDORS) {
    if (!v.evidence || v.evidence.length < 40) {
      failures.push(`GOVERNED_VENDORS entry "${v.label}" carries no evidence for why it is governed.`);
    }
  }

  // ── the exactness rule, in BOTH directions ────────────────────────────────
  // A gate that has only ever been seen to pass is not a gate. These pin the
  // predicate the offline verdict is built on.
  eq('an exact version is exact', semver.valid('1.7.2') !== null, true);
  eq('a caret range is NOT exact', semver.valid('^1.7.2') !== null, false);
  eq('a tilde range is NOT exact', semver.valid('~1.7.2') !== null, false);
  eq('a wildcard is NOT exact', semver.valid('*') !== null, false);
  // The live specimen: `^1.7.2` admits the version that dropped the export.
  eq('^1.7.2 admits 1.7.3', semver.satisfies('1.7.3', '^1.7.2'), true);
  eq('1.7.2 admits only itself', semver.satisfies('1.7.3', '1.7.2'), false);

  // ── the repo's own state, read through the same collector ─────────────────
  //
  // [#17440] This case used to be anchored on `@better-auth/core/db` naming
  // `createLocalAccountIssuer` — the #16186 defect itself — and carried the
  // instruction "if the durable fix landed, retire this case with it". The
  // durable fix HAS landed: the platform adopted better-auth's rollback, the
  // two deleted names are imported nowhere, and the family sits on an exact
  // 1.7.3.
  //
  // ⛔ Retiring the SPECIMEN is not retiring the case. What this case exists
  // to catch is a collector that has silently stopped reaching publishable
  // source — at which point the whole gate passes over nothing, exactly the
  // way #16186 passed over nothing for three releases. So it re-anchors on a
  // LIVE edge instead of being deleted, and it still asserts a NAMED symbol
  // rather than merely the specifier: an edge with an empty symbol set proves
  // the import was found but not parsed.
  const { edges, declarations } = collectVendorEdges();
  const root = edges.get('better-auth');
  if (!root || !root.has('better-auth/adapters')) {
    failures.push(
      'the collector no longer sees the better-auth/adapters edge in publishable source — ' +
        'either the import moved (update this case) or the scan stopped reaching plugin-auth.',
    );
  } else {
    const symbols = [...root.get('better-auth/adapters')].sort();
    if (!symbols.includes('createAdapterFactory')) {
      failures.push(
        'the better-auth/adapters edge no longer names createAdapterFactory — if that import ' +
          'genuinely moved, re-anchor this case on another LIVE value import from a governed ' +
          'vendor. ⛔ Never delete it: an unanchored collector is a gate over nothing.',
      );
    }
  }
  // The retired specimen, asserted GONE. A stray re-introduction of either
  // deleted name would not load at all on the pinned 1.7.3, so it is worth one
  // line here rather than a runtime discovery.
  for (const [pkg, specs] of edges) {
    for (const [spec, syms] of specs) {
      for (const dead of ['createLocalAccountIssuer', 'createOAuthAccountIssuer']) {
        if (syms.has(dead)) {
          failures.push(
            `publishable source imports ${dead} from ${spec} (${pkg}) — better-auth deleted that ` +
              'export in 1.7.3 and #17440 retired our use of it; on the pinned line it cannot resolve.',
          );
        }
      }
    }
  }
  if (!declarations.has('@better-auth/core')) {
    failures.push('no publishable manifest declares @better-auth/core — the collector lost the declaration side.');
  }

  if (failures.length > 0) {
    console.error('check-vendor-export-contract --self-test FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-vendor-export-contract --self-test OK (${GOVERNED_VENDORS.length} governed vendor family)`);
}

// ── entry ──────────────────────────────────────────────────────────────────

// Only when RUN, never when imported: a caller that imports the collector must
// not inherit this gate's exit code. `isEntrypoint` is the one predicate in
// scripts/ that survives a symlinked checkout — a hand-typed process.argv[1]
// comparison goes inert there, silently, at exit 0.
const isMain = isEntrypoint(import.meta.url);
const args = isMain ? process.argv.slice(2) : [];
if (!isMain) {
  /* imported for its exports */
} else if (args.includes('--self-test')) {
  selfTest();
} else {
  const wantResolve = args.includes('--resolve');
  const { findings, checked } = wantResolve ? await runResolve() : await runOffline();
  const leg = wantResolve ? 'registry resolution' : 'installed workspace';
  if (findings.length > 0) {
    console.error(`VERDICT: FAIL — vendor export contract (${leg})`);
    for (const f of findings) console.error(`  - ${f}`);
    console.error(
      '\nRemedy: pin the declaring manifest AND pnpm-workspace.yaml `overrides` to the exact\n' +
        'version whose export surface this repo compiles against, in one commit, for the whole\n' +
        'family. ⛔ Never widen the range to make this pass — a wider range is the defect.',
    );
    process.exit(1);
  }
  console.log(`VERDICT: PASS — vendor export contract (${leg}), ${checked.length} edge(s) verified`);
  for (const c of checked) console.log(`  ✓ ${c}`);
}
