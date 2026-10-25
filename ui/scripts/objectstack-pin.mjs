#!/usr/bin/env node
/**
 * objectstack-pin -- objectui consumes `@objectstack/*` BY COMMIT, not by npm
 * version (ruling B on objectui#12955, executed by objectui#12957).
 *
 *   node scripts/objectstack-pin.mjs build    # `pnpm objectstack:build`; `pnpm run setup` = this, then a frozen install
 *   node scripts/objectstack-pin.mjs build --write-manifests   # also commit-ready manifests for a moved pin (bump-objectstack.sh)
 *   node scripts/objectstack-pin.mjs status   # what the cache holds, against the pin (exit 0 = built at the pin)
 *   node scripts/objectstack-pin.mjs check    # the root `preinstall`: refuses an install with no build beside the manifests
 *   OBJECTSTACK_ROOT=../objectstack node scripts/objectstack-pin.mjs build   # an existing tree stands in
 *
 * ## The contract
 *
 * `.objectstack-sha` names one objectstack `main` commit (`scripts/bump-objectstack.sh`
 * moves it). The root `package.json` overrides EVERY `@objectstack/*` package the
 * workspace resolves to a directory:
 *
 *     "@objectstack/spec": "file:.objectstack-pin/spec"
 *
 * Each such directory holds ONE committed file, the package's `package.json` as
 * `pnpm pack` packs it at the pinned commit (`canonicalManifest`). `build` builds
 * that commit into `node_modules/.cache/objectstack` -- the path CI caches by the
 * pin, whose stamp turbo hashes -- and links every other packed file beside the
 * manifest (git-ignored; a copy where a link fails). So no `@objectstack/*` package
 * resolves from npm; npm ranges in the manifests matter only when objectui itself
 * publishes (objectui#12958).
 *
 * ## Why the manifests are committed (objectui#13008)
 *
 * Dependabot resolves on a fresh clone with no `node_modules` (its job for run
 * 39180936608 ran `pnpm update next@16.3.8 --lockfile-only --no-save -r`). Measured
 * on clean clones: that command exits 0 with only the committed manifests, and 1
 * (ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND) when the overrides name a directory only
 * `build` creates; a lockfile-only run does not run the root `preinstall`. pnpm
 * HARD-LINKS a directory dependency's files at install time (same inode), so the
 * build must be beside the manifests before `pnpm install`, and the lockfile does
 * not change when it appears (byte-identical after a frozen install).
 *
 * The committed manifests must BE the pin's, since Dependabot resolves them: a
 * build at the pin REFUSES a packed manifest that differs from the committed one
 * (a pin moved without its manifests, a hand edit) and never writes over it;
 * `--write-manifests` writes them, and bump-objectstack.sh commits them with the
 * pin. A stand-in installs its OWN manifests (its exports may differ) and records
 * in its stamp the ones it replaced; the next build at the pin restores exactly
 * those, and nothing else.
 *
 * ## Why `file:` DIRECTORIES -- the resolution form, measured on objectui#12957
 *
 * Three forms were installed against the same pinned build, pnpm 10.31.0:
 *
 *   - `file:<pkg>.tgz` tarballs: the lockfile records each tarball's `integrity`
 *     and `version`, and a frozen install on a clean checkout failed with
 *     ERR_PNPM_TARBALL_INTEGRITY -- for a substituted tree AND for the same tree.
 *     A tarball pins its BYTES into `pnpm-lock.yaml`, so no other tree can stand in.
 *   - `link:<dir>`: the lockfile stays stable, but pnpm installs nothing a linked
 *     package depends on. Importing the packed `@objectstack/spec` failed with
 *     `Cannot find package 'zod'`; linking a source tree instead brings that tree's
 *     own zod, a second physical copy -- the objectstack#21108 split.
 *   - `file:<dir>`: the lockfile records `resolution: {directory: …, type: directory}`
 *     with NO integrity and NO version, and the package's dependencies resolve from
 *     objectui's own lockfile (one zod). A frozen install re-links a directory whose
 *     content changed (a marker written into a rebuilt dir reached `node_modules`).
 *
 * So the lockfile depends only on the packed manifests' dependencies, peers and
 * engines -- which is what lets another tree stand in without a lockfile change.
 *
 * The built files beside the manifests are git-ignored and listed in ESLint's
 * ignores (the spec packs its TypeScript `src/`). Removing `node_modules` removes
 * the build: the next `pnpm install` then refuses in the root `preinstall` (`check`)
 * until `pnpm run setup` runs again -- without it, an install would exit 0 and link
 * packages that hold nothing but a manifest.
 *
 * ## OBJECTSTACK_ROOT -- an existing objectstack tree stands in (objectstack#24306)
 *
 * With `OBJECTSTACK_ROOT` set, `build` packs the same packages from THAT tree into
 * the same directories, instead of building the pin. Nothing in it is installed,
 * built or regenerated (`pnpm pack` runs with scripts off): the tree must already be
 * installed (`pnpm pack` reads each `workspace:` dependency's version from the
 * installed links) and built, and a missing entry point refuses with the command
 * that builds it. The lockfile does not change; the committed manifests in
 * `.objectstack-pin` do, until the next build at the pin restores them.
 *
 * ## One build per machine (objectui#12972)
 *
 * A build at the pin is also kept once per machine, outside every checkout, in
 * `$OBJECTSTACK_PIN_STORE` (default `$XDG_CACHE_HOME/objectstack-pin`, else
 * `~/.cache/objectstack-pin`) as `PIN-HASH`, HASH over this script's bytes: CI's
 * cache key inputs. A checkout whose cache is not the pin COPIES the entry instead of
 * building -- never links it: the cache is hard-linked into `.objectstack-pin` and
 * `node_modules`, so a linked entry would carry one checkout's write into a built file
 * to every checkout. Only a build this run made is published (a current cache may
 * have been written to), copied, hashed (`.entry.json`) and renamed into place: a
 * reader finds no entry or a whole one, and a concurrent run that renamed first wins.
 * The COPY is judged before use, by the stamp check and the hash. A stand-in never
 * reads or writes the store; it keeps STORE_KEEP entries; a failed write only warns.
 *
 * ## The lockfile must record what the build declares -- and pnpm will not check it
 *
 * Measured on objectui#12957: with a pinned package's manifest given a dependency
 * the lockfile does not record, `pnpm install --frozen-lockfile` exited 0 and did
 * NOT install it -- a frozen install re-links a directory's files but resolves its
 * dependencies from the lockfile alone. So a pin (or a stand-in) whose packages
 * declare a different dependency set would install silently without it. `build`
 * therefore compares every packed manifest's dependency NAMES with the ones the
 * lockfile's `snapshots:` entry records for that package, after the cache is in
 * place, and refuses on any difference -- naming the remedy (`pnpm install`
 * rewrites the lockfile, reading the directories just written). ⚠️ Names, not
 * ranges: a range that moved while its name stayed is not compared here.
 *
 * ## Refusals (exit 1, nothing written)
 *
 *   - `.objectstack-sha` is not one full sha;
 *   - an `@objectstack/*` override is not the `file:.objectstack-pin/NAME`
 *     form, or a package objectui declares has no override (it would resolve from npm);
 *   - at the pin, a packed manifest differs from the committed one (see above);
 *   - the packages being packed need an `@objectstack/*` package with no override, or
 *     an override names a package nothing reaches -- the override set must equal the
 *     closure, so a pin that adds a dependency is a loud stop, never an npm fallback;
 *   - a packed package's `main`/`module`/`types`/`exports` target is missing.
 *
 * Every write goes to a staging directory that replaces the cache only once all
 * packages packed and every manifest was judged, so a failed run leaves the
 * previous build in place. One refusal comes AFTER the write, on purpose: the
 * lockfile-drift one above, whose remedy (`pnpm install`) needs the new build on
 * disk to read. `--write-manifests` skips it: a moved pin's lockfile is rewritten
 * next, by that same `pnpm install`.
 *
 * ⛔ Node builtins only: CI runs this BEFORE `pnpm install`
 * (`scripts/check-pre-install-import-graph.mjs` holds that).
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PIN_FILE = '.objectstack-sha';
export const CACHE_DIR = 'node_modules/.cache/objectstack';
/** The committed manifests, and the build linked beside them: what the overrides name. */
export const PIN_DIR = '.objectstack-pin';
export const STAMP_FILE = '.stamp.json';
export const OVERRIDE_PREFIX = `file:${PIN_DIR}/`;
/** Bump when what `build` writes changes shape, so an older cache is rebuilt rather than trusted. */
export const RECIPE = 1;
/** objectui#12972: the store's variable, an entry's record, how many entries it keeps. */
export const STORE_ENV = 'OBJECTSTACK_PIN_STORE';
export const ENTRY_FILE = '.entry.json';
export const STORE_KEEP = 4;
export const DEFAULT_REPO_URL = 'https://github.com/objectstack-ai/objectstack.git';

const SCOPE = '@objectstack/';
const SHA_RE = /^[0-9a-f]{40}$/;
const NAME_RE = /^@objectstack\/[a-z0-9][a-z0-9-]*$/;
const PROD_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const ALL_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** A refusal: printed as-is, exit 1. Anything else that throws is a crash. */
export class PinRefusal extends Error {}

// ── reading the contract ────────────────────────────────────────────────────

/**
 * The pinned sha. The file holds one full lowercase sha and, optionally, one
 * trailing newline -- nothing else, so a half-written or hand-mangled pin refuses.
 *
 * @param {string} root
 * @returns {string}
 */
export function readPin(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, PIN_FILE), 'utf8');
  } catch {
    throw new PinRefusal(`${PIN_FILE} is missing at ${root}. It names the objectstack commit this workspace builds; scripts/bump-objectstack.sh writes it.`);
  }
  const sha = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (!SHA_RE.test(sha)) {
    throw new PinRefusal(`${PIN_FILE} must hold exactly one full 40-character lowercase sha; it holds ${JSON.stringify(text.slice(0, 80))}.`);
  }
  return sha;
}

/**
 * The `@objectstack/*` overrides of the root manifest, as name -> cache directory.
 * Every one must be the pinned-build form; anything else would resolve some
 * `@objectstack/*` package from somewhere other than the pin.
 *
 * @param {{ pnpm?: { overrides?: Record<string, string> } }} manifest
 * @returns {Map<string, string>}
 */
export function readOverrides(manifest) {
  const overrides = manifest?.pnpm?.overrides ?? {};
  const map = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith(SCOPE)) continue;
    if (!NAME_RE.test(key)) {
      throw new PinRefusal(`pnpm.overrides key ${JSON.stringify(key)} is not a bare @objectstack/* package name; under the pin every @objectstack/* package is overridden whole, with no version selector.`);
    }
    const dir = key.slice(SCOPE.length);
    const expected = `${OVERRIDE_PREFIX}${dir}`;
    if (value !== expected) {
      throw new PinRefusal(`pnpm.overrides["${key}"] is ${JSON.stringify(value)}; under the pin it must be "${expected}".`);
    }
    map.set(key, dir);
  }
  if (map.size === 0) {
    throw new PinRefusal(`the root package.json declares no @objectstack/* override, so nothing would resolve to the pinned build.`);
  }
  return map;
}

/**
 * The `packages:` globs of a `pnpm-workspace.yaml`. Deliberately not a YAML
 * parser (this runs before install): it reads the one list it needs and refuses
 * a glob shape it does not understand rather than silently skipping it.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function workspaceGlobs(text) {
  const globs = [];
  let inPackages = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages || line.trim() === '') continue;
    const item = line.match(/^\s+-\s+(['"]?)(.+?)\1\s*$/);
    if (item) {
      globs.push(item[2]);
      continue;
    }
    if (/^\S/.test(line)) inPackages = false;
  }
  return globs;
}

/**
 * Every workspace project of a pnpm workspace, the root included, as
 * `{ dir, manifest }` with `dir` relative to `root`. Supports the two glob shapes
 * both repositories use -- `a/b` and `a/*` -- and refuses any other.
 *
 * @param {string} root
 * @returns {Array<{ dir: string, manifest: Record<string, any> }>}
 */
export function readWorkspace(root) {
  const yamlPath = path.join(root, 'pnpm-workspace.yaml');
  if (!fs.existsSync(yamlPath)) throw new PinRefusal(`${root} has no pnpm-workspace.yaml, so it is not a pnpm workspace.`);
  const projects = [{ dir: '.', manifest: readJson(path.join(root, 'package.json')) }];
  for (const glob of workspaceGlobs(fs.readFileSync(yamlPath, 'utf8'))) {
    if (glob.startsWith('!')) throw new PinRefusal(`unsupported workspace glob ${JSON.stringify(glob)} in ${yamlPath} (negations are not read here).`);
    const star = glob.endsWith('/*');
    const base = star ? glob.slice(0, -2) : glob;
    if (/[*?[\]{}]/.test(base)) throw new PinRefusal(`unsupported workspace glob ${JSON.stringify(glob)} in ${yamlPath}; only "dir" and "dir/*" are read here.`);
    const dirs = star
      ? safeReaddir(path.join(root, base)).map((name) => path.posix.join(base, name))
      : [base];
    for (const dir of dirs) {
      const manifestPath = path.join(root, dir, 'package.json');
      if (fs.existsSync(manifestPath)) projects.push({ dir, manifest: readJson(manifestPath) });
    }
  }
  return projects;
}

/**
 * Every `@objectstack/*` name the given projects declare, in any dependency field.
 *
 * @param {Array<{ manifest: Record<string, any> }>} projects
 * @returns {Set<string>}
 */
export function declaredObjectstackNames(projects) {
  const names = new Set();
  for (const { manifest } of projects) {
    for (const field of ALL_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) if (name.startsWith(SCOPE)) names.add(name);
    }
  }
  return names;
}

/**
 * The `@objectstack/*` closure of `roots` inside an objectstack workspace, over
 * RUNTIME edges only (dependencies, optional, peer) -- what an installer of the
 * published packages receives. devDependencies are excluded on purpose: they pull
 * in the drivers, runtime and services a package's own tests use (measured on
 * objectui#12957 at objectstack main `2ee5861b0f`: 36 projects with them, 7 without).
 *
 * @param {Map<string, { dir: string, manifest: Record<string, any> }>} byName
 * @param {Iterable<string>} roots
 * @returns {Set<string>}
 */
export function runtimeClosure(byName, roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const project = byName.get(name);
    if (!project) throw new PinRefusal(`${name} is not a package of the objectstack workspace being built, so it cannot come from the pin.`);
    seen.add(name);
    for (const field of PROD_FIELDS) {
      for (const dep of Object.keys(project.manifest[field] ?? {})) if (dep.startsWith(SCOPE)) queue.push(dep);
    }
  }
  return seen;
}

/**
 * The override set must equal what objectui needs from the pin -- exactly.
 *
 * @param {{ overrides: Map<string, string>, declared: Set<string>, byName: Map<string, any> }} input
 * @returns {string[]} the packages to pack, sorted
 */
export function checkOverrideSet({ overrides, declared, byName }) {
  const missing = [...declared].filter((n) => !overrides.has(n)).sort();
  if (missing.length) {
    throw new PinRefusal(
      `objectui declares ${missing.join(', ')} but the root package.json does not override ${missing.length === 1 ? 'it' : 'them'}, ` +
        `so ${missing.length === 1 ? 'it' : 'they'} would resolve from npm. Add ` +
        missing.map((n) => `"${n}": "${OVERRIDE_PREFIX}${n.slice(SCOPE.length)}"`).join(', ') +
        ' to pnpm.overrides.',
    );
  }
  const needed = runtimeClosure(byName, declared);
  const unoverridden = [...needed].filter((n) => !overrides.has(n)).sort();
  if (unoverridden.length) {
    throw new PinRefusal(
      `the packages objectui uses need ${unoverridden.join(', ')} at this objectstack commit, and the root package.json does not override ` +
        `${unoverridden.length === 1 ? 'it' : 'them'} -- ${unoverridden.length === 1 ? 'it' : 'they'} would resolve from npm. Add ` +
        unoverridden.map((n) => `"${n}": "${OVERRIDE_PREFIX}${n.slice(SCOPE.length)}"`).join(', ') +
        ' to pnpm.overrides.',
    );
  }
  const stale = [...overrides.keys()].filter((n) => !needed.has(n)).sort();
  if (stale.length) {
    throw new PinRefusal(
      `pnpm.overrides names ${stale.join(', ')}, which nothing objectui uses reaches at this objectstack commit. Delete ` +
        `${stale.length === 1 ? 'that override' : 'those overrides'}: a declared override nothing resolves through reads as a dependency that is not there.`,
    );
  }
  return [...needed].sort();
}

/**
 * Every file a manifest's entry fields point at: `main`, `module`, `types`,
 * `typings`, and every string leaf of `exports` that is not a pattern.
 *
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
export function entryTargets(manifest) {
  const targets = new Set();
  for (const field of ['main', 'module', 'types', 'typings']) {
    if (typeof manifest[field] === 'string') targets.add(manifest[field]);
  }
  const walk = (node) => {
    if (typeof node === 'string') {
      if (!node.includes('*')) targets.add(node);
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(manifest.exports);
  return [...new Set([...targets].map((t) => t.replace(/^\.\//, '')))].sort();
}

/**
 * @param {string} dir a packed package directory
 * @returns {string[]} entry targets the directory does not contain
 */
export function missingEntryTargets(dir) {
  const manifest = readJson(path.join(dir, 'package.json'));
  return entryTargets(manifest).filter((t) => !fs.existsSync(path.join(dir, t)));
}

/**
 * The dependency names the lockfile records for each pinned-build package: the
 * `dependencies` and `optionalDependencies` of every `snapshots:` entry keyed
 * `'@objectstack/<name>@file:…'`, unioned across peer contexts.
 *
 * @param {string} lockText
 * @returns {Map<string, Set<string>>}
 */
export function lockfileDependencyNames(lockText) {
  const recorded = new Map();
  const lines = lockText.split('\n');
  const start = lines.indexOf('snapshots:');
  if (start === -1) return recorded;
  let current = null;
  let inDeps = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    const key = line.match(/^ {2}'?(@objectstack\/[a-z0-9-]+)@file:[^:]*?'?:(?:\s.*)?$/);
    if (key) {
      current = key[1];
      if (!recorded.has(current)) recorded.set(current, new Set());
      inDeps = false;
      continue;
    }
    if (/^ {2}\S/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const block = line.match(/^ {4}(\w+):\s*$/);
    if (block) {
      inDeps = block[1] === 'dependencies' || block[1] === 'optionalDependencies';
      continue;
    }
    const dep = inDeps && line.match(/^ {6}'?([^'\s:]+)'?:/);
    if (dep) recorded.get(current).add(dep[1]);
  }
  return recorded;
}

/**
 * Packages whose packed manifest declares a dependency set the lockfile does not
 * record. A declared peer may appear in the lockfile (pnpm installs peers); a
 * runtime dependency the lockfile lacks, or one it records that nothing declares,
 * is drift.
 *
 * @param {Map<string, Set<string>>} recorded
 * @param {Map<string, Record<string, any>>} manifests package name -> packed manifest
 * @returns {Array<{ name: string, missing: string[], extra: string[], absent: boolean }>}
 */
export function dependencyDrift(recorded, manifests) {
  const drift = [];
  for (const [name, manifest] of [...manifests].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const runtime = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]);
    const peers = new Set(Object.keys(manifest.peerDependencies ?? {}));
    const inLock = recorded.get(name);
    if (!inLock) {
      drift.push({ name, missing: [...runtime].sort(), extra: [], absent: true });
      continue;
    }
    const missing = [...runtime].filter((d) => !inLock.has(d)).sort();
    const extra = [...inLock].filter((d) => !runtime.has(d) && !peers.has(d)).sort();
    if (missing.length || extra.length) drift.push({ name, missing, extra, absent: false });
  }
  return drift;
}

/**
 * Refuse when the cache and the lockfile disagree about dependencies.
 *
 * @param {string} root
 * @param {Map<string, string>} overrides
 */
export function assertLockfileRecordsBuild(root, overrides) {
  const manifests = new Map([...overrides].map(([name, dir]) => [name, readJson(path.join(root, PIN_DIR, dir, 'package.json'))]));
  const drift = dependencyDrift(lockfileDependencyNames(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8')), manifests);
  if (!drift.length) return;
  const lines = drift.map((d) =>
    d.absent
      ? `  ${d.name}: pnpm-lock.yaml has no pinned-build entry for it`
      : `  ${d.name}:${d.missing.length ? ` declares ${d.missing.join(', ')}, which the lockfile does not record;` : ''}${d.extra.length ? ` the lockfile records ${d.extra.join(', ')}, which it no longer declares;` : ''}`,
  );
  throw new PinRefusal(
    `pnpm-lock.yaml does not record the dependencies the build in ${PIN_DIR} declares:\n${lines.join('\n')}\n` +
      'A frozen install would link this build WITHOUT them and exit 0 -- pnpm resolves a directory dependency from the lockfile alone. ' +
      'The build is in place: run `pnpm install` to rewrite the lockfile from it, and commit pnpm-lock.yaml.',
  );
}

// ── the cache ───────────────────────────────────────────────────────────────

/**
 * @param {string} root
 * @returns {Record<string, any> | null}
 */
export function readStamp(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, CACHE_DIR, STAMP_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Whether the cache already holds the pin's build of exactly these packages.
 *
 * @param {Record<string, any> | null} stamp
 * @param {{ pin: string, overrides: Map<string, string>, root?: string, cache?: string }} want `cache` defaults to root's
 * @returns {{ current: boolean, why: string }}
 */
export function judgeStamp(stamp, { pin, overrides, root, cache = path.join(root, CACHE_DIR) }) {
  if (!stamp) return { current: false, why: 'no build in the cache' };
  if (stamp.recipe !== RECIPE) return { current: false, why: `the cache was written by recipe ${stamp.recipe}, this script is recipe ${RECIPE}` };
  if (stamp.source !== 'pin') return { current: false, why: `the cache holds a stand-in from ${stamp.root ?? 'an external tree'} (${String(stamp.sha).slice(0, 12)}), not the pin` };
  if (stamp.sha !== pin) return { current: false, why: `the cache holds ${String(stamp.sha).slice(0, 12)}, the pin is ${pin.slice(0, 12)}` };
  const want = [...overrides.keys()].sort();
  const have = Object.keys(stamp.packages ?? {}).sort();
  if (want.join() !== have.join()) return { current: false, why: `the cache holds ${have.join(', ') || 'no package'}, the overrides name ${want.join(', ')}` };
  for (const [name, dir] of overrides) {
    const manifest = path.join(cache, dir, 'package.json');
    if (!fs.existsSync(manifest) || readJson(manifest).name !== name) return { current: false, why: `${path.join(cache, dir)} does not hold ${name}` };
  }
  return { current: true, why: `built at the pin ${pin.slice(0, 12)}` };
}

/**
 * A content hash over every file of the packed directories, so a stand-in's stamp
 * changes whenever its bytes do (turbo hashes the stamp; see turbo.json).
 *
 * @param {string} dir
 * @returns {string}
 */
export function hashTree(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && child !== STAMP_FILE) {
        hash.update(`${child}\0`);
        hash.update(fs.readFileSync(path.join(dir, child)));
        hash.update('\0');
      }
    }
  };
  walk('');
  return `sha256-${hash.digest('hex')}`;
}

// ── the committed manifests, and the build beside them (objectui#13008) ─────

const sha256 = (bytes) => `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const DEPENDENCY_MAPS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];

/**
 * A packed manifest as it is committed. `pnpm pack` rewrites `workspace:` ranges
 * asynchronously, so two packs of ONE commit order a dependency map's keys
 * differently with every value equal (measured on objectui#13008: client and lint
 * differed between two builds of the pin). Those maps are sorted; nothing else
 * moves -- the order of `exports` conditions carries meaning.
 *
 * @param {string | Buffer} text
 * @returns {string | null} null when the text is not a JSON object
 */
export function canonicalManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(String(text));
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  for (const field of DEPENDENCY_MAPS) {
    const map = manifest[field];
    if (map && typeof map === 'object') manifest[field] = Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Hard-link (copy where a link fails) every file under `from` into `to`, except a top-level `package.json`. */
function linkTree(from, to, rel = '') {
  for (const entry of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (child === 'package.json') continue;
    if (entry.isDirectory()) {
      fs.mkdirSync(path.join(to, child), { recursive: true });
      linkTree(from, to, child);
    } else if (entry.isFile()) {
      try {
        fs.linkSync(path.join(from, child), path.join(to, child));
      } catch {
        fs.copyFileSync(path.join(from, child), path.join(to, child));
      }
    }
  }
}

/**
 * Put a packed build (`from`: one directory per package) beside the committed
 * manifests in PIN_DIR. Every manifest is judged, in its canonical form, before
 * anything is written:
 *
 *   - `pin`: the packed manifest must equal the one on disk, or be the one a
 *     stand-in replaced (`replaced`, from its stamp); anything else refuses, and
 *     an equal manifest is left byte for byte;
 *   - `write` (`--write-manifests`) and `stand-in`: the packed manifest is written.
 *
 * @param {string} root
 * @param {Map<string, string>} overrides
 * @param {{ from: string, mode: 'pin' | 'write' | 'stand-in', replaced?: Record<string, string> | null }} opts
 * @returns {Record<string, string>} the hash of each manifest that was on disk before
 */
export function materialize(root, overrides, { from, mode, replaced = null }) {
  const plan = [...overrides].map(([name, dir]) => {
    const target = path.join(root, PIN_DIR, dir);
    const manifest = path.join(target, 'package.json');
    const before = fs.existsSync(manifest) ? fs.readFileSync(manifest, 'utf8') : null;
    const packed = canonicalManifest(fs.readFileSync(path.join(from, dir, 'package.json')));
    if (packed === null) throw new PinRefusal(`the packed manifest of ${name} in ${from} is not a JSON object.`);
    const same = before !== null && canonicalManifest(before) === packed;
    return { name, dir, target, before, packed, same, write: mode === 'pin' ? !same : before !== packed };
  });
  const stale = plan.filter((p) => !p.same && replaced?.[p.name] !== sha256(p.packed));
  if (mode === 'pin' && stale.length) {
    throw new PinRefusal(
      `the manifests committed in ${PIN_DIR} are not the ones the pin packs:\n` +
        stale.map((p) => `  ${PIN_DIR}/${p.dir}/package.json ${p.before ? 'differs from' : 'is missing:'} the packed manifest of ${p.name}`).join('\n') +
        '\nDependabot resolves the lockfile from these files, so they must be the pin\'s. scripts/bump-objectstack.sh writes them ' +
        'with the pin; `node scripts/objectstack-pin.mjs build --write-manifests` writes them for the pin as it stands. Commit them.',
    );
  }
  for (const p of plan) {
    fs.mkdirSync(p.target, { recursive: true });
    for (const entry of fs.readdirSync(p.target)) {
      if (entry !== 'package.json') fs.rmSync(path.join(p.target, entry), { recursive: true, force: true });
    }
    linkTree(path.join(from, p.dir), p.target);
    if (p.write) {
      const tmp = path.join(p.target, '.package.json.tmp');
      fs.writeFileSync(tmp, p.packed);
      fs.renameSync(tmp, path.join(p.target, 'package.json'));
    }
  }
  return Object.fromEntries(plan.filter((p) => p.before !== null).map((p) => [p.name, sha256(canonicalManifest(p.before) ?? p.before)]));
}

/** @returns {string[]} the packages whose directory in PIN_DIR holds the manifest but not the build */
export function hollowPackages(root, overrides) {
  return [...overrides].filter(([, dir]) => missingEntryTargets(path.join(root, PIN_DIR, dir)).length > 0).map(([name]) => name);
}

/**
 * The root `preinstall`. Without the build beside the manifests, `pnpm install`
 * exits 0 and links packages holding nothing but a manifest; this refuses instead.
 * A lockfile-only resolution (Dependabot's) does not run it.
 */
export function check({ root = REPO_ROOT } = {}) {
  const hollow = hollowPackages(root, readOverrides(readJson(path.join(root, 'package.json'))));
  if (hollow.length) {
    throw new PinRefusal(
      `${PIN_DIR} holds the committed manifests of ${hollow.join(', ')} but not the pinned build, so this install would ` +
        'link packages with no code in them. Run `pnpm run setup`: it builds the pin, then installs.',
    );
  }
}

// ── one build per machine (objectui#12972) ─────────────────────────────────

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string} the store
 */
export function storeDir(env) {
  if (env[STORE_ENV]) return path.resolve(env[STORE_ENV]);
  return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'objectstack-pin');
}

/**
 * @param {string} pin
 * @param {string} [script] whose bytes key the entry: this one
 * @returns {string} `PIN-HASH`
 */
export function storeKey(pin, script = fileURLToPath(import.meta.url)) {
  return `${pin}-${sha256(fs.readFileSync(script)).slice(7, 23)}`;
}

/**
 * Copy an entry into an empty `staging` and judge the COPY, so a prune or a write racing it shows.
 *
 * @param {string} entry
 * @param {string} staging
 * @param {{ pin: string, overrides: Map<string, string> }} want
 * @returns {string | null} why it was not taken (`staging` left empty), or null
 */
export function takeFromStore(entry, staging, { pin, overrides }) {
  if (!fs.existsSync(entry)) return 'no entry for this pin and script';
  let why = null;
  try {
    fs.cpSync(entry, staging, { recursive: true });
    const { contentHash } = readJson(path.join(staging, ENTRY_FILE));
    fs.rmSync(path.join(staging, ENTRY_FILE));
    const verdict = judgeStamp(readJson(path.join(staging, STAMP_FILE)), { pin, overrides, cache: staging });
    if (!verdict.current) why = `the entry is not the pin: ${verdict.why}`;
    else if (hashTree(staging) !== contentHash) why = "the entry's files are not the ones it was published with";
    else fs.utimesSync(entry, new Date(), new Date()); // "recently used", for the prune
  } catch (error) {
    why = `the entry could not be read: ${error}`;
  }
  if (why !== null) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging);
  }
  return why;
}

/**
 * Publish a cache this run built: copy, hash, rename -- a reader finds no entry or a whole one.
 *
 * @param {string} cache
 * @param {string} entry
 * @param {number} [keep]
 * @returns {'published' | 'present'} `present`: another run's entry was there first
 */
export function publishToStore(cache, entry, keep = STORE_KEEP) {
  if (fs.existsSync(entry)) return 'present';
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(path.dirname(entry), '.tmp-'));
  try {
    fs.cpSync(cache, tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, ENTRY_FILE), `${JSON.stringify({ contentHash: hashTree(tmp) })}\n`);
    fs.renameSync(tmp, entry);
  } catch (error) {
    if (fs.existsSync(entry)) return 'present';
    throw error;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  pruneStore(path.dirname(entry), keep, path.basename(entry));
  return 'published';
}

/**
 * Keep `current` and the `keep - 1` most recently used others, each removal renamed
 * away first; a temporary directory an hour old is a dead run's.
 *
 * @param {string} store
 * @param {number} keep
 * @param {string} current
 */
export function pruneStore(store, keep, current) {
  const dirs = fs.readdirSync(store, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== current);
  const aged = dirs.map((e) => ({ name: e.name, mtime: fs.statSync(path.join(store, e.name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  const doomed = [
    ...aged.filter((e) => !e.name.startsWith('.')).slice(Math.max(keep - 1, 0)),
    ...aged.filter((e) => e.name.startsWith('.') && e.mtime < Date.now() - 3600_000),
  ];
  for (const { name } of doomed) {
    const gone = name.startsWith('.') ? name : `.gone-${name}-${process.pid}`;
    try {
      fs.renameSync(path.join(store, name), path.join(store, gone));
      fs.rmSync(path.join(store, gone), { recursive: true, force: true });
    } catch {}
  }
}

// ── running things ──────────────────────────────────────────────────────────

/**
 * Network settings an `npm_config_*` variable may carry from the machine itself
 * (a proxy, a registry, a CA): kept, because the objectstack install needs them.
 */
const AMBIENT_NPM_CONFIG = /^npm_config_(https?_proxy|proxy|no_?proxy|registry|ca|cafile|strict_ssl|store_dir)$/i;

/**
 * The environment for every pnpm call made IN THE OBJECTSTACK TREE: this repo's
 * `npm_config_*` settings removed, the machine's network ones kept.
 *
 * `pnpm run` exports the invoking workspace's `.npmrc` to the script as
 * `npm_config_*`, and a nested pnpm reads them as its own config. Measured on
 * objectui#12957: through `pnpm objectstack:build`, objectui's `engine-strict=true`
 * reached the objectstack install and refused it (`ERR_PNPM_UNSUPPORTED_ENGINE`,
 * a dev dependency of objectstack's asking a newer Node 22 patch), while the same
 * command run as `node scripts/objectstack-pin.mjs build` installed. The
 * objectstack tree is configured by its own `.npmrc`, not by this repository's.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function objectstackEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^npm_config_/i.test(key) || AMBIENT_NPM_CONFIG.test(key)),
  );
}

/**
 * Run a command; a non-zero exit is a refusal naming it.
 *
 * With `logTo`, the command's output goes to that file instead of the terminal,
 * and a failure carries the file's last lines in the refusal -- so the cause
 * reaches the place a refusal is read (a CI annotation, see the CLI below) and
 * not only a job log.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd: string, capture?: boolean, env?: NodeJS.ProcessEnv, logTo?: string }} opts
 * @returns {string} captured stdout (empty unless `capture`)
 */
function run(cmd, args, { cwd, capture = false, env = process.env, logTo }) {
  const fd = logTo ? fs.openSync(logTo, 'a') : null;
  let result;
  try {
    result = spawnSync(cmd, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: fd !== null ? ['ignore', fd, fd] : capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      maxBuffer: 256 * 1024 * 1024,
    });
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  if (result.error) throw new PinRefusal(`could not run \`${cmd} ${args.join(' ')}\` in ${cwd}: ${result.error.message}`);
  if (result.status !== 0) {
    let said = capture && result.stdout ? `\n${result.stdout.trim().slice(-2000)}` : '';
    if (logTo) said = `\n--- its last output lines ---\n${tailLines(fs.readFileSync(logTo, 'utf8'), 40)}`;
    throw new PinRefusal(`\`${cmd} ${args.join(' ')}\` exited ${result.status} in ${cwd}.${said}`);
  }
  return capture ? result.stdout : '';
}

/**
 * @param {string} text
 * @param {number} n
 * @returns {string}
 */
export function tailLines(text, n) {
  return text.trimEnd().split('\n').slice(-n).join('\n');
}

/**
 * A refusal as a GitHub Actions error annotation: annotations are readable
 * through the checks API, where a job's raw log may not be.
 *
 * @param {string} message
 * @returns {string}
 */
export function annotation(message) {
  const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::error title=objectstack-pin::${escaped}`;
}

function step(label, fn) {
  const started = Date.now();
  console.log(`→ ${label}`);
  const value = fn();
  console.log(`  ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return value;
}

/**
 * Fetch exactly the pinned commit into an empty directory.
 *
 * @param {string} dir
 * @param {string} sha
 * @param {string} url
 * @param {string} logTo
 */
export function checkoutPin(dir, sha, url, logTo) {
  run('git', ['init', '-q', dir], { cwd: os.tmpdir() });
  run('git', ['remote', 'add', 'origin', url], { cwd: dir });
  run('git', ['fetch', '-q', '--depth=1', '--no-tags', 'origin', sha], { cwd: dir, logTo });
  run('git', ['checkout', '-q', '--detach', 'FETCH_HEAD'], { cwd: dir });
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir, capture: true }).trim();
  if (head !== sha) throw new PinRefusal(`fetched ${head} from ${url}, but the pin is ${sha}.`);
  // HERMETIC: the remote goes once the commit is in. objectstack's spec build
  // anchors its schema ratchets on `origin/main` and fetches it when it can, so
  // with a remote the build of a fixed commit judged it against wherever main
  // was THAT minute. Measured on objectui#12957: the 18.0.0-next.3 commit built
  // fine against main as it was earlier and failed in 13 of 25 CI jobs once main
  // had added two schemas (`❌ 2 schema(s) left the published set`). With no
  // remote it anchors on the commit's own committed baseline, so the build is a
  // function of the pin alone.
  run('git', ['remote', 'remove', 'origin'], { cwd: dir });
}

/**
 * `pnpm pack` one workspace package (scripts off, so nothing in the tree is
 * regenerated) and unpack it into `dest`.
 *
 * @param {string} projectDir
 * @param {string} tarballs
 * @param {string} dest
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ name: string, version: string }}
 */
function packInto(projectDir, tarballs, dest, env) {
  const out = run('pnpm', ['pack', '--json', '--pack-destination', tarballs, '--config.ignore-scripts=true'], { cwd: projectDir, capture: true, env });
  const json = JSON.parse(out.slice(out.indexOf('{')));
  fs.mkdirSync(dest, { recursive: true });
  run('tar', ['-xzf', json.filename, '-C', dest, '--strip-components=1'], { cwd: projectDir });
  fs.rmSync(json.filename, { force: true });
  return { name: json.name, version: json.version };
}

/**
 * @param {string} tree an objectstack workspace
 * @returns {{ sha: string, dirty: boolean | null }}
 */
function describeTree(tree) {
  const head = spawnSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) return { sha: 'unknown', dirty: null };
  const status = spawnSync('git', ['-C', tree, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
  return { sha: head.stdout.trim(), dirty: status.status === 0 ? status.stdout.trim() !== '' : null };
}

/**
 * Build (or stand in) and pack every overridden package into the cache, then put
 * it beside the committed manifests.
 *
 * @param {{ root?: string, env?: NodeJS.ProcessEnv, writeManifests?: boolean }} [opts]
 * @returns {{ skipped: boolean, reused: boolean, stamp: Record<string, any> }} `reused`: copied from the store
 */
export function build({ root = REPO_ROOT, env = process.env, writeManifests = false } = {}) {
  const manifest = readJson(path.join(root, 'package.json'));
  const overrides = readOverrides(manifest);
  const declared = declaredObjectstackNames(readWorkspace(root));
  const external = env.OBJECTSTACK_ROOT ? path.resolve(root, env.OBJECTSTACK_ROOT) : null;
  const pin = readPin(root);
  if (external && writeManifests) throw new PinRefusal('--write-manifests writes the PIN\'s manifests; it does not combine with OBJECTSTACK_ROOT.');
  const previous = readStamp(root);
  // A stand-in's stamp names the committed manifests it replaced: what a build at the pin may restore.
  const replaced = previous?.source === 'external' ? (previous.replaced ?? null) : null;
  const mode = external ? 'stand-in' : writeManifests ? 'write' : 'pin';
  const settle = () => {
    if (writeManifests) console.log(`✓ ${PIN_DIR}/*/package.json are the pin's packed manifests. Run \`pnpm install\`, and commit them with pnpm-lock.yaml.`);
    else assertLockfileRecordsBuild(root, overrides);
  };

  // objectui#12972: the machine-wide entry for this pin and script; a stand-in has none.
  const entry = external ? null : path.join(storeDir(env), storeKey(pin));
  if (!external) {
    const verdict = judgeStamp(previous, { pin, overrides, root });
    if (verdict.current) {
      console.log(`✓ ${CACHE_DIR} is ${verdict.why} -- nothing to build.`);
      materialize(root, overrides, { from: path.join(root, CACHE_DIR), mode });
      settle();
      return { skipped: true, reused: false, stamp: previous };
    }
    console.log(`→ ${CACHE_DIR}: ${verdict.why}.`);
  } else {
    console.log(`→ OBJECTSTACK_ROOT is set: packing @objectstack/* from ${external}, standing in for the pin ${pin.slice(0, 12)}.`);
  }

  const cacheParent = path.dirname(path.join(root, CACHE_DIR));
  fs.mkdirSync(cacheParent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(cacheParent, 'objectstack.staging-'));
  const scratch = fs.mkdtempSync(path.join(scratchBase(env), 'ospin-'));
  const target = path.join(root, CACHE_DIR);
  try {
    const why = entry && takeFromStore(entry, staging, { pin, overrides });
    if (entry && why === null) {
      materialize(root, overrides, { from: staging, mode, replaced });
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
      console.log(`✓ ${CACHE_DIR} now holds the build of ${pin.slice(0, 12)} copied from ${entry}, linked into ${PIN_DIR}. Run \`pnpm install\` so node_modules links it.`);
      settle();
      return { skipped: false, reused: true, stamp: readStamp(root) };
    }
    if (entry) console.log(`→ ${entry}: ${why}. Building @objectstack/* at ${pin}.`);
    let tree = external;
    if (!external) {
      tree = path.join(scratch, 'src');
      step(`fetch objectstack ${pin.slice(0, 12)}`, () => checkoutPin(tree, pin, env.OBJECTSTACK_REPO_URL || DEFAULT_REPO_URL, path.join(scratch, 'fetch.log')));
    }
    const projects = readWorkspace(tree);
    /** @type {Map<string, { dir: string, manifest: Record<string, any> }>} */
    const byName = new Map(projects.filter((p) => p.manifest.name).map((p) => [p.manifest.name, p]));
    const names = checkOverrideSet({ overrides, declared, byName });
    const filters = names.flatMap((n) => ['--filter-prod', `${n}...`]);

    if (!external) {
      const rootName = projects[0].manifest.name;
      if (!rootName) throw new PinRefusal(`the objectstack root package.json at ${pin.slice(0, 12)} has no name to select it by.`);
      // The workspace root carries the build toolchain (tsup, tsx); the filters
      // carry the packages and their runtime closure.
      const treeEnv = objectstackEnv(env);
      step('install the build closure', () => run('pnpm', ['install', '--frozen-lockfile', '--filter', rootName, ...filters], { cwd: tree, env: treeEnv, logTo: path.join(scratch, 'install.log') }));
      step(`build ${names.join(', ')}`, () => run('pnpm', [...filters, 'run', 'build'], { cwd: tree, env: treeEnv, logTo: path.join(scratch, 'build.log') }));
    }

    const tarballs = path.join(scratch, 'tarballs');
    fs.mkdirSync(tarballs, { recursive: true });
    const packages = {};
    step(`pack ${names.length} package(s)`, () => {
      for (const name of names) {
        const dest = path.join(staging, overrides.get(name));
        const packed = packInto(path.join(tree, byName.get(name).dir), tarballs, dest, objectstackEnv(env));
        if (packed.name !== name) throw new PinRefusal(`packing ${byName.get(name).dir} produced ${packed.name}, not ${name}.`);
        const missing = missingEntryTargets(dest);
        if (missing.length) {
          throw new PinRefusal(
            `${name} is not built in ${tree}: its manifest points at ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not there.` +
              (external
                ? ` Build it in that tree first:\n    (cd ${tree} && env -u OS_SKIP_DTS pnpm ${filters.join(' ')} run build)` +
                  // Under OS_SKIP_DTS the packages build with no declarations and this refusal repeats.
                  (env.OS_SKIP_DTS ? `\n  OS_SKIP_DTS is set in this shell: the command above builds without it, so the declarations this check needs are emitted.` : '')
                : ''),
          );
        }
        packages[name] = packed.version;
      }
    });

    const before = materialize(root, overrides, { from: staging, mode, replaced });
    const stamp = external
      ? { recipe: RECIPE, source: 'external', root: external, ...describeTree(external), packages, contentHash: hashTree(staging), replaced: replaced ?? before }
      : { recipe: RECIPE, source: 'pin', sha: pin, packages };
    fs.writeFileSync(path.join(staging, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    if (entry) {
      try {
        const published = publishToStore(target, entry);
        console.log(`  ${entry}: ${published === 'published' ? 'published for every checkout on this machine' : 'another run published it first'}`);
      } catch (error) {
        console.warn(`⚠ objectstack-pin: could not publish the build to ${entry}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(
      `✓ ${CACHE_DIR} now holds ${names.join(', ')} ` +
        (external ? `from ${external} (${String(stamp.sha).slice(0, 12)}${stamp.dirty ? ', with uncommitted changes' : ''})` : `built at ${pin.slice(0, 12)}`) +
        `, linked into ${PIN_DIR}${external ? ' with its own manifests (the next build at the pin restores the committed ones)' : ''}. Run \`pnpm install\` so node_modules links it.`,
    );
    settle();
    return { skipped: false, reused: false, stamp };
  } finally {
    // Cleanup never speaks for the build: a removal that fails (a child process
    // still writing in the tree) is a warning, not an exception that would replace
    // the build's own outcome.
    for (const dir of [staging, scratch]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        console.warn(`⚠ objectstack-pin: could not remove ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

/**
 * @param {{ root?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {number} exit code
 */
export function status({ root = REPO_ROOT, env = process.env } = {}) {
  const pin = readPin(root);
  const overrides = readOverrides(readJson(path.join(root, 'package.json')));
  const stamp = readStamp(root);
  const verdict = judgeStamp(stamp, { pin, overrides, root });
  const hollow = hollowPackages(root, overrides);
  console.log(`pin    ${pin}  (${PIN_FILE})`);
  console.log(`cache  ${stamp ? `${stamp.source} ${stamp.sha}${stamp.root ? ` from ${stamp.root}` : ''}` : 'empty'}  (${CACHE_DIR})`);
  const entry = path.join(storeDir(env), storeKey(pin));
  console.log(`store  ${entry} ${fs.existsSync(entry) ? 'holds this pin and script' : 'is absent'}  (${STORE_ENV})`);
  console.log(`${verdict.current ? '✓' : '✗'} ${verdict.why}${verdict.current ? '' : ' -- run `pnpm run setup`'}`);
  if (hollow.length) console.log(`✗ ${PIN_DIR} holds no build for ${hollow.join(', ')} -- run \`pnpm run setup\``);
  return verdict.current && !hollow.length ? 0 : 1;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Where the pinned commit is checked out and built. SHORT on purpose: the spec's
 * build runs `tsx`, which listens on a unix socket under the package's
 * `node_modules/.tmp/`, and a socket path has a hard length limit (104 bytes on
 * macOS, 108 on Linux). Measured on objectui#12957: an install under a long
 * scratch directory died in the spec's `prepare` with `listen EADDRINUSE` on that
 * socket path. macOS's `os.tmpdir()` (`/var/folders/…/T/`) alone spends about half
 * the budget, so `/tmp` is preferred wherever it exists; `OBJECTSTACK_BUILD_TMP`
 * overrides both.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function scratchBase(env) {
  if (env.OBJECTSTACK_BUILD_TMP) return env.OBJECTSTACK_BUILD_TMP;
  if (process.platform !== 'win32' && fs.existsSync('/tmp')) return '/tmp';
  return os.tmpdir();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeReaddir(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (isEntrypoint(import.meta.url)) {
  const [command, ...flags] = process.argv.slice(2);
  try {
    if (command === 'build' && flags.every((f) => f === '--write-manifests')) {
      build({ writeManifests: flags.length > 0 });
      process.exit(0);
    } else if (command === 'status' && !flags.length) {
      process.exit(status());
    } else if (command === 'check' && !flags.length) {
      check();
      process.exit(0);
    } else {
      console.error('usage: node scripts/objectstack-pin.mjs build [--write-manifests] | status | check');
      process.exit(2);
    }
  } catch (error) {
    // Every failure, a refusal or a crash, is said once on stderr and -- under
    // GitHub Actions -- once as an annotation, written synchronously before exit.
    const message =
      error instanceof PinRefusal
        ? error.message
        : `crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    fs.writeSync(2, `✗ objectstack-pin: ${message}\n`);
    if (process.env.GITHUB_ACTIONS === 'true') fs.writeSync(2, `${annotation(message)}\n`);
    process.exit(1);
  }
}
