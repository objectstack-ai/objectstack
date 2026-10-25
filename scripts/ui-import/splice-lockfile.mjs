#!/usr/bin/env node
// splice-lockfile — carries an imported workspace's own lockfile resolutions into
// this repository's single pnpm-lock.yaml, so that importing a tree (objectui under
// `ui/`) is dependency-neutral: every imported importer keeps the versions its own
// lockfile resolved, instead of whatever a fresh `pnpm install` would pick today.
//
// Usage:
//   node scripts/ui-import/splice-lockfile.mjs \
//     --base pnpm-lock.yaml --import <objectui pnpm-lock.yaml> --prefix ui --out pnpm-lock.yaml
//   [--root <repo root>]   where the importers' package.json files live (default: this repo)
//   node scripts/ui-import/splice-lockfile.mjs --measure pnpm-lock.yaml --import <objectui lock> --prefix ui
//     writes nothing; prints the moved-row count of an existing (e.g. reconciled) lockfile
//
// What the output holds:
//   - every importer of --import, re-keyed under --prefix (`.` becomes `ui`,
//     `packages/x` becomes `ui/packages/x`), with the specifier and resolved version
//     its own lockfile recorded;
//   - except a dependency on a package of THIS workspace (any `@objectstack/*` the
//     base importers provide): it becomes the workspace link the adapted manifest
//     asks for (`link:../../../packages/<name>`, specifier read from the manifest);
//   - `snapshots:` and `packages:` entries for everything reachable from the base's
//     own importers and from the re-keyed importers. An entry both lockfiles hold
//     under the same key is taken from --base, so the base graph stays byte-stable;
//   - every importer of --base outside --prefix, unchanged (asserted before writing),
//     plus the base's `settings`, `overrides` and `patchedDependencies`.
//
// The output is written in pnpm's own lockfile layout (codepoint-sorted keys, blank
// lines between entries, flow style for resolution/engines/cpu/os/libc); the run
// first proves the writer reproduces --base byte for byte and refuses if it does not.
// The splice is textual: run `pnpm install --lockfile-only` afterwards so pnpm
// reconciles what only it can decide (root overrides and patches that apply to the
// imported subgraph, peer suffixes); the procedure lives in this directory's README.
//
// It ends by printing the moved-row count: importer x dependency rows whose resolved
// version (peer suffix ignored) differs between --import and --out. 0 is the pass;
// `--measure` re-counts a lockfile pnpm has reconciled since.
//
// Exit codes: 0 written, 1 refused (invariant broken), 2 usage error.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual } from 'node:util';

const require = createRequire(import.meta.url);
const YAML = require('yaml'); // root devDependency; no new dependency

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const SPACED_SECTIONS = new Set(['importers', 'packages', 'snapshots']);
const FLOW_PACKAGE_FIELDS = new Set(['resolution', 'engines', 'cpu', 'os', 'libc']);

function fail(code, msg) {
  console.error(`splice-lockfile: ${msg}`);
  process.exit(code);
}

// ---------- pnpm lockfile layout ----------

const codepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sortedObject(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort(codepoint)) out[k] = obj[k];
  return out;
}

function renderEntry(key, value, section) {
  const doc = new YAML.Document({ [key]: value });
  if (section === 'packages' && value && typeof value === 'object') {
    for (const field of FLOW_PACKAGE_FIELDS) {
      const node = doc.getIn([key, field], true);
      if (node && typeof node === 'object' && 'items' in node) node.flow = true;
    }
  }
  const text = doc.toString({ singleQuote: true, lineWidth: 0, flowCollectionPadding: false });
  return text.replace(/^(?=.)/gm, '  ');
}

function renderLockfile(lock) {
  const parts = [];
  for (const [key, value] of Object.entries(lock)) {
    if (value === null || typeof value !== 'object') {
      parts.push(YAML.stringify({ [key]: value }, { singleQuote: true, lineWidth: 0 }));
      continue;
    }
    const spaced = SPACED_SECTIONS.has(key);
    const entries = Object.entries(value).map(([k, v]) => renderEntry(k, v, key));
    parts.push(`${key}:\n${spaced ? '\n' : ''}${entries.join(spaced ? '\n' : '')}`);
  }
  return parts.join('\n');
}

// ---------- dependency paths (mirrors @pnpm/dependency-path refToRelative) ----------

function refToKey(name, ref) {
  if (typeof ref !== 'string' || ref.startsWith('link:')) return null;
  if (ref.startsWith('@')) return ref;
  const at = ref.indexOf('@');
  if (at === -1) return `${name}@${ref}`;
  const colon = ref.indexOf(':');
  const paren = ref.indexOf('(');
  if ((colon === -1 || at < colon) && (paren === -1 || at < paren)) return ref; // npm alias
  return `${name}@${ref}`;
}

function packageKey(snapshotKey) {
  // `name@version(peer@x)(patch_hash=y)` -> `name@version`; a scoped name starts with '@'.
  const paren = snapshotKey.indexOf('(', 1);
  return paren === -1 ? snapshotKey : snapshotKey.slice(0, paren);
}

const versionOf = (info) => (info && typeof info === 'object' ? info.version : info);

// ---------- the splice ----------

function importerKeyFor(prefix, imp) {
  return imp === '.' ? prefix : `${prefix}/${imp}`;
}

function inPrefix(prefix, key) {
  return key === prefix || key.startsWith(`${prefix}/`);
}

function readManifest(root, importerKey) {
  const file = path.join(root, importerKey, 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function splice({ base, imported, prefix, root }) {
  const notes = [];
  const out = {};
  for (const k of Object.keys(base)) out[k] = base[k];

  // Workspace packages the base provides, by name -> importer dir.
  const workspace = new Map();
  for (const key of Object.keys(base.importers)) {
    if (inPrefix(prefix, key)) continue;
    const manifest = readManifest(root, key);
    if (manifest?.name) workspace.set(manifest.name, key);
  }

  const importers = {};
  for (const [key, entry] of Object.entries(base.importers)) {
    if (!inPrefix(prefix, key)) importers[key] = entry;
  }
  for (const [imp, entry] of Object.entries(imported.importers)) {
    const key = importerKeyFor(prefix, imp);
    const manifest = readManifest(root, key);
    if (!manifest) fail(1, `no package.json for imported importer ${key} under ${root}`);
    const next = structuredClone(entry);
    for (const sect of DEP_SECTIONS) {
      for (const [name, info] of Object.entries(next[sect] ?? {})) {
        if (workspace.has(name)) {
          // Re-placed below: the adapted manifest decides the section and specifier.
          delete next[sect][name];
          continue;
        }
        const wanted = manifest[sect]?.[name];
        const declared = [...DEP_SECTIONS, 'peerDependencies'].some((s) => manifest[s]?.[name] !== undefined);
        if (!declared) {
          notes.push(`${key} ${name}: in the imported lock but not in package.json (pnpm reconciles)`);
        } else if (wanted !== undefined && wanted !== info.specifier) {
          notes.push(`${key} ${name}: package.json asks ${wanted}, the imported lock recorded ${info.specifier} (pnpm reconciles)`);
        }
      }
    }
    for (const [name, dir] of workspace) {
      // pnpm's precedence: optionalDependencies, then dependencies, then devDependencies;
      // a peer-only dependency is auto-installed into dependencies (autoInstallPeers).
      const sect = ['optionalDependencies', 'dependencies', 'devDependencies'].find((s) => manifest[s]?.[name] !== undefined)
        ?? (manifest.peerDependencies?.[name] !== undefined ? 'dependencies' : null);
      if (!sect) continue;
      const specifier = manifest[sect]?.[name] ?? manifest.peerDependencies[name];
      const rel = path.relative(key, dir).split(path.sep).join('/');
      next[sect] = sortedObject({ ...(next[sect] ?? {}), [name]: { specifier, version: `link:${rel}` } });
      const prior = base.importers[key]?.[sect]?.[name];
      if (prior && !isDeepStrictEqual(prior, next[sect][name])) {
        notes.push(`${key} ${name}: base lock had ${JSON.stringify(prior)}, writing ${JSON.stringify(next[sect][name])}`);
      }
    }
    for (const sect of DEP_SECTIONS) {
      if (next[sect] && Object.keys(next[sect]).length === 0) delete next[sect];
      for (const name of Object.keys(manifest[sect] ?? {})) {
        if (!workspace.has(name) && !DEP_SECTIONS.some((s) => next[s]?.[name])) {
          notes.push(`${key} ${name}: in package.json ${sect} but not in the imported lock (pnpm reconciles)`);
        }
      }
    }
    importers[key] = next;
  }
  out.importers = sortedObject(importers);

  // Reachability over the union graph: a key both locks hold resolves to the base entry.
  const snapshots = {};
  const packages = {};
  let sharedDiffering = 0;
  const pending = [];
  const visit = (name, ref, from) => {
    const k = refToKey(name, ref);
    if (k === null || k in snapshots) return;
    if (k.includes('.objectstack-pin')) fail(1, `${from} still reaches the pin entry ${k}`);
    const own = base.snapshots?.[k];
    const theirs = imported.snapshots?.[k];
    if (own === undefined && theirs === undefined) fail(1, `${from} needs ${k}, which neither lockfile holds`);
    if (own !== undefined && theirs !== undefined && !isDeepStrictEqual(own, theirs)) sharedDiffering++;
    snapshots[k] = own ?? theirs;
    const pk = packageKey(k);
    const ownPkg = base.packages?.[pk];
    const theirPkg = imported.packages?.[pk];
    if (ownPkg && theirPkg && !isDeepStrictEqual(ownPkg.resolution, theirPkg.resolution)) {
      fail(1, `${pk} resolves differently in the two lockfiles (${JSON.stringify(ownPkg.resolution)} vs ${JSON.stringify(theirPkg.resolution)})`);
    }
    if (!ownPkg && !theirPkg) fail(1, `${pk} has a snapshot but no packages entry in either lockfile`);
    packages[pk] = ownPkg ?? theirPkg;
    pending.push(k);
  };
  for (const [key, entry] of Object.entries(out.importers)) {
    for (const sect of DEP_SECTIONS) {
      for (const [name, info] of Object.entries(entry[sect] ?? {})) visit(name, versionOf(info), key);
    }
  }
  while (pending.length) {
    const k = pending.pop();
    const snap = snapshots[k];
    for (const sect of ['dependencies', 'optionalDependencies']) {
      for (const [name, ref] of Object.entries(snap[sect] ?? {})) visit(name, ref, k);
    }
  }
  out.packages = sortedObject(packages);
  out.snapshots = sortedObject(snapshots);

  // Invariant: the base's own importers are untouched.
  for (const [key, entry] of Object.entries(base.importers)) {
    if (inPrefix(prefix, key)) continue;
    if (!isDeepStrictEqual(out.importers[key], entry)) fail(1, `base importer ${key} changed`);
  }
  const baseOnly = Object.keys(out.importers).filter((k) => !inPrefix(prefix, k)).length;
  if (baseOnly !== Object.keys(base.importers).filter((k) => !inPrefix(prefix, k)).length) {
    fail(1, 'the set of base importers changed');
  }

  for (const [name, patch] of Object.entries(imported.patchedDependencies ?? {})) {
    const covered = Object.values(base.patchedDependencies ?? {}).some((p) => p.hash === patch.hash);
    if (!covered) notes.push(`patch ${name} (${patch.path}) is not in the base patchedDependencies: add it to the root pnpm-workspace.yaml before reconciling`);
  }
  return { out, notes, sharedDiffering };
}

// ---------- the moved-row measurement ----------

function movedRows(imported, merged, prefix) {
  const moved = [];
  let same = 0;
  for (const [imp, spec] of Object.entries(imported.importers)) {
    const target = merged.importers[importerKeyFor(prefix, imp)];
    if (!target) continue;
    for (const sect of DEP_SECTIONS) {
      for (const [name, info] of Object.entries(spec[sect] ?? {})) {
        const va = versionOf(info);
        const vb = versionOf(target[sect]?.[name]);
        if (vb == null || va.startsWith('link:') || va.startsWith('file:')) continue;
        const a = packageKey(`x@${va}`).slice(2);
        const b = packageKey(`x@${vb}`).slice(2);
        if (a !== b) moved.push(`${importerKeyFor(prefix, imp)} ${name} ${a} -> ${b}`);
        else same++;
      }
    }
  }
  return { moved, same };
}

// ---------- main ----------

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    import: { type: 'string' },
    prefix: { type: 'string', default: 'ui' },
    out: { type: 'string' },
    root: { type: 'string', default: REPO_ROOT },
    measure: { type: 'string' },
  },
});
const prefix = values.prefix.replace(/\/+$/, '');
function report(imported, merged) {
  const { moved, same } = movedRows(imported, merged, prefix);
  for (const m of moved) console.log(`moved: ${m}`);
  console.log(`moved ${moved.length} same ${same}`);
}
if (values.measure && values.import) {
  report(YAML.parse(readFileSync(values.import, 'utf8')), YAML.parse(readFileSync(values.measure, 'utf8')));
  process.exit(0);
}
if (!values.base || !values.import || !values.out) {
  fail(2, 'usage: --base <lock> --import <lock> --prefix <dir> --out <path> [--root <repo root>] | --measure <lock> --import <lock> --prefix <dir>');
}
const baseText = readFileSync(values.base, 'utf8');
const base = YAML.parse(baseText);
const imported = YAML.parse(readFileSync(values.import, 'utf8'));
for (const [label, lock] of [['--base', base], ['--import', imported]]) {
  if (lock?.lockfileVersion !== '9.0') fail(1, `${label} is lockfileVersion ${lock?.lockfileVersion}, expected 9.0`);
}
if (renderLockfile(base) !== baseText) {
  fail(1, '--base does not round-trip through this writer byte for byte; the pnpm layout changed, update renderLockfile');
}

const { out, notes, sharedDiffering } = splice({ base, imported, prefix, root: path.resolve(values.root) });
writeFileSync(values.out, renderLockfile(out));

for (const n of notes) console.log(`note: ${n}`);
const uiImporters = Object.keys(out.importers).filter((k) => inPrefix(prefix, k)).length;
console.log(
  `wrote ${values.out}: ${Object.keys(out.importers).length} importers (${uiImporters} under ${prefix}/), ` +
    `${Object.keys(out.packages).length} packages, ${Object.keys(out.snapshots).length} snapshots; ` +
    `${sharedDiffering} shared snapshot keys taken from --base where the two locks differ`,
);
report(imported, out);
