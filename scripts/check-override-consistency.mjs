#!/usr/bin/env node
/**
 * Validates that pnpm-workspace.yaml `overrides` are reflected in the
 * manifests of publishable packages.
 *
 * Run:  node scripts/check-override-consistency.mjs
 *
 * Why: pnpm overrides apply ONLY inside this workspace — they do not ship
 * with published packages. If an override forces `better-auth` to
 * 1.7.0-rc.1 but @objectstack/plugin-auth still declares `^1.6.23`, every
 * CI job and showcase in this repo runs the overridden (tested) version
 * while a downstream `npx create-objectstack` install resolves the declared
 * range to a combination that was never tested here (the 15.1.0 quickstart
 * shipped exactly this: auth 500'd on every fresh project).
 *
 * For every override whose package name appears in a publishable package's
 * `dependencies` / `optionalDependencies` / `peerDependencies`, the declared
 * range must resolve to the override target under npm's default semantics
 * (no implicit prereleases — the same rules a downstream install uses):
 *   - exact target version V  → semver.satisfies(V, declaredRange)
 *   - target range R          → semver.intersects(declaredRange, R)
 * Declarations that can never be rewritten by the override (their range does
 * not intersect the override's `pkg@selector` scope) are skipped: workspace
 * and downstream already resolve those identically.
 *
 * Uses the `semver` package (root devDependency), so it must run after
 * `pnpm install` — which is how the validate-deps workflow orders it.
 *
 * ---------------------------------------------------------------------------
 * Health report (#6046, companion to the #5835 ruling A) — REPORTS, NEVER RED
 * ---------------------------------------------------------------------------
 * The rule above only fires when an override's package is DECLARED by a
 * publishable manifest. An override that nothing declares — and, after #5825
 * retired vscode-objectstack, that nothing even pulls transitively — is simply
 * skipped, so it is completely invisible. That is dangerous in both
 * directions: it can be trusted as though it were in force, or deleted by the
 * next agent tidying up. So the check also prints two informational censuses.
 *
 * Both are REPORTS and leave the exit code alone. A pinned-but-unconsumed
 * override is a legitimate defence-in-depth posture (that is exactly what
 * #5835 ruling A decided for form-data / undici); the goal here is visibility,
 * not prohibition. Nothing below may ever call process.exit.
 *
 * 1. IDLE OVERRIDES — the package name appears nowhere in the dependency tree,
 *    so the override cannot rewrite anything until something reintroduces the
 *    dependency.
 *
 *    The census is NAME-LEVEL on purpose. A tempting alternative is to count
 *    resolutions that fall inside the override's selector, but pnpm-lock.yaml
 *    records POST-override resolutions: a working override has already moved
 *    its matches up to the target and out of the selector. Measured on the
 *    tree this check ships against, that alternative scores zero in-selector
 *    resolutions for 28 of 28 overrides — working ones included — so it cannot
 *    tell "idle" from "doing its job". Absence of the name is the only signal
 *    the lockfile can honestly supply.
 *
 * 2. SELF-EXPIRING SELECTORS — the selector's exclusive upper bound `<V` sits
 *    at or below the target's own floor, so no version at or above the target
 *    is in scope. The pin then silently stops matching the day the target
 *    version itself gets an advisory and has to move: `undici@>=7.23.0
 *    <7.28.0` did exactly that when 7.28.0's own advisories landed (#4961,
 *    #5032). The durable shape puts the upper bound above the target's line
 *    and moves only the replacement target.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePackages } from './workspace-enumerator.mjs';
import { requireDefaultExport, requireDependency } from './import-prerequisite.mjs';
const semver = await requireDefaultExport('semver', () => import('semver'), import.meta.url);
const { parse: parseYaml } = await requireDependency('yaml', () => import('yaml'), import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * Minimal reader for the `overrides:` block, hand-parsed because this repo's
 * file only uses simple `key: value` scalars there.
 *
 * The `packages:` block is NOT parsed here any more — that one moved to
 * scripts/workspace-enumerator.mjs (#11510), which nine scripts now share. This
 * block stayed behind on purpose: it is a different question with exactly one
 * reader, so consolidating it would create a shared module with one caller.
 */
function readWorkspaceYamlLines() {
  const text = readFileSync(resolve(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  return text.split(/\r?\n/);
}

/**
 * @returns {Array<{ name: string, selector: string | null, target: string }>}
 *   One entry per `overrides:` line. `selector` is the optional range scope
 *   in an `'pkg@<range>': target` key; `target` is the forced version/range.
 */
function readOverrides() {
  const overrides = [];
  let inOverrides = false;
  for (const raw of readWorkspaceYamlLines()) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^overrides\s*:\s*$/.test(line)) {
      inOverrides = true;
      continue;
    }
    if (!inOverrides) continue;
    if (/^\S/.test(line)) {
      inOverrides = false;
      continue;
    }
    const m = /^\s+["']?([^"':]+?)["']?\s*:\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const target = m[2].trim();
    // Split `pkg@selector` on the LAST `@` so scoped names survive.
    const at = key.lastIndexOf('@');
    if (at > 0) {
      overrides.push({ name: key.slice(0, at), selector: key.slice(at + 1), target });
    } else {
      overrides.push({ name: key, selector: null, target });
    }
  }
  return overrides;
}

/**
 * All non-private workspace packages, as `{ dir, pkg }` with an ABSOLUTE dir.
 *
 * Membership comes from `scripts/workspace-enumerator.mjs` (#11510) — this
 * repo's one parse of the `packages:` block, and one of nine private copies
 * before it. The `overrides:` parser above stays here: it reads a DIFFERENT
 * block of the same file, and nothing else in the repo reads that one.
 *
 * @returns {Array<{ dir: string, pkg: any }>}
 */
function listPublishablePackages() {
  const seen = new Set();
  const result = [];
  for (const { dir, manifest } of workspacePackages(repoRoot)) {
    if (!manifest.name || manifest.private === true) continue;
    if (seen.has(manifest.name)) continue;
    seen.add(manifest.name);
    result.push({ dir: join(repoRoot, dir), pkg: manifest });
  }
  return result;
}

/**
 * Resolve a manifest entry to the package name + range npm would install.
 * Returns null for entries that are rewritten at publish time or are not
 * registry ranges (workspace:, catalog:, file:, link:, git/urls, tags).
 *
 * @param {string} declaredName @param {string} declaredValue
 * @returns {{ name: string, range: string } | null}
 */
function toRegistryRange(declaredName, declaredValue) {
  let name = declaredName;
  let range = declaredValue;
  if (range.startsWith('npm:')) {
    // Alias: `alias: npm:real-name@range`
    const rest = range.slice('npm:'.length);
    const at = rest.lastIndexOf('@');
    if (at <= 0) return null;
    name = rest.slice(0, at);
    range = rest.slice(at + 1);
  }
  if (/^(workspace|catalog|file|link|git|github):/.test(range)) return null;
  if (semver.validRange(range) === null) return null; // tags, urls
  return { name, range };
}

/**
 * Would the override rewrite anything this range can resolve to? If the
 * declared range cannot intersect the override's selector scope, workspace
 * and downstream installs already agree and the check does not apply.
 */
function overrideApplies(override, declaredRange) {
  if (override.selector === null) return true;
  if (semver.validRange(override.selector, { includePrerelease: true }) === null) return true;
  try {
    return semver.intersects(declaredRange, override.selector, { includePrerelease: true });
  } catch {
    return true; // be conservative: unparseable → keep checking
  }
}

/**
 * Downstream (no overrides, npm default prerelease rules): does the declared
 * range resolve to the override target?
 */
function declarationMatchesTarget(declaredRange, target) {
  if (semver.valid(target) !== null) {
    return semver.satisfies(target, declaredRange);
  }
  if (semver.validRange(target) !== null) {
    try {
      return semver.intersects(declaredRange, target);
    } catch {
      return false;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------
 * Health report 1: idle overrides (zero consumers in the dependency tree)
 * ---------------------------------------------------------------------- */

/** Dependency maps to walk in each lockfile section. */
const LOCK_IMPORTER_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const LOCK_SNAPSHOT_FIELDS = ['dependencies', 'optionalDependencies'];

/**
 * Index every package name the dependency tree depends on, from the local
 * pnpm-lock.yaml. Deterministic and offline — the lockfile is checked in, and
 * the validate-deps workflow runs `pnpm install --frozen-lockfile` first, so
 * it is always current where this check runs.
 *
 * `importers` covers the workspace projects' own declarations; `snapshots`
 * covers every resolved third-party package's resolved dependencies. Between
 * them, a name that appears in neither is depended on by nothing.
 *
 * @param {string} [text] lockfile contents; read from disk when omitted
 * @returns {Map<string, Array<{ from: string, version: string }>> | null}
 *   null when there is no readable lockfile (census skipped, never fatal)
 */
function buildConsumerIndex(text) {
  let source = text;
  if (source === undefined) {
    const lockPath = resolve(repoRoot, 'pnpm-lock.yaml');
    if (!existsSync(lockPath)) return null;
    source = readFileSync(lockPath, 'utf8');
  }
  let lock;
  try {
    lock = parseYaml(source);
  } catch {
    return null;
  }
  if (!lock || typeof lock !== 'object') return null;

  /** @type {Map<string, Array<{ from: string, version: string }>>} */
  const index = new Map();
  const add = (name, from, version) => {
    const list = index.get(name) ?? [];
    list.push({ from, version: String(version) });
    index.set(name, list);
  };

  for (const [path, importer] of Object.entries(lock.importers ?? {})) {
    for (const field of LOCK_IMPORTER_FIELDS) {
      for (const [name, spec] of Object.entries(importer?.[field] ?? {})) {
        add(name, `workspace ${path} (${field})`, spec?.version ?? spec?.specifier ?? '?');
      }
    }
  }
  for (const [id, snapshot] of Object.entries(lock.snapshots ?? {})) {
    for (const field of LOCK_SNAPSHOT_FIELDS) {
      for (const [name, version] of Object.entries(snapshot?.[field] ?? {})) {
        add(name, id, version);
      }
    }
  }
  return index;
}

/**
 * @param {ReturnType<typeof readOverrides>} overrides
 * @param {Map<string, Array<{ from: string, version: string }>>} consumerIndex
 * @returns {Array<{ override: any, consumers: Array<{ from: string, version: string }> }>}
 *   one entry per override whose package nothing in the tree depends on
 */
function findIdleOverrides(overrides, consumerIndex) {
  const idle = [];
  for (const override of overrides) {
    const consumers = consumerIndex.get(override.name) ?? [];
    if (consumers.length === 0) idle.push({ override, consumers });
  }
  return idle;
}

/* -------------------------------------------------------------------------
 * Health report 2: self-expiring selectors (#4961 / #5032)
 * ---------------------------------------------------------------------- */

/**
 * The exclusive upper bound of a selector, if it has one: `>=7.23.0 <7.29.0`
 * and `<4.0.6` both yield the bound version. `<=V` is deliberately not a
 * match — it covers V, so the target's own version stays in scope.
 *
 * @param {string | null} selector @returns {string | null}
 */
function exclusiveUpperBound(selector) {
  if (!selector) return null;
  const match = /(?:^|\s)<\s*([0-9][^\s|]*)/.exec(selector);
  if (!match) return null;
  return semver.valid(match[1]) ? match[1] : null;
}

/** The lowest version an override target can resolve to. */
function targetFloor(target) {
  if (semver.valid(target) !== null) return target;
  try {
    return semver.minVersion(target)?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Report an override whose selector excludes the very target it pins to: with
 * an exclusive bound `<V` and a target floor at or above V, nothing from the
 * target's version line is in scope. Such a pin has to be widened in lockstep
 * every time the target moves, and silently matches nothing when it is not.
 *
 * @param {ReturnType<typeof readOverrides>} overrides
 * @returns {Array<{ override: any, bound: string, floor: string }>}
 */
function findSelfExpiringOverrides(overrides) {
  const found = [];
  for (const override of overrides) {
    const bound = exclusiveUpperBound(override.selector);
    if (bound === null) continue;
    const floor = targetFloor(override.target);
    if (floor === null) continue;
    if (semver.lte(bound, floor)) found.push({ override, bound, floor });
  }
  return found;
}

/** `pkg@selector` (or bare `pkg`) exactly as it is keyed in the YAML. */
function overrideKey(override) {
  return override.selector ? `${override.name}@${override.selector}` : override.name;
}

/**
 * Print both censuses. Informational only — this never sets the exit code.
 *
 * @param {ReturnType<typeof readOverrides>} overrides
 */
function reportOverrideHealth(overrides) {
  const consumerIndex = buildConsumerIndex();
  const idle = consumerIndex === null ? [] : findIdleOverrides(overrides, consumerIndex);
  const selfExpiring = findSelfExpiringOverrides(overrides);

  if (consumerIndex === null) {
    console.log(
      '\nnote: no readable pnpm-lock.yaml — the idle-override census was skipped.',
    );
  } else if (idle.length === 0) {
    console.log(`\n[report] Consumer census: all ${overrides.length} override(s) name a package the dependency tree still pulls.`);
  } else {
    console.log(
      `\n[report] Consumer census: ${idle.length} of ${overrides.length} override(s) ` +
        'name a package NOTHING in the dependency tree depends on.',
    );
    for (const { override } of idle) {
      console.log(`  - '${overrideKey(override)}': '${override.target}'  — 0 consumers`);
    }
    console.log(
      '\n  These are REPORTS, not failures. An override with no consumer today is a\n' +
        '  legitimate defence-in-depth posture: it costs nothing and pins the version\n' +
        '  in advance if any dependency reintroduces the package. #5835 ruling A\n' +
        '  decided exactly this for the form-data / undici OSV pins — KEEP THEM.\n' +
        '  Do not "tidy up" an entry listed here without a ruling that says to.',
    );
  }

  if (selfExpiring.length > 0) {
    console.log(
      `\n[report] Self-expiring selectors: ${selfExpiring.length} of ${overrides.length} override(s) ` +
        'use a selector that excludes their own target.',
    );
    for (const { override, bound, floor } of selfExpiring) {
      // The bound-vs-floor relation is explained once below and is identical on
      // every row, so only the strictly-worse variant annotates itself: a bound
      // BELOW the floor leaves [bound, floor) covered by neither.
      const gap = semver.lt(bound, floor) ? `   (gap: ${bound} .. ${floor} matches nothing)` : '';
      console.log(`  - '${overrideKey(override)}' -> '${override.target}'${gap}`);
    }
    console.log(
      '\n  Also REPORTS, not failures. The shape is the prevailing one in this file,\n' +
        '  so this is a standing ledger rather than a regression: in each row above the\n' +
        '  exclusive upper bound sits at or below the target floor, so nothing at or\n' +
        '  above the target is in scope and the selector has to be widened in lockstep\n' +
        '  every time the target moves. `undici@>=7.23.0 <7.28.0` stopped matching the\n' +
        '  day 7.28.0 got its own advisory (#4961, #5032). The durable shape puts the\n' +
        '  upper bound above the target\'s version line and moves only the target.',
    );
  }
}

/* -------------------------------------------------------------------------
 * Self-test — proves every rule in this file in BOTH directions, so a check
 * that has quietly stopped checking cannot pass as green.
 * ---------------------------------------------------------------------- */

/** @param {string} key @param {string} target */
function fixtureOverride(key, target) {
  const at = key.lastIndexOf('@');
  return at > 0
    ? { name: key.slice(0, at), selector: key.slice(at + 1), target }
    : { name: key, selector: null, target };
}

/**
 * A miniature pnpm-lock.yaml: one workspace importer that declares `semver`,
 * one third-party snapshot that pulls `undici`. Nothing anywhere pulls
 * `form-data` — the shape #5835 found in the real tree.
 */
const FIXTURE_LOCKFILE = [
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '  .:',
  '    devDependencies:',
  '      semver:',
  "        specifier: ^7.8.5",
  '        version: 7.8.5',
  '',
  'packages:',
  '  undici@7.29.0:',
  '    resolution: {integrity: sha512-fixture}',
  '',
  'snapshots:',
  "  '@ai-sdk/provider-utils@5.0.16':",
  '    dependencies:',
  '      undici: 7.29.0',
  '',
].join('\n');

function selfTest() {
  const index = buildConsumerIndex(FIXTURE_LOCKFILE);
  const idleKeys = (keys) =>
    findIdleOverrides(keys.map(([k, t]) => fixtureOverride(k, t)), index).map((e) =>
      overrideKey(e.override),
    );
  const expiringKeys = (keys) =>
    findSelfExpiringOverrides(keys.map(([k, t]) => fixtureOverride(k, t))).map((e) =>
      overrideKey(e.override),
    );

  const cases = [
    // --- consumer census -------------------------------------------------
    {
      name: 'lockfile parses into a consumer index',
      actual: () => index !== null && index.size > 0,
      expect: true,
    },
    {
      name: 'unparseable lockfile -> census skipped, never a crash',
      actual: () => buildConsumerIndex('this: [is not: valid yaml'),
      expect: null,
    },
    {
      name: 'lockfile that is not a mapping -> census skipped',
      actual: () => buildConsumerIndex('just a scalar'),
      expect: null,
    },
    {
      name: 'transitive consumer present (snapshot pulls undici) -> NOT reported',
      actual: () => idleKeys([['undici@>=7.23.0 <7.29.0', '^7.29.0']]).length,
      expect: 0,
    },
    {
      name: 'workspace importer counts as a consumer (semver) -> NOT reported',
      actual: () => idleKeys([['semver@<7.8.5', '^7.8.5']]).length,
      expect: 0,
    },
    {
      name: 'zero consumers (nothing pulls form-data) -> REPORTED',
      actual: () => idleKeys([['form-data@<4.0.6', '>=4.0.6']]).join(','),
      expect: 'form-data@<4.0.6',
    },
    {
      name: 'census reports only the idle one out of a mixed set',
      actual: () =>
        idleKeys([
          ['undici@>=7.23.0 <7.29.0', '^7.29.0'],
          ['form-data@<4.0.6', '>=4.0.6'],
          ['semver@<7.8.5', '^7.8.5'],
        ]).join(','),
      expect: 'form-data@<4.0.6',
    },
    // --- self-expiring selectors ----------------------------------------
    {
      name: 'bound equal to the target floor (the #5032 undici shape) -> REPORTED',
      actual: () => expiringKeys([['undici@>=7.23.0 <7.29.0', '^7.29.0']]).join(','),
      expect: 'undici@>=7.23.0 <7.29.0',
    },
    {
      name: 'bound below the target floor (uncovered gap) -> REPORTED',
      actual: () => expiringKeys([['@hono/node-server@<2.0.5', '^2.0.10']]).join(','),
      expect: '@hono/node-server@<2.0.5',
    },
    {
      name: 'bound above the target version line (the durable shape) -> NOT reported',
      actual: () => expiringKeys([['undici@>=7.23.0 <8.0.0', '^7.29.0']]).length,
      expect: 0,
    },
    {
      name: 'selector with no upper bound -> NOT reported',
      actual: () => expiringKeys([['esbuild', '>=0.28.1']]).length,
      expect: 0,
    },
    {
      name: 'inclusive upper bound covers the target -> NOT reported',
      actual: () => expiringKeys([['uuid@<=11.1.1', '11.1.1']]).length,
      expect: 0,
    },
    // --- the core rule this file has always enforced ---------------------
    {
      name: 'declared range that reaches the target -> no violation',
      actual: () => declarationMatchesTarget('^7.29.0', '^7.29.0'),
      expect: true,
    },
    {
      name: 'declared range that cannot reach the target -> violation',
      actual: () => declarationMatchesTarget('^1.6.23', '1.7.0-rc.1'),
      expect: false,
    },
    {
      name: 'no implicit prereleases: ^1.7.0 does not reach 1.7.0-rc.2',
      actual: () => declarationMatchesTarget('^1.7.0', '1.7.0-rc.2'),
      expect: false,
    },
    {
      name: 'declaration outside the selector scope -> override does not apply',
      actual: () => overrideApplies(fixtureOverride('form-data@<4.0.6', '>=4.0.6'), '^5.0.0'),
      expect: false,
    },
    {
      name: 'declaration inside the selector scope -> override applies',
      actual: () => overrideApplies(fixtureOverride('form-data@<4.0.6', '>=4.0.6'), '^4.0.0'),
      expect: true,
    },
  ];

  let passed = true;
  console.log('check-override-consistency self-test (both directions):');
  for (const testCase of cases) {
    let actual;
    try {
      actual = testCase.actual();
    } catch (error) {
      actual = `threw: ${error.message}`;
    }
    const ok = actual === testCase.expect;
    if (!ok) passed = false;
    console.log(
      `${ok ? '  ✓' : '  ✗'} ${testCase.name}` +
        (ok ? '' : `\n      expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(actual)}`),
    );
  }

  if (!passed) {
    console.error('\n✗ self-test failed — this check does not do what it claims.');
    process.exit(1);
  }
  console.log(
    `\n✓ self-test passed (${cases.length} assertions): consumers present are not reported,` +
      '\n  zero-consumer and self-expiring overrides are, and the manifest rule still' +
      '\n  separates reachable declarations from unreachable ones.',
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const overrides = readOverrides();
  if (overrides.length === 0) {
    console.log('✓ No overrides in pnpm-workspace.yaml — nothing to check.');
    return;
  }
  const overridesByName = new Map();
  for (const o of overrides) {
    const list = overridesByName.get(o.name) ?? [];
    list.push(o);
    overridesByName.set(o.name, list);
  }

  const FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
  const violations = [];
  let checked = 0;

  for (const { dir, pkg } of listPublishablePackages()) {
    for (const field of FIELDS) {
      for (const [depName, depValue] of Object.entries(pkg[field] ?? {})) {
        if (typeof depValue !== 'string') continue;
        const entry = toRegistryRange(depName, depValue);
        if (!entry) continue;
        const candidates = overridesByName.get(entry.name);
        if (!candidates) continue;
        for (const override of candidates) {
          if (!overrideApplies(override, entry.range)) continue;
          checked += 1;
          if (declarationMatchesTarget(entry.range, override.target)) continue;
          violations.push({
            pkgName: pkg.name,
            manifest: relative(repoRoot, join(dir, 'package.json')),
            field,
            depName,
            declared: depValue,
            override,
          });
        }
      }
    }
  }

  // Informational censuses first, blocking verdict last: CI readers look at
  // the bottom of a log, and the verdict is what decides the job.
  reportOverrideHealth(overrides);

  if (violations.length === 0) {
    console.log(
      `\n✓ ${checked} published-manifest declaration(s) covered by pnpm-workspace.yaml overrides all resolve to their override targets.`,
    );
    return;
  }

  console.error('\n✗ pnpm-workspace.yaml overrides are not reflected in published manifests.');
  console.error(
    '\npnpm overrides apply only inside this workspace — they do NOT ship with',
  );
  console.error(
    'published packages. Downstream installs resolve the declared range below to',
  );
  console.error(
    'a different version than every workspace build/test actually ran against:',
  );
  for (const v of violations) {
    const key = v.override.selector
      ? `${v.override.name}@${v.override.selector}`
      : v.override.name;
    console.error(
      `\n  - ${v.pkgName} (${v.manifest})\n` +
        `      ${v.field}.${v.depName}: "${v.declared}"\n` +
        `      override: '${key}': '${v.override.target}'\n` +
        `      → downstream resolves "${v.declared}" WITHOUT the override; update the\n` +
        `        declared range so it resolves to ${v.override.target} (or drop the override).`,
    );
  }
  console.error(
    '\nFix: sync the declared range with the override target in the package manifest,',
  );
  console.error(
    'then re-run: node scripts/check-override-consistency.mjs',
  );
  process.exit(1);
}

main();
