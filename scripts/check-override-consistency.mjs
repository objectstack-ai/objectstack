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
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * Minimal pnpm-workspace.yaml block parsers (same approach as
 * scripts/check-changeset-fixed.mjs): this repo's file only uses simple
 * `key: value` scalars and `- item` lists, so a YAML dependency is avoided.
 */
function readWorkspaceYamlLines() {
  const text = readFileSync(resolve(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  return text.split(/\r?\n/);
}

/** @returns {string[]} */
function readWorkspacePatterns() {
  const patterns = [];
  let inPackages = false;
  for (const raw of readWorkspaceYamlLines()) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/.exec(line);
      if (m) {
        patterns.push(m[1]);
        continue;
      }
      if (/^\S/.test(line)) inPackages = false;
    }
  }
  return patterns;
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

/** @param {string} pattern @returns {string[]} */
function expandPattern(pattern) {
  const segments = pattern.split('/');
  let dirs = [repoRoot];
  for (const seg of segments) {
    const next = [];
    for (const dir of dirs) {
      if (seg === '*') {
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            next.push(join(dir, entry.name));
          }
        }
      } else {
        const candidate = join(dir, seg);
        try {
          if (statSync(candidate).isDirectory()) next.push(candidate);
        } catch {
          /* missing - skip */
        }
      }
    }
    dirs = next;
  }
  return dirs;
}

/** @returns {Array<{ dir: string, pkg: any }>} all non-private workspace packages */
function listPublishablePackages() {
  const seen = new Set();
  const result = [];
  for (const pattern of readWorkspacePatterns()) {
    for (const dir of expandPattern(pattern)) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (!pkg.name || pkg.private === true) continue;
      if (seen.has(pkg.name)) continue;
      seen.add(pkg.name);
      result.push({ dir, pkg });
    }
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

function main() {
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

  if (violations.length === 0) {
    console.log(
      `✓ ${checked} published-manifest declaration(s) covered by pnpm-workspace.yaml overrides all resolve to their override targets.`,
    );
    return;
  }

  console.error('✗ pnpm-workspace.yaml overrides are not reflected in published manifests.');
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
