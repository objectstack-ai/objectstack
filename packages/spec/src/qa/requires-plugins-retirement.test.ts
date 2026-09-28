// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `scenarios[].requires.plugins` RETIRED into `requires.services` (#20289, the
 * `qa-runner` family's fifth key; ruling B) — ADR-0049 enforce-or-remove on a
 * block that is otherwise ENFORCED: core's TestRunner judges `requires` before
 * a scenario's first step and skips it with a reason when an entry is unmet.
 * `plugins` could not join that judgement — `os test` reaches its target over
 * HTTP and no served surface lists the loaded plugins — so it retires into
 * `services`, which the discovery document already answers.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone INSIDE the live `requires` block — a
 *      non-strict `z.object()`, so a bare deletion would strip the key in
 *      silence. The refusal itself is pinned beside the schema, in
 *      `testing.test.ts`.
 *   2. No D2 conversion: a QA suite is a loose JSON file `os test` loads, never
 *      a stack collection member or a stored row. `RETIRED_KEYS_BY_MAJOR[18]`
 *      carries `qa/TestScenario:requires.plugins`; the family's D3 entry is
 *      `qa-scenario-requires-plugins-retired`.
 *   3. The liveness row `qa.scenarios.requires` is `live` — the block is read —
 *      and its note records the tombstone (`check:liveness` judges that half).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

describe('requires.plugins retirement — ADR-0087 registration', () => {
  it('declares the key under major 18 and carries one D3 entry for the family, with no D2 conversion', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('qa/TestScenario:requires.plugins');
    const step = MIGRATIONS_BY_MAJOR[18]!;
    const entry = step.semantic.find((e) => e.id === 'qa-scenario-requires-plugins-retired');
    expect(entry, 'the family D3 entry must be registered in the step-18 chain').toBeDefined();
    expect(entry!.surface).toBe('qa.scenarios[].requires.plugins');
    expect(entry!.replacement).toContain('`requires.services`');
    // A QA suite has no stack or stored source for a conversion to rewrite. A
    // conversion id naming the key would be a strip with nothing to strip.
    expect(step.conversionIds.filter((id) => /requires-plugins/.test(id))).toEqual([]);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper for TYPED authorings — `retiredKey()` types the
// key `never` on `TestScenario` — and `os test` refuses a suite file carrying it
// at load. The residue is what neither judges before a run: a suite JSON nobody
// runs in CI, YAML, MD/MDX code fences, untyped `.js`, and TS literals cast
// through `as any` / `as never`. This walk covers that residue across five
// roots, each already declared for `@objectstack/spec#test` in
// `scripts/cross-package-test-inputs.mjs` and mirrored in `turbo.json` — the
// same roots and extensions the `rest_api` and view-item retirement pins walk.
//
// ⭐ `requires` and `plugins` are ordinary words (a stack's `requires` is an
// array of capabilities; a plugin manifest's is an array of `{ pluginId }`), so
// the matcher is STRUCTURAL: an offender is an object literal (or YAML mapping)
// that is the VALUE of a `requires` key and carries a `plugins` key. Nothing
// else.
//
// The bound, stated: a block assembled by SPREAD or computed keys, and a YAML
// flow mapping (`requires: { plugins: [x] }` on one YAML line), are invisible to
// this walk; `docs/**`, `.claude/**`, `.github/**` and the repo-root files are
// outside the radius.
describe('tree-scoped absence: no scenario inside the declared radius still authors `requires.plugins`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key on a `requires` block.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert the matcher finds it.
    THIS_FILE,
    // The schema's refusal pins author the key to assert the SCHEMA refuses it.
    'packages/spec/src/qa/testing.test.ts',
    // `os test`'s load-time refusal pin authors it to assert the CLI refuses it.
    'packages/cli/test/qa-suite-schema-load.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const isOffender = (parentKey: string | undefined, keys: Set<string>): boolean =>
    parentKey === 'requires' && keys.has('plugins');

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:` — and remembering the key it is the
   * VALUE of (a `{` whose previous significant token is the `:` of a key).
   * Strings and comments are skipped; a single- or double-quoted string never
   * spans a line, so a mis-lexed quote (a regex literal) costs at most that
   * line. Returns the 1-based line of each closing brace whose frame offends.
   * Copied from the `rest_api` retirement pin, never imported: each pin keeps
   * running standalone.
   */
  const lexOffenders = (text: string): number[] => {
    const out: number[] = [];
    const stack: { kind: string; keys: Set<string>; parentKey?: string }[] = [];
    let lastSig = '';
    let justKey: string | undefined;
    let colonKey: string | undefined;
    let line = 1;
    let i = 0;
    const n = text.length;
    const sawToken = (token: string, j: number) => {
      const top = stack[stack.length - 1];
      const isKey = text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',');
      if (isKey) top!.keys.add(token);
      justKey = isKey ? token : undefined;
    };
    while (i < n) {
      const c = text[i]!;
      if (c === '\n') { line += 1; i += 1; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i += 1; continue; }
      if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') line += 1; i += 1; }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const start = i;
        i += 1;
        while (i < n && text[i] !== c) {
          if (text[i] === '\\') i += 1;
          else if (text[i] === '\n') { if (c !== '`') break; line += 1; }
          i += 1;
        }
        const token = text.slice(start + 1, i);
        i += 1;
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        if (c === '`') justKey = undefined;
        else sawToken(token, j);
        lastSig = 'str';
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(text[i]!)) i += 1;
        const token = text.slice(start, i);
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        sawToken(token, j);
        lastSig = 'id';
        continue;
      }
      if (c === ':') {
        colonKey = justKey;
        justKey = undefined;
        lastSig = ':';
        i += 1;
        continue;
      }
      if (c === '{') stack.push({ kind: c, keys: new Set(), parentKey: lastSig === ':' ? colonKey : undefined });
      else if (c === '[' || c === '(') stack.push({ kind: c, keys: new Set() });
      else if (c === '}' || c === ']' || c === ')') {
        const frame = stack.pop();
        if (frame?.kind === '{' && c === '}' && isOffender(frame.parentKey, frame.keys)) out.push(line);
      }
      if (!/\s/.test(c)) { lastSig = c; justKey = undefined; }
      i += 1;
    }
    return out;
  };

  /**
   * YAML: a block mapping opened by `requires:` with no inline value; its OWN
   * keys are the lines at its first child's column, until a line at or above
   * the opener's column. Returns the 1-based line of each offending opener.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:/.exec(raw);
      if (!m) return null;
      const opensBlock = /^\s*(-\s+)?[A-Za-z_][\w]*\s*:\s*(#.*)?$/.test(raw);
      return { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]!, opensBlock };
    });
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row || !row.opensBlock || row.key !== 'requires') return;
      const keys = new Set<string>();
      let childCol: number | undefined;
      for (let k = at + 1; k < rows.length; k += 1) {
        const r = rows[k];
        if (!r) continue;
        if (r.col <= row.col) break;
        childCol ??= r.col;
        if (r.col === childCol) keys.add(r.key);
      }
      if (isOffender(row.key, keys)) out.push(row.idx + 1);
    });
    return out;
  };

  /** MD/MDX: only fenced code is judged — prose mentions are not authorings. */
  const markdownOffenders = (text: string): number[] => {
    const out: number[] = [];
    const fence = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
    for (let m = fence.exec(text); m; m = fence.exec(text)) {
      const lang = m[1]!.toLowerCase();
      const body = m[2]!;
      const offset = text.slice(0, m.index).split('\n').length;
      const hits = lang === 'yaml' || lang === 'yml' ? yamlOffenders(body) : lexOffenders(body);
      for (const h of hits) out.push(offset + h);
    }
    return out;
  };

  const mentions = (text: string): boolean => text.includes('requires') && text.includes('plugins');

  const offendersIn = (ext: string, text: string): number[] => {
    if (!mentions(text)) return [];
    if (ext === '.yaml' || ext === '.yml') return yamlOffenders(text);
    if (ext === '.md' || ext === '.mdx') return markdownOffenders(text);
    return lexOffenders(text);
  };

  const vanished: string[] = [];
  /** Tolerates ONLY a path's disappearance mid-walk; every other fault is re-raised. */
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('the matcher finds an authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the retired spelling, in each syntax the walk reads.
    expect(offendersIn('.json', '{ "scenarios": [ { "id": "a", "requires": { "plugins": ["crm"] } } ] }')).toEqual([1]);
    expect(offendersIn('.json', '{\n  "requires": {\n    "params": ["X"],\n    "plugins": []\n  }\n}')).toEqual([5]);
    expect(offendersIn('.ts', "const s = { id: 'a', requires: { services: ['ai'], plugins: ['crm'] } } as never;")).toEqual([1]);
    expect(offendersIn('.yaml', 'scenarios:\n  - id: a\n    requires:\n      plugins:\n        - crm\n')).toEqual([3]);
    expect(offendersIn('.md', 'Prose.\n\n```json\n{ "requires": { "plugins": ["crm"] } }\n```\n')).toEqual([4]);
    // Neighbours that must NOT match.
    // The replacement spelling.
    expect(offendersIn('.json', '{ "requires": { "params": ["X"], "services": ["ai"] } }')).toEqual([]);
    // A stack's `requires` is an array of capabilities; a manifest's is an array of `{ pluginId }`.
    expect(offendersIn('.ts', "defineStack({ requires: ['ai'], plugins: [new AuthPlugin()] })")).toEqual([]);
    expect(offendersIn('.json', '{ "requires": [ { "pluginId": "a", "plugins": ["b"] } ] }')).toEqual([]);
    // `plugins` NESTED one level down belongs to another block.
    expect(offendersIn('.ts', "({ requires: { params: ['X'], extra: { plugins: [] } } })")).toEqual([]);
    // The schema declaration itself: the `{` is `z.object(`'s argument, not the key's value.
    expect(offendersIn('.ts', "requires: z.object({ plugins: retiredKey('gone') })")).toEqual([]);
    // Prose, comments and quoted strings are not authorings.
    expect(offendersIn('.md', 'A suite once wrote `requires: { plugins: [crm] }` here.')).toEqual([]);
    expect(offendersIn('.ts', '// requires: { plugins: [] }')).toEqual([]);
    expect(offendersIn('.ts', 'const s = "{ requires: { plugins: [] } }";')).toEqual([]);
    // A YAML `requires` mapping whose `plugins` belongs to a nested block.
    expect(offendersIn('.yaml', 'requires:\n  params:\n    - X\n  other:\n    plugins: []\n')).toEqual([]);
  });

  it('a path that VANISHES mid-walk is not a finding, and every other read fault still is', () => {
    const before = vanished.length;
    const gone = path.join(REPO_ROOT, 'packages/spec/does-not-exist.bundled_probe.mjs');
    expect(fs.existsSync(gone)).toBe(false);
    expect(readIfPresent(gone, 'probe/gone')).toBeUndefined();
    expect(vanished.slice(before)).toEqual(['probe/gone']);
    expect(readIfPresent(fileURLToPath(import.meta.url), THIS_FILE)).toContain('tree-scoped absence');
    expect(() => readIfPresent(path.join(REPO_ROOT, 'packages/spec'), 'probe/dir')).toThrow();
    expect(vanished.length).toBe(before + 1);
  });

  it('no `requires` block authoring `plugins` survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let suites = 0;
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
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (entry.name.endsWith('.test.json') && text.includes('"scenarios"')) suites += 1;
        for (const lineNo of offendersIn(ext, text)) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the authored QA suites —
    // the files that most plausibly hold an authoring — were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(suites).toBeGreaterThan(0);
    expect(offenders, 'a `requires` block authoring `plugins` means the retirement is being undone').toEqual([]);
  });
});
