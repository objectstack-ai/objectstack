// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The turso datasource's `encryptionKey` RETIRED (#25050) — ADR-0049
 * enforce-or-remove.
 *
 * The key promised an AES-256 key for the local database file and was honoured
 * in no mode: beside a `file:` url or `:memory:` the local engine has no
 * encryption codec (refused there since #25020), and beside a remote url the
 * driver parsed it and built its libSQL client without it. Measured before
 * removal: no example, template, CLI scaffold, published skill, host default or
 * environment variable authors it.
 *
 * Bookkeeping shapes, pinned below (the refusal itself — every mode, every
 * value, both authoring doors, the tsc channel — is pinned in `turso.test.ts`;
 * the driver's mirror and constructor in `@objectstack/driver-turso`'s
 * `turso-config-constructor-parity.test.ts`):
 *   1. D2 conversion `turso-config-encryption-key-removed` (step 18), retired
 *      from the load path, and PARTIAL on purpose: it strips the key only
 *      where that changes nothing — an unset value, or a remote url — and
 *      leaves a non-empty key beside a local url for the author.
 *   2. `RETIRED_KEYS_BY_MAJOR[18]` carries `data/TursoConfig:encryptionKey`;
 *      the D3 entry is `turso-config-encryption-key-retired`.
 *   3. A tree-scoped absence pin over the declared radius.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../../conversions/apply';
import { ALL_CONVERSIONS } from '../../conversions/registry';
import { applyConversionsToStoredItem } from '../../conversions/stored';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../../migrations/registry';
import { DatasourceSchema } from '../datasource.zod';

const KEY = 'encryptionKey';
const CONVERSION_ID = 'turso-config-encryption-key-removed';
const D3_ID = 'turso-config-encryption-key-retired';

type Notice = { conversionId?: string; path?: string; from?: string; to?: string };

/** A stored datasource row, as the rehydration seam reads it. */
const row = (url: string, extra: Record<string, unknown> = {}) => ({
  name: 'edge_db',
  label: 'Edge',
  driver: 'turso',
  config: { url, ...extra },
});

const rehydrate = (item: Record<string, unknown>) => {
  const notices: Notice[] = [];
  const out = applyConversionsToStoredItem('datasource', item, {
    onNotice: (n) => notices.push(n as Notice),
  }) as Record<string, unknown>;
  return { out, mine: notices.filter((n) => n.conversionId === CONVERSION_ID) };
};

describe('encryptionKey retirement — the D2 conversion', () => {
  it('a STORED remote row carrying the key replays clean: stripped, and what the write door accepts now', () => {
    for (const url of ['libsql://db.turso.io', 'https://db.turso.io', ' WSS://db.turso.io', 'http://127.0.0.1:8080']) {
      const stored = row(url, { encryptionKey: 'stored-25050', concurrency: 4 });
      const before = DatasourceSchema.safeParse(stored);
      expect(before.success, url).toBe(false);

      const { out, mine } = rehydrate(stored);
      expect(mine.map((n) => [n.from, n.to, n.path?.endsWith('.config.encryptionKey')]), url).toEqual([
        [KEY, '(removed)', true],
      ]);
      expect((out.config as Record<string, unknown>)[KEY], url).toBeUndefined();
      // CONTROL: every other key on the row survives byte-for-byte.
      expect(out).toEqual(row(url, { concurrency: 4 }));
      // The leg above is a reading, not a tautology: the converted row parses
      // only because whitespace in the url is the one thing left to judge.
      if (url.trim() === url) expect(DatasourceSchema.safeParse(out).success, url).toBe(true);
    }
  });

  it('strips an UNSET value beside a local url too — every loader already dropped it', () => {
    for (const value of ['', null, 0]) {
      const { out, mine } = rehydrate(row('file:./data/app.db', { encryptionKey: value }));
      expect(mine, String(value)).toHaveLength(1);
      expect(out).toEqual(row('file:./data/app.db'));
    }
  });

  it('LEAVES a non-empty key beside a local url for the author — that operator believed the file encrypted', () => {
    for (const config of [
      { url: 'file:./data/app.db', encryptionKey: 'k' },
      { url: ':memory:', encryptionKey: 'k' },
      { url: 'file:./data/replica.db', syncUrl: 'libsql://db.turso.io', encryptionKey: 'k' },
      { url: 'file:./data/app.db', mode: 'remote', encryptionKey: 'k' },
    ]) {
      const stored = { name: 'edge_db', label: 'Edge', driver: 'turso', config };
      const { out, mine } = rehydrate(stored);
      expect(mine, JSON.stringify(config)).toHaveLength(0);
      expect(out, JSON.stringify(config)).toEqual(stored);
      // Still refused where it is written, with the retirement's prescription.
      expect(JSON.stringify(DatasourceSchema.safeParse(out).error?.issues)).toContain(
        '`turso config.encryptionKey` was removed',
      );
    }
  });

  it("never touches another driver's key of the same name, and resolves the `libsql` alias as turso", () => {
    const other = { name: 'warehouse', label: 'W', driver: 'mysql', config: { url: 'mysql://db/app', encryptionKey: 'k' } };
    expect(rehydrate(other).mine).toHaveLength(0);
    const alias = { ...row('libsql://db.turso.io', { encryptionKey: 'k' }), driver: 'libsql' };
    expect(rehydrate(alias).mine).toHaveLength(1);
  });

  it('is idempotent, and retired from the load path — a live author is refused at parse, never rewritten', () => {
    const input = { datasources: [row('libsql://db.turso.io', { encryptionKey: 'k' })] };
    const once = collectConversionNotices(input, { includeRetired: true });
    expect(once.notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(1);
    const replay = collectConversionNotices(once.stack, { includeRetired: true });
    expect(replay.notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);

    const live = collectConversionNotices(input);
    expect(live.notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(live.stack).toEqual(input);
  });
});

describe('encryptionKey retirement — ADR-0087 registration', () => {
  it('declares the key under major 18, once', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('data/TursoConfig:encryptionKey');
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k === 'data/TursoConfig:encryptionKey')).toHaveLength(1);
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('carries ONE D3 entry, naming its D2 conversion and the local-url residue', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(CONVERSION_ID);
    expect(entry!.replacement).toContain('delete encryptionKey');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper: the tombstone types the key as the retired mark
// on `TursoConfig`'s input, and `@objectstack/driver-turso` types
// `TursoDriverConfig.encryptionKey` as `never`, so every TYPED authoring site
// fails to compile. The residue is what `tsc` never judges: JSON, YAML, MD/MDX
// code fences, untyped `.js`, and TS literals typed `any` / `unknown` / a
// record — a stored-row fixture is exactly that shape. This walk covers it
// across the roots `scripts/cross-package-test-inputs.mjs` already declares
// for `@objectstack/spec#test`, plus the example apps' own `src/` trees.
//
// `encryptionKey` is NOT a distinctive name — other subsystems may name a
// secret that way — so the matcher judges it in KEY POSITION only (string and
// comment contents masked first, a quoted key kept for JSON), and every
// structural exclusion below says why its file spells the key. The bound,
// stated: a key under a computed name or assembled by spread, and `docs/**`,
// `.claude/**`, `.github/**`, `.changeset/**` and the repo-root files are
// outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a turso encryptionKey', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** The retired key in key position — never a tombstone declaration itself. */
  const RETIRED_KEY = /(^|[\s{,(])["']?encryptionKey["']?\s*:(?!\s*(?:retiredKey\(|z\.never\())/m;
  const YAML_KEY = /^[ \t]*(?:-[ \t]+)?encryptionKey[ \t]*:/m;

  /**
   * Code with string and comment CONTENTS blanked (same length, so offsets
   * hold). A quoted string followed by `:` is a key and is kept — that is how
   * JSON and quoted TS keys stay visible. A template literal is blanked whole.
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
      } else if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
        const close = Math.min(j, src.length - 1);
        const isKey = c !== '`' && /^\s*:/.test(src.slice(close + 1, close + 40));
        if (!isKey) blank(i + 1, close);
        i = close + 1;
      } else {
        i += 1;
      }
    }
    return out.join('');
  };

  const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
  const judge = (text: string, ext: string): boolean => {
    if (ext === '.yaml' || ext === '.yml') return YAML_KEY.test(text);
    if (ext === '.md' || ext === '.mdx') {
      for (const m of text.matchAll(FENCE)) {
        const lang = m[1]!.toLowerCase();
        if (lang === 'yaml' || lang === 'yml' ? YAML_KEY.test(m[2]!) : RETIRED_KEY.test(maskCode(m[2]!))) return true;
      }
      return false;
    }
    return RETIRED_KEY.test(maskCode(text));
  };

  /**
   * Structural exclusions, each with its reason. ⛔ NOT an allowlist file
   * (`spec-property-retirement` §4): every entry's JOB is to spell the key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its conversion.
    THIS_FILE,
    // The refusal pins: every mode, every value, both authoring doors.
    'packages/spec/src/data/driver/turso.test.ts',
    // The stored-row redaction proofs: a row written before the retirement
    // still holds the value, and the read path must still withhold it.
    'packages/spec/src/data/datasource-credential-redaction.test.ts',
    'packages/spec/src/kernel/metadata-type-redaction.test.ts',
    'packages/services/service-datasource/src/__tests__/datasource-config-redaction.test.ts',
    'packages/metadata-protocol/src/protocol.data-door-stored-metadata-redaction.test.ts',
    // The driver's refusal pins: the constructor and the mirror against the
    // spec contract.
    'packages/drivers/driver-turso/src/spec/turso-config-constructor-parity.test.ts',
    'packages/drivers/driver-turso/src/turso-driver-encryption-key-retired.test.ts',
    // The loader's reader forwards a stored value to the constructor's
    // refusal (never honoured), and its pin authors the stored row.
    'packages/services/service-datasource/src/turso-driver-config.ts',
    'packages/services/service-datasource/src/__tests__/turso-driver-config.test.ts',
    // The credential-migration planner's pin: a legacy row holding the
    // retired key is reported, never bound.
    'packages/services/service-datasource/src/__tests__/datasource-credential-migration.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement datasource on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output, reached only because this is a FILESYSTEM walk.
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

  it('the matcher recognises an authoring and ignores a mention and the tombstones (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("const ds = { driver: 'turso', config: { url: 'libsql://x', encryptionKey: 'k' } };", '.ts')).toBe(true);
    expect(judge('{ "driver": "turso", "config": { "url": "libsql://x", "encryptionKey": "k" } }', '.json')).toBe(true);
    expect(judge('config:\n  url: libsql://x\n  encryptionKey: k\n', '.yaml')).toBe(true);
    expect(judge("Prose.\n\n```ts\nencryptionKey: 'k',\n```\n", '.mdx')).toBe(true);
    expect(judge('Prose.\n\n```yaml\nencryptionKey: k\n```\n', '.md')).toBe(true);
    // Neighbours that must NOT match: the tombstones, an optional-never type,
    // comments, strings, prose, the surface ledger row.
    expect(judge('encryptionKey: retiredKey(TURSO_ENCRYPTION_KEY_RETIRED),', '.ts')).toBe(false);
    expect(judge('encryptionKey: z.never({ error: () => X }).optional(),', '.ts')).toBe(false);
    expect(judge('encryptionKey?: never;', '.ts')).toBe(false);
    expect(judge("// it once wrote { encryptionKey: 'k' }\nconst x = 1;", '.ts')).toBe(false);
    expect(judge("const s = \"{ encryptionKey: 'k' }\";", '.ts')).toBe(false);
    expect(judge('Delete `encryptionKey` from every turso datasource.', '.mdx')).toBe(false);
    expect(judge('"data/TursoConfig:encryptionKey [RETIRED]",', '.json')).toBe(false);
  });

  it('no encryptionKey authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    let driverFiles = 0;
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
        if (rel.startsWith('packages/drivers/driver-turso/src/')) driverFiles += 1;
        const text = readIfPresent(full);
        if (text === undefined || !text.includes(KEY)) continue;
        if (judge(text, ext)) offenders.push(rel);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, the example apps'
    // sources were really read, and the driver package the key lived in was
    // really reached.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(driverFiles).toBeGreaterThan(10);
    expect(offenders, 'a turso encryptionKey authoring means the retirement is being undone').toEqual([]);
  });
});
