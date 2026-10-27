// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two unread dependency spellings RETIRED (#25792 item 6) — ADR-0141 D8
 * items 2 and 3, ADR-0049 enforce-or-remove.
 *
 * ADR-0141 D2 judges one declaration, the manifest record
 * `ManifestSchema.dependencies` (`{ [packageId]: versionRange }`), and treats
 * every entry as required. Two more spellings stayed declared beside it:
 *
 *   - `PackageDependency.optional` — the marketplace snapshot entry's
 *     "missing dep is a warning, not an error" flag. The record has no optional
 *     arm, no snapshot writer produces the array, and no install path honoured
 *     it (D8 item 2).
 *   - `AppManifest.dependencies` — a list of bare ids, no range, "other apps
 *     that must be installed first". No install path consulted it (D8 item 3).
 *
 * Measured at `origin/main` `6390fe52ce` (recorded in ADR-0141 §D8's addendum):
 * zero readers and zero writers of either key outside `packages/spec` —
 * `packages/`, `ui/`, `examples/`, `apps/`, and HotCRM at `9464673` (which
 * declares its three module dependencies in the record, the live control).
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on each key, so each refusal carries its
 *      prescription and each key's input type is the retired mark for `tsc`.
 *   2. NO D2 conversion: neither shape is a stack collection member, so a
 *      conversion would be a transform with no seam that ever runs (the
 *      `kernel/Manifest:capabilities` precedent).
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries both keys, and the family's D3 entry
 *      is `dependency-unread-spellings-retired`.
 *   4. The residue stage (`acceptRetiredDefaultResidue`) is NOT adopted: both
 *      keys carried a default, but no producer in this repository or HotCRM ever
 *      parsed either schema to emit one, so there is no emitted population.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — neither shape has an
 * authoring door of its own. Asserted: refusal, the issue `code`, the `path`
 * naming the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { AppManifestSchema, type AppManifest } from '../system/app-install.zod';
import {
  PackageDependencySchema,
  PackageManifestSchema,
  type PackageDependency,
} from './package-version.zod';

const D3_ID = 'dependency-unread-spellings-retired';

const OPTIONAL_PRESCRIPTION =
  /`PackageDependency\.optional` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove, ADR-0141 D8\) — no install path ever honoured it.*Delete the key\..*`manifest\.dependencies`/s;
const APP_DEPENDENCIES_PRESCRIPTION =
  /`AppManifest\.dependencies` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove, ADR-0141 D8\) — nothing read it.*Delete the key\..*`manifest\.dependencies`/s;

const DEPENDENCY = { packageId: 'com.acme.core', versionRange: '^1.0.0' } as const;
const APP = { name: 'project_management', label: 'Project Management', version: '1.0.0' } as const;
const SNAPSHOT = { id: 'com.acme.psa', version: '1.0.0', name: 'PSA' } as const;

describe('PackageDependency.optional retirement — the tombstone', () => {
  it('the entry schema refuses `optional` at its path, with the prescription', () => {
    const r = PackageDependencySchema.safeParse({ ...DEPENDENCY, optional: true });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['optional']);
    expect(issue.message).toMatch(OPTIONAL_PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue.message.startsWith('`PackageDependency.optional` was removed')).toBe(true);
  });

  it('refuses EVERY value — `true`, its old DEFAULT `false`, and a value of another type', () => {
    for (const value of [true, false, 'yes', 0, null, {}]) {
      const r = PackageDependencySchema.safeParse({ ...DEPENDENCY, optional: value });
      expect(r.success, JSON.stringify(value)).toBe(false);
      if (r.success) continue;
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]!.path).toEqual(['optional']);
      expect(r.error.issues[0]!.message).toMatch(OPTIONAL_PRESCRIPTION);
    }
  });

  it('the snapshot schema refuses it inside `dependencies[]`, at the entry\'s path', () => {
    const r = PackageManifestSchema.safeParse({ ...SNAPSHOT, dependencies: [DEPENDENCY, { ...DEPENDENCY, optional: false }] });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path)).toEqual([['dependencies', 1, 'optional']]);
    expect(r.error.issues[0]!.message).toMatch(OPTIONAL_PRESCRIPTION);
  });

  it('CONTROL: an entry without the key passes and grows no `optional`', () => {
    const r = PackageDependencySchema.safeParse(DEPENDENCY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Absence stays absence: a tombstone materializes nothing.
    expect(r.data).not.toHaveProperty('optional');
    expect(r.data).toEqual(DEPENDENCY);
    const snapshot = PackageManifestSchema.parse({ ...SNAPSHOT, dependencies: [DEPENDENCY] });
    expect(snapshot.dependencies).toEqual([DEPENDENCY]);
  });

  it('fails tsc at the authoring site: the input type of the key is the retired mark', () => {
    const entry: PackageDependency = {
      ...DEPENDENCY,
      // @ts-expect-error — `optional` is a retiredKey() tombstone: no value is assignable.
      optional: true,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => PackageDependencySchema.parse(entry)).toThrow(OPTIONAL_PRESCRIPTION);
  });
});

describe('AppManifest.dependencies retirement — the tombstone', () => {
  it('the schema refuses `dependencies` at its path, with the prescription', () => {
    const r = AppManifestSchema.safeParse({ ...APP, dependencies: ['core_crm'] });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['dependencies']);
    expect(issue.message).toMatch(APP_DEPENDENCIES_PRESCRIPTION);
    expect(issue.message.startsWith('`AppManifest.dependencies` was removed')).toBe(true);
  });

  it('refuses EVERY value — a list, its old DEFAULT `[]`, and the record spelling it points to', () => {
    // The record spelling belongs in `manifest.dependencies`, not here: an app
    // manifest that writes it is still refused, never silently re-read.
    for (const value of [['core_crm'], [], { 'com.acme.core': '^1.0.0' }, 'core_crm', null]) {
      const r = AppManifestSchema.safeParse({ ...APP, dependencies: value });
      expect(r.success, JSON.stringify(value)).toBe(false);
      if (r.success) continue;
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]!.path).toEqual(['dependencies']);
      expect(r.error.issues[0]!.message).toMatch(APP_DEPENDENCIES_PRESCRIPTION);
    }
  });

  it('CONTROL: the same manifest without the key passes, every live default intact, and grows no `dependencies`', () => {
    const r = AppManifestSchema.safeParse(APP);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty('dependencies');
    // The live defaults still apply, so the empty reading above is the
    // retirement and not a schema that stopped emitting.
    expect(r.data.objects).toEqual([]);
    expect(r.data.hasSeedData).toBe(false);
  });

  it('fails tsc at the authoring site: the input type of the key is the retired mark', () => {
    const manifest: AppManifest = {
      ...APP,
      // @ts-expect-error — `dependencies` is a retiredKey() tombstone: no value is assignable.
      dependencies: ['core_crm'],
    };
    expect(() => AppManifestSchema.parse(manifest)).toThrow(APP_DEPENDENCIES_PRESCRIPTION);
  });
});

describe('dependency spellings retirement — ADR-0087 registration', () => {
  it('declares both keys under major 18', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(expect.arrayContaining([
      'marketplace/PackageDependency:optional',
      'system/AppManifest:dependencies',
    ]));
  });

  it('carries no D2 conversion — neither shape is a stack collection member', () => {
    const touching = ALL_CONVERSIONS.filter((c) => /PackageDependency|AppManifest|dependencies\[\]\.optional/.test(c.surface));
    expect(touching.map((c) => c.id)).toEqual([]);
  });

  it('carries ONE D3 entry for the family, pointing at the record', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.replacement).toContain('`manifest.dependencies`');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types both keys as the retired
// mark, so every TYPED authoring site fails to compile. The residue is what
// `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped `.js`, and TS
// literals typed `any` / `unknown` / a record. This walk covers that residue
// across the five repo roots `scripts/cross-package-test-inputs.mjs` already
// declares for `@objectstack/spec#test`, plus the example apps' own `src/`
// trees, declared there as `examples/*/src/**/*.ts`.
//
// The matcher judges the AUTHORING SHAPE, never a mention. `optional` and
// `dependencies` are among the commonest keys in the tree (a plugin
// dependency's `optional`, a kernel plugin's `dependencies`, the manifest
// record itself), so a key alone proves nothing. An offence is the retired key
// at the TOP LEVEL of an object literal that also carries its shape's anchor:
// `optional` beside `versionRange` (no other dependency shape spells its range
// that way), and `dependencies` beside `minKernelVersion` or `hasSeedData` (keys
// no other metadata shape declares). In code, string and comment contents are
// masked first (a quoted key is kept, for JSON); in YAML, the sibling keys of a
// mapping that holds an anchor; in MD/MDX, each fenced block by its language.
// The bound, stated: an entry assembled by spread, under computed keys, or with
// its anchor in a different literal, and `docs/**`, `.claude/**`, `.github/**`
// and the repo-root files are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors either retired dependency spelling', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** One retired spelling: the anchor keys that identify its shape, and the retired key. */
  interface Spelling { readonly name: string; readonly anchors: readonly string[]; readonly retired: string }
  const SPELLINGS: readonly Spelling[] = [
    { name: 'PackageDependency.optional', anchors: ['versionRange'], retired: 'optional' },
    { name: 'AppManifest.dependencies', anchors: ['minKernelVersion', 'hasSeedData'], retired: 'dependencies' },
  ];
  const ANCHOR_WORDS = SPELLINGS.flatMap((s) => s.anchors);

  /** `key` in key position — never a tombstone declaration. */
  const keyPattern = (key: string) => new RegExp(`(^|[\\s{,])["']?${key}["']?\\s*:(?!\\s*retiredKey\\()`, 'g');

  /**
   * Code with string and comment CONTENTS blanked (same length, so offsets
   * hold). A quoted string followed by `:` is a key and is kept — that is how
   * JSON and quoted TS keys stay visible. A template literal is blanked whole,
   * its `${…}` interpolations included: an entry is never authored inside one.
   */
  const maskCode = (src: string): string => {
    const out = src.split('');
    const blank = (from: number, to: number) => {
      for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
    };
    let i = 0;
    while (i < src.length) {
      const c = src[i]!;
      const next = src[i + 1];
      if (c === '/' && next === '/') {
        const end = src.indexOf('\n', i);
        const stop = end === -1 ? src.length : end;
        blank(i, stop);
        i = stop;
      } else if (c === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end === -1 ? src.length : end + 2;
        blank(i, stop);
        i = stop;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        const close = Math.min(j, src.length - 1);
        const isKey = /^\s*:/.test(src.slice(close + 1, close + 40));
        if (!isKey) blank(i + 1, close);
        i = close + 1;
      } else if (c === '`') {
        let j = i + 1;
        let depth = 0;
        while (j < src.length) {
          const d = src[j]!;
          if (d === '\\') { j += 2; continue; }
          if (depth === 0 && d === '`') break;
          if (d === '$' && src[j + 1] === '{') { depth += 1; j += 2; continue; }
          if (depth > 0 && (d === '"' || d === "'")) {
            let q = j + 1;
            while (q < src.length && src[q] !== d && src[q] !== '\n') q += src[q] === '\\' ? 2 : 1;
            j = q + 1;
            continue;
          }
          if (depth > 0 && d === '{') depth += 1;
          else if (depth > 0 && d === '}') depth -= 1;
          j += 1;
        }
        blank(i + 1, Math.min(j, src.length));
        i = j + 1;
      } else {
        i += 1;
      }
    }
    return out.join('');
  };

  /** The `{ … }` span enclosing `at` in masked code, or null. */
  const enclosingObject = (code: string, at: number): [number, number] | null => {
    let depth = 0;
    let start = -1;
    for (let k = at - 1; k >= 0; k -= 1) {
      const c = code[k];
      if (c === '}') depth += 1;
      else if (c === '{') {
        if (depth === 0) { start = k; break; }
        depth -= 1;
      }
    }
    if (start === -1) return null;
    depth = 0;
    for (let k = start; k < code.length; k += 1) {
      const c = code[k];
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) return [start, k];
      }
    }
    return null;
  };

  /** Nesting depth of `{[(` between `from` (exclusive) and `to`. */
  const depthBetween = (code: string, from: number, to: number): number => {
    let depth = 0;
    for (let k = from + 1; k < to; k += 1) {
      const c = code[k];
      if (c === '{' || c === '[' || c === '(') depth += 1;
      else if (c === '}' || c === ']' || c === ')') depth -= 1;
    }
    return depth;
  };

  const judgeCode = (src: string): string | null => {
    const code = maskCode(src);
    for (const spelling of SPELLINGS) {
      for (const anchor of spelling.anchors) {
        for (const m of code.matchAll(keyPattern(anchor))) {
          const span = enclosingObject(code, m.index! + m[1]!.length);
          if (!span) continue;
          const body = code.slice(span[0], span[1] + 1);
          for (const k of body.matchAll(keyPattern(spelling.retired))) {
            const keyAt = span[0] + k.index! + k[1]!.length;
            if (depthBetween(code, span[0], keyAt) === 0) return `${spelling.name} (beside ${anchor})`;
          }
        }
      }
    }
    return null;
  };

  /** A YAML mapping that holds an anchor and, at the same indentation, its retired key. */
  const judgeYaml = (src: string): string | null => {
    const lines = src.split(/\r?\n/);
    const keyOf = (line: string) => /^([ \t]*(?:-[ \t]+)?)([A-Za-z_][\w]*)[ \t]*:/.exec(line);
    const ownIndent = (line: string) => /^[ \t]*/.exec(line)![0].length;
    for (let n = 0; n < lines.length; n += 1) {
      const m = keyOf(lines[n]!);
      if (!m) continue;
      const spelling = SPELLINGS.find((s) => s.anchors.includes(m[2]!));
      if (!spelling) continue;
      const indent = m[1]!.length;
      for (const step of [-1, 1]) {
        for (let k = n + step; k >= 0 && k < lines.length; k += step) {
          const line = lines[k]!;
          if (line.trim() === '') continue;
          const s = keyOf(line);
          if (s && s[1]!.length === indent && s[2] === spelling.retired) return `${spelling.name} (beside ${m[2]})`;
          // A list item opening this mapping (`- packageId: …` two columns left).
          const item = /^([ \t]*)-[ \t]+([A-Za-z_]\w*)[ \t]*:/.exec(line);
          if (item && item[1]!.length + 2 === indent) {
            if (item[2] === spelling.retired) return `${spelling.name} (beside ${m[2]})`;
            break;
          }
          if (ownIndent(line) < indent && !item) break;
        }
      }
    }
    return null;
  };

  const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
  const judgeMarkdown = (src: string): string | null => {
    for (const m of src.matchAll(FENCE)) {
      const lang = m[1]!.toLowerCase();
      const verdict = lang === 'yaml' || lang === 'yml' ? judgeYaml(m[2]!) : judgeCode(m[2]!);
      if (verdict) return verdict;
    }
    return null;
  };

  const judge = (text: string, ext: string): string | null => {
    if (ext === '.md' || ext === '.mdx') return judgeMarkdown(text);
    if (ext === '.yaml' || ext === '.yml') return judgeYaml(text);
    return judgeCode(text);
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell a retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors both keys to assert their refusal.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its sources are the two zod files.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a mention, another shape\'s key and the tombstone (anti-vacuity)', () => {
    // Offenders — each retired shape, in each syntax the walk reads.
    expect(judge("const d = { packageId: 'a', versionRange: '^1', optional: true };", '.ts')).not.toBeNull();
    expect(judge('{ "dependencies": [{ "packageId": "a", "versionRange": "^1", "optional": false }] }', '.json')).not.toBeNull();
    expect(judge("({ name: 'a', label: 'A', version: '1.0.0', hasSeedData: true, dependencies: ['b'] })", '.js')).not.toBeNull();
    expect(judge('{ "name": "a", "minKernelVersion": "3.0.0", "dependencies": [] }', '.json')).not.toBeNull();
    expect(judge('dependencies:\n  - packageId: a\n    versionRange: ^1\n    optional: true\n', '.yaml')).not.toBeNull();
    expect(judge('name: a\nhasSeedData: false\ndependencies:\n  - b\n', '.yml')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\nconst d = { versionRange: '^1', optional: true };\n```\n", '.mdx')).not.toBeNull();
    // Neighbours that must NOT match.
    // The tombstone declarations themselves, beside the live anchor declarations.
    expect(judge("({ versionRange: z.string(), optional: retiredKey(GUIDANCE) })", '.ts')).toBeNull();
    expect(judge("({ hasSeedData: z.boolean(), dependencies: retiredKey(GUIDANCE) })", '.ts')).toBeNull();
    // The manifest record and a plugin dependency are other shapes.
    expect(judge("manifest: { id: 'a', dependencies: { 'b': '^1.0.0' } }", '.ts')).toBeNull();
    expect(judge("({ pluginId: 'a', version: '^1', optional: true })", '.ts')).toBeNull();
    expect(judge("({ name: 'p', version: '1.0.0', dependencies: [] as string[] })", '.ts')).toBeNull();
    // A nested object's key is not the entry's.
    expect(judge("({ versionRange: '^1', meta: { optional: true } })", '.ts')).toBeNull();
    // Mentions: comments, strings, and prose outside a fence.
    expect(judge("// once: { versionRange: '^1', optional: true }\nconst x = 1;", '.ts')).toBeNull();
    expect(judge("const s = \"{ hasSeedData: true, dependencies: [] }\";", '.ts')).toBeNull();
    expect(judge('Delete `optional`; `versionRange` stays.', '.mdx')).toBeNull();
    expect(judge('"marketplace/PackageDependency:optional [RETIRED]",', '.json')).toBeNull();
  });

  it('no retired dependency spelling survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    let anchorFiles = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        const text = readIfPresent(full);
        if (text === undefined || !ANCHOR_WORDS.some((w) => text.includes(w))) continue;
        anchorFiles += 1;
        const verdict = judge(text, ext);
        if (verdict) offenders.push(`${rel}: ${verdict}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, the example apps'
    // sources were really read, and the files the matcher judges were really
    // reached (the two schemas, their tests, the core and metadata-core readers
    // of the record, and the generated reference pages all carry an anchor).
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(anchorFiles).toBeGreaterThan(5);
    expect(offenders, 'an authoring of a retired dependency spelling means the retirement is being undone').toEqual([]);
  });
});
