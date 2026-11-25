#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * released-keys-removed.mjs — every translation key a released `@object-ui/i18n`
 * shipped that a later tree no longer carries.
 *
 * Usage (from anywhere inside the repository):
 *
 *   node ui/packages/i18n/scripts/released-keys-removed.mjs \
 *     [--tag @object-ui/i18n@18.6.0] [--ref origin/main] [--json]
 *
 * It reads the package's catalogue sources out of git at BOTH refs (never the
 * working tree), so it answers the same on any checkout. Zero third-party
 * dependencies: git for the blobs, Node's own type stripping to evaluate the
 * catalogue modules (they import nothing, so each one evaluates alone).
 *
 * ## Which files are the published catalogues — read from the package, not listed here
 *
 *   - `package.json` `exports`: every `./namespaces/NAME` subpath is a published
 *     namespace; `./locales` is the all-packs door.
 *   - `src/locales/index.ts` (the all-packs door): each DEFAULT import of a
 *     `./TAG.js` module is a language pack, and each default import of a
 *     `../namespaces/NAME/TAG.js` module is that language's catalogue in a
 *     pack-shaped namespace. The door deep-merges them into one catalogue per
 *     language, and at runtime they all land in i18next's default
 *     `translation` namespace, so they are ONE key space: a key that moved
 *     from a pack into a pack-shaped namespace (or back) is not removed.
 *   - Every other exported namespace (one whose `index.ts` does not build on
 *     `../packNamespace.js`, today `studio`) is a key space of its own; its
 *     catalogues are the `./TAG.js` modules its `index.ts` imports, statically
 *     or through a literal `import()` loader.
 *
 * A key is the dotted path to a leaf value (strings, plus any non-object
 * value, arrays included), so plural forms (`KEY_one`, `KEY_other`, …) are
 * separate keys. A key counts as removed in a language when that language's
 * catalogue at the tag has it and the same key space at the ref does not.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`released-keys-removed: ${name} needs a value`);
    process.exit(2);
  }
  return v;
};
const TAG = opt('--tag', '@object-ui/i18n@18.6.0');
const REF = opt('--ref', 'origin/main');
const AS_JSON = args.includes('--json');

const here = dirname(fileURLToPath(import.meta.url));
const git = (...a) => execFileSync('git', a, { cwd: here, encoding: 'utf8', maxBuffer: 1 << 28 });
const ROOT = git('rev-parse', '--show-toplevel').trim();
const PKG = relative(ROOT, dirname(here)).split('\\').join('/'); // ui/packages/i18n

const show = (ref, path) => git('show', `${ref}:${PKG}/${path}`);
const exists = (ref, path) => {
  try {
    git('cat-file', '-e', `${ref}:${PKG}/${path}`);
    return true;
  } catch {
    return false;
  }
};

for (const ref of [TAG, REF]) {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    console.error(`released-keys-removed: ref '${ref}' does not resolve (fetch it first)`);
    process.exit(2);
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'released-keys-removed-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;

/** Evaluate one catalogue module's default export from its source at `ref`. */
async function loadCatalogue(ref, path) {
  const dir = join(tmp, String(seq++));
  mkdirSync(dir);
  const file = join(dir, posix.basename(path));
  writeFileSync(file, show(ref, path));
  const mod = await import(pathToFileURL(file).href);
  if (!mod.default || typeof mod.default !== 'object') {
    throw new Error(`${ref}:${PKG}/${path} has no object default export`);
  }
  return mod.default;
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlain(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

/** `./x.js` / `../a/b.js` specifiers of default imports and literal `import()` calls. */
function defaultImports(src) {
  return [...src.matchAll(/^\s*import\s+[A-Za-z_$][\w$]*\s+from\s+'([^']+)'/gm)].map((m) => m[1]);
}
function dynamicImports(src) {
  return [...src.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
}
const tagOf = (spec) => posix.basename(spec).replace(/\.js$/, '');
const toSrc = (fromDir, spec) => posix.normalize(posix.join(fromDir, spec)).replace(/\.js$/, '.ts');

/**
 * The catalogues one ref publishes:
 * Map<space, Map<lang, Array<{ module, path }>>>, where `module` names the
 * published group the file belongs to (`locales`, or the namespace name).
 */
function discover(ref) {
  const pkg = JSON.parse(show(ref, 'package.json'));
  const exp = Object.keys(pkg.exports ?? {});
  if (!exp.includes('./locales')) throw new Error(`${ref}: package.json exports no ./locales`);
  const namespaces = exp
    .filter((k) => k.startsWith('./namespaces/'))
    .map((k) => k.slice('./namespaces/'.length));

  const spaces = new Map();
  const add = (space, lang, module, path) => {
    if (!spaces.has(space)) spaces.set(space, new Map());
    const langs = spaces.get(space);
    if (!langs.has(lang)) langs.set(lang, []);
    langs.get(lang).push({ module, path });
  };

  // The all-packs door: packs + pack-shaped namespaces, one `translation` space.
  const door = show(ref, 'src/locales/index.ts');
  const packShaped = new Set();
  for (const spec of defaultImports(door)) {
    if (!spec.startsWith('.')) continue;
    const path = toSrc('src/locales', spec);
    const m = /^src\/namespaces\/([^/]+)\/[^/]+\.ts$/.exec(path);
    if (m) {
      packShaped.add(m[1]);
      add('translation', tagOf(spec), m[1], path);
    } else if (/^src\/locales\/[^/]+\.ts$/.test(path)) {
      add('translation', tagOf(spec), 'locales', path);
    }
  }

  // Every exported namespace's own catalogue modules.
  for (const ns of namespaces) {
    const index = `src/namespaces/${ns}/index.ts`;
    if (!exists(ref, index)) throw new Error(`${ref}: export ./namespaces/${ns} has no ${index}`);
    const src = show(ref, index);
    const isPackShaped = /from '\.\.\/packNamespace\.js'/.test(src);
    const specs = [...defaultImports(src), ...dynamicImports(src)].filter((s) => /^\.\/[^/]+\.js$/.test(s));
    for (const spec of new Set(specs)) {
      const path = toSrc(`src/namespaces/${ns}`, spec);
      if (isPackShaped) {
        // Already in the door; a catalogue the door does not merge would be a
        // published file outside every key space this script knows: refuse.
        const listed = spaces.get('translation')?.get(tagOf(spec))?.some((e) => e.path === path);
        if (!listed) throw new Error(`${ref}: ${path} is loaded by ${index} but not merged by src/locales/index.ts`);
      } else {
        add(ns, tagOf(spec), ns, path);
      }
    }
  }
  return spaces;
}

/** Map<space, Map<lang, Map<key, module>>> for one ref. */
async function keysAt(ref) {
  const out = new Map();
  for (const [space, langs] of discover(ref)) {
    const perLang = new Map();
    for (const [lang, entries] of langs) {
      const keys = new Map();
      for (const { module, path } of entries) {
        for (const k of flatten(await loadCatalogue(ref, path))) keys.set(k, module);
      }
      perLang.set(lang, keys);
    }
    out.set(space, perLang);
  }
  return out;
}

const before = await keysAt(TAG);
const after = await keysAt(REF);

// removed: Map<groupName, Map<key, Set<lang>>>; group = space, or the module a
// `translation` key lived in at the tag.
const removed = new Map();
let moved = 0;
for (const [space, langs] of before) {
  for (const [lang, keys] of langs) {
    const now = after.get(space)?.get(lang) ?? new Map();
    for (const [key, module] of keys) {
      if (now.has(key)) {
        if (now.get(key) !== module) moved++;
        continue;
      }
      const group = space === 'translation' ? module : space;
      if (!removed.has(group)) removed.set(group, new Map());
      const g = removed.get(group);
      if (!g.has(key)) g.set(key, new Set());
      g.get(key).add(lang);
    }
  }
}

const tagLangs = (space) => [...(before.get(space)?.keys() ?? [])];
const total = [...removed.values()].reduce((n, g) => n + g.size, 0);
const groups = [...removed.keys()].sort();

if (AS_JSON) {
  const body = {
    tag: TAG,
    ref: REF,
    refSha: git('rev-parse', REF).trim(),
    total,
    movedBetweenModules: moved,
    groups: Object.fromEntries(
      groups.map((g) => [
        g,
        Object.fromEntries([...removed.get(g)].sort(([a], [b]) => a.localeCompare(b)).map(([k, l]) => [k, [...l].sort()])),
      ]),
    ),
  };
  console.log(JSON.stringify(body, null, 2));
} else {
  console.log(`Keys in ${TAG} absent at ${REF} (${git('rev-parse', '--short', REF).trim()}): ${total}`);
  for (const g of groups) {
    const space = before.has(g) ? g : 'translation';
    const all = tagLangs(space);
    console.log(`\n## ${g} (${removed.get(g).size})`);
    for (const [key, langs] of [...removed.get(g)].sort(([a], [b]) => a.localeCompare(b))) {
      const l = [...langs].sort();
      const which = l.length === all.length ? `all ${all.length} locales (${l.join(', ')})` : l.join(', ');
      console.log(`- ${key} — ${which}`);
    }
  }
  if (moved) console.log(`\n(${moved} key×locale rows moved between modules inside one key space; not removals)`);
}
