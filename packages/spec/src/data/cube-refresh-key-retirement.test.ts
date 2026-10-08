// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cube's `refreshKey` RETIRED whole — the refresh cadence `every` and the
 * data-change probe `sql` (#20637) — ADR-0049 enforce-or-remove, ruled letter C
 * by the maintainer: retire the key, build no cache, and declare a cadence again
 * the day a result cache exists.
 *
 * Measured before removal, recorded on the tombstone in `analytics.zod.ts` and
 * on the ledger row: zero readers in the non-test sources of
 * `packages/services`, `packages/drivers` and `packages/rest` (against four for
 * the neighbouring `.public` in the same pathspec), and nothing to key on —
 * `service-analytics` references no cache or job service, so no analytics
 * result is cached.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on `CubeSchema`, a `strictObject` — so the
 *      refusal carries the prescription instead of a bare unknown-key verdict,
 *      and the key's input type is `never` for `tsc`. The nested `strictObject`
 *      the key carried is gone with it.
 *   2. D2 conversion `cube-refresh-key-removed` (step 18), a delete of the whole
 *      block from every `analyticsCubes[]` entry, retired from the load path: a
 *      live author is refused, a stored or built cube replays clean.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `data/Cube:refreshKey` — ONE row: the
 *      nested `every` / `sql` left with the block — and the family's D3 entry is
 *      `cube-refresh-key-retired`.
 *   4. The liveness row STAYS, `dead`, as one leaf, because the tombstone keeps
 *      the key in the walked shape (`check:liveness` is the judge of that half).
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — that envelope belongs to
 * the authoring door, `defineStack`, which is pinned with its `code` and
 * `status` below. Everywhere else: refusal, the issue `code`, the `path`
 * naming the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyConversions, collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack, ObjectStackDefinitionSchema } from '../stack.zod';
import { CubeSchema, defineCube, type Cube } from './analytics.zod';

const CONVERSION_ID = 'cube-refresh-key-removed';
const D3_ID = 'cube-refresh-key-retired';

/** A well-formed cube — every live key an author commonly writes, not the retired one. */
const CUBE = {
  name: 'orders',
  sql: 'orders',
  measures: { count: { label: 'Orders', type: 'count', sql: '*' } },
  dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
} as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
// The four clauses the ruling set: nothing read it, no cache exists, delete it,
// and a cadence is declared again when a cache exists.
const PRESCRIPTION =
  /`analytics_cube\.refreshKey` was removed in @objectstack\/spec 17 \(ADR-0049 enforce-or-remove\) — nothing read it: no analytics result is cached.*Delete the key; every analytics query is computed when it is asked\. A refresh cadence is declared again when a result cache exists\. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;

/** What an author could write under `refreshKey` before the removal. */
const AUTHORED = [
  { every: '1 hour' },
  { sql: 'SELECT MAX(updated_at) FROM orders' },
  { every: '1 day', sql: 'SELECT MAX(updated_at) FROM orders' },
] as const;

/** A cube as a 17.x source or stored row could carry it: the showcase's cadence. */
const persistedCube = () => ({ ...CUBE, refreshKey: { every: '1 hour' } });

describe('cube refreshKey retirement — the tombstone, at every door that carries a cube', () => {
  it('the cube schema refuses `refreshKey` at its path, with the prescription', () => {
    const r = CubeSchema.safeParse(persistedCube());
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['refreshKey']);
    expect(issue.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue.message.startsWith('`analytics_cube.refreshKey` was removed')).toBe(true);
  });

  it('refuses EVERY value — each authored shape, an empty block and a non-object; the tombstone accepts only absence', () => {
    for (const value of [...AUTHORED, {}, '1 hour', null, 0]) {
      const r = CubeSchema.safeParse({ ...CUBE, refreshKey: value });
      expect(r.success, `refreshKey: ${JSON.stringify(value)}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]!.path).toEqual(['refreshKey']);
      expect(r.error.issues[0]!.message).toMatch(PRESCRIPTION);
    }
  });

  it('the `analytics_cube` write door (the registry binding) refuses it', () => {
    // `getMetadataTypeSchema('analytics_cube')` is what `saveMetaItem` validates a
    // `PUT /api/v1/meta/analytics_cube` body against; a rebinding to some other
    // shape would pass the pins above and still accept the key in production.
    const door = getMetadataTypeSchema('analytics_cube');
    expect(door, 'no schema bound for `analytics_cube`').toBeDefined();
    expect(door).toBe(CubeSchema);
    const r = door!.safeParse(persistedCube());
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.path).toEqual(['refreshKey']);
    expect(r.error.issues[0]!.message).toMatch(PRESCRIPTION);
  });

  it('`defineCube()` refuses it with the prescription', () => {
    expect(() => defineCube(persistedCube() as never)).toThrow(PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never rewrites it', () => {
    const stack = (cube: Record<string, unknown>) => ({
      manifest: { id: 'com.example.cube-refresh-key', name: 'cube_refresh_key', version: '1.0.0', type: 'app' },
      analyticsCubes: [cube],
    });
    let thrown: unknown;
    try {
      defineStack(stack(persistedCube()) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['analyticsCubes', 0, 'refreshKey']);
    expect(refusal.issues?.[0]?.message).toMatch(PRESCRIPTION);
    // CONTROL: the same stack without the key is accepted by the same door.
    expect(() => defineStack(stack({ ...CUBE }) as never)).not.toThrow();
  });

  it('CONTROL: the same cube without the key passes, every live key intact, and grows no `refreshKey`', () => {
    const cube = CubeSchema.safeParse(CUBE);
    expect(cube.success).toBe(true);
    if (!cube.success) return;
    // Absence stays absence: the tombstone materializes nothing.
    expect(cube.data).not.toHaveProperty('refreshKey');
    // The live default still applies, so the empty reading above is the
    // retirement and not a schema that stopped emitting.
    expect(cube.data.public).toBe(true);
    expect(defineCube(CUBE).measures).toEqual(CUBE.measures);
  });

  it('the walked shape keeps `refreshKey` as a key — the ledger row and the authorable-surface row stay reachable', () => {
    const shape = (CubeSchema as unknown as { shape?: Record<string, unknown> }).shape;
    expect(shape, 'CubeSchema must expose a read-through shape').toBeDefined();
    expect(Object.keys(shape!)).toContain('refreshKey');
    expect(Object.keys(shape!), 'CONTROL: its live neighbour').toContain('joins');
  });

  it('the did-you-mean never offers the tombstone: a near-miss `refreshKy` is refused as unknown, not steered onto `refreshKey`', () => {
    // `strictObject` excludes a key that accepts nothing from its suggestion
    // pool (`acceptsNothing`), so an author who typed `refreshKy` is not told to
    // write the retired key and meet a second refusal.
    const r = CubeSchema.safeParse({ ...CUBE, refreshKy: { every: '1 hour' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toContain('`refreshKy`');
    expect(issue.message).not.toMatch(/`refreshKy` → `refreshKey`/);
  });

  it('fails tsc at the authoring site: the input type of `refreshKey` is `never`', () => {
    const cube: Cube = {
      ...CUBE,
      // @ts-expect-error — `refreshKey` is a retiredKey() tombstone: its input type is `never`.
      refreshKey: { every: '1 hour' },
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => CubeSchema.parse(cube)).toThrow(PRESCRIPTION);
  });
});

describe('cube refreshKey retirement — the D2 conversion', () => {
  it('a STORED `analytics_cube` row carrying the key replays clean through the rehydration seam', () => {
    // The seam wraps an `analytics_cube` row as `{ analyticsCubes: [row] }` and
    // replays the full chain, retired entries included.
    const notices: { conversionId?: string; path?: string; from?: string; to?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem(
      'analytics_cube',
      { ...CUBE, refreshKey: { every: '1 day', sql: 'SELECT MAX(updated_at) FROM orders' } },
      { onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }) },
    ) as Record<string, unknown>;

    expect(notices.map((n) => [n.conversionId, n.path, n.from, n.to])).toEqual([
      [CONVERSION_ID, 'analyticsCubes[0](orders).refreshKey', 'refreshKey', '(removed)'],
    ]);
    expect(rehydrated).not.toHaveProperty('refreshKey');
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual(CUBE);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(CubeSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const artifact = () => ({ analyticsCubes: [persistedCube()] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('`analytics_cube.refreshKey` was removed');

    const healed = applyConversions(artifact(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(
      after.success,
      `expected the converted artifact to parse; got ${JSON.stringify(after.error?.issues ?? [])}`,
    ).toBe(true);
  });

  it('LIT CONTROL — a cube that was always wrong is refused on BOTH sides of the conversion', () => {
    // `refreshKy` is not the retired key, so the strip leaves it and the door
    // still refuses — which is what makes the leg above a reading and not a
    // tautology.
    const artifact = () => ({ analyticsCubes: [{ ...persistedCube(), refreshKy: { every: '1 hour' } }] });
    expect(ObjectStackDefinitionSchema.safeParse(artifact()).success).toBe(false);
    const healed = applyConversions(artifact(), { includeRetired: true });
    expect(ObjectStackDefinitionSchema.safeParse(healed).success).toBe(false);
  });

  it('strips the WHOLE block whatever it holds — one notice per cube — and names each cube', () => {
    const input = {
      analyticsCubes: [
        { ...CUBE, name: 'a', refreshKey: { every: '1 hour' } },
        { ...CUBE, name: 'b', refreshKey: { sql: 'SELECT 1' } },
        { ...CUBE, name: 'c', refreshKey: {} },
        { ...CUBE, name: 'd', refreshKey: '1 hour' },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(mine.map((n) => n.path)).toEqual([
      'analyticsCubes[0](a).refreshKey',
      'analyticsCubes[1](b).refreshKey',
      'analyticsCubes[2](c).refreshKey',
      'analyticsCubes[3](d).refreshKey',
    ]);
    for (const cube of stack.analyticsCubes as Record<string, unknown>[]) {
      expect(cube).not.toHaveProperty('refreshKey');
      expect(CubeSchema.safeParse(cube).success).toBe(true);
    }
  });

  it('strips only the cubes that carry the key, and is idempotent by construction', () => {
    const input = {
      analyticsCubes: [
        persistedCube(),
        // A cube already canonical: no notice, and handed back by reference.
        { ...CUBE, name: 'accounts' },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(1);
    const cubes = stack.analyticsCubes as unknown[];
    expect(cubes[1]).toBe(input.analyticsCubes[1]);

    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference.
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { analyticsCubes: [persistedCube()] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('cube refreshKey retirement — ADR-0087 registration', () => {
  it('declares ONE key under major 18 — the nested `every` / `sql` left with the block', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('data/Cube:refreshKey');
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k.startsWith('data/Cube:refreshKey'))).toEqual(['data/Cube:refreshKey']);
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('analyticsCubes[].refreshKey');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.replacement).toContain('delete the key');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('the batch-D strictness entry no longer offers `refreshKey` as a surface an author can reach', () => {
    const batchD = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === 'analytics-authorable-unknown-keys-refused');
    expect(batchD, 'the batch-D D3 entry').toBeDefined();
    expect(batchD!.surface).not.toContain('refreshKey');
    expect(batchD!.acceptanceCriteria).not.toContain('refreshKey');
    // Its reason records the removal by the conversion's whole id.
    expect(batchD!.reason).toContain(`\`${CONVERSION_ID}\``);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types the key `never` on `Cube`,
// so every TYPED authoring site fails to compile (the showcase authored through
// `defineCube`). The residue is what `tsc` never judges: JSON, YAML, MD/MDX code
// fences, untyped `.js`, and TS literals typed `any` / `unknown`. This walk
// covers that residue across the five repo roots `scripts/cross-package-test-inputs.mjs`
// already declares for `@objectstack/spec#test` (mirrored in `turbo.json`), plus
// the example apps' own `src/` trees, declared there as `examples/*/src/**/*.ts`
// — where the one known author lived.
//
// The matcher judges the AUTHORING SHAPE, never a mention: `refreshKey` in key
// position whose object value holds an `every` or `sql` key (TS / JS / JSON, and
// YAML block and flow form). `refreshKey` is also an ordinary React prop name
// elsewhere, which never takes an `every` / `sql` object. Prose mentions are
// spelled in inline code throughout this repo, and inline code is stripped
// before judging. The bound, stated: an empty `refreshKey: {}`, a block
// assembled by spread or under computed keys, and `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a cube refreshKey', () => {
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

  const AUTHORING = [
    // TS / JS / JSON, block or inline: the key, then an object whose own keys
    // (before any nested brace) include `every` or `sql`.
    /(^|[^\w.$])["']?refreshKey["']?\s*:\s*\{[^{}]*?(^|[^\w.$])["']?(every|sql)["']?\s*:/m,
    // YAML block form: the key on its own line, `every:` / `sql:` indented below it.
    /^[ \t]*(-[ \t]+)?refreshKey[ \t]*:[ \t]*\r?\n[ \t]+(every|sql)[ \t]*:/m,
  ];

  /**
   * Inline code spans are prose — the house style `check:doc-authoring` enforces
   * — so stripping single-backtick spans separates "the retirement kit
   * describing what it removed" from "a source still writing it".
   * Newline-bounded: a fenced block's content is NOT stripped, so an authoring
   * inside a fenced example is still caught.
   */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): RegExpExecArray | null => {
    const stripped = stripInlineCode(text);
    for (const re of AUTHORING) {
      const m = re.exec(stripped);
      if (m) return m;
    }
    return null;
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its refusal and its conversion.
    THIS_FILE,
    // The batch-D site pin authors the key to assert the retirement refusal
    // where the nested strictness pin used to stand.
    'packages/spec/src/data/analytics-strictness-batchd.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement cube on purpose.
    'packages/spec/src/conversions/',
    // The liveness ledgers key one row per schema PROPERTY: the `refreshKey`
    // row is a classification of the shape, not an authoring, and the tombstone
    // route requires it to STAY.
    'packages/spec/liveness/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is `analytics.zod.ts`.
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

  it('the matcher recognises an authoring and ignores a prose mention and a React prop (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("defineCube({ name: 'o', sql: 'o', refreshKey: { every: '1 hour' } })")).not.toBeNull();
    expect(judge("  refreshKey: {\n    every: '1 hour',\n  },")).not.toBeNull();
    expect(judge("  refreshKey: {\n    // the probe\n    sql: 'SELECT 1',\n  },")).not.toBeNull();
    expect(judge('{ "refreshKey": { "every": "1 hour", "sql": "SELECT 1" } }')).not.toBeNull();
    expect(judge('cubes:\n  - name: o\n    refreshKey:\n      every: 1 hour\n')).not.toBeNull();
    expect(judge('refreshKey: { every: 1 hour }\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefineCube({ refreshKey: { sql: 'x' } });\n```\n")).not.toBeNull();
    // ⛔ NARROWNESS of the strip: a real authoring sharing a line with inline code still counts.
    expect(judge("// see `joins` — refreshKey: { every: '1 hour' },")).not.toBeNull();
    // Neighbours that must NOT match.
    // Prose and inline code: the retirement kit must be able to describe what it removed.
    expect(judge("the `refreshKey: { every: '1 hour' }` block leaves with it")).toBeNull();
    expect(judge('"data/Cube:refreshKey [RETIRED]",')).toBeNull();
    expect(judge("surface: 'analyticsCubes[].refreshKey (every, sql)',")).toBeNull();
    // The tombstone declaration itself, and a ledger row keyed by the property.
    expect(judge('refreshKey: retiredKey(CUBE_REFRESH_KEY_REMOVED),')).toBeNull();
    expect(judge('"refreshKey": {\n  "status": "dead",\n  "verifiedAt": "2026-09-29"\n}')).toBeNull();
    // The React prop spelling that shares the word: a counter, never a cadence.
    expect(judge('<ObjectView refreshKey={refreshKey} />')).toBeNull();
    expect(judge('seen.push({ refreshTrigger: s?.refreshTrigger, refreshKey: props.refreshKey });')).toBeNull();
    expect(judge("const s = { refreshKey: 1, nested: { every: 'x' } };")).toBeNull();
  });

  it('no cube refreshKey authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
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
        if (text === undefined) continue;
        const m = judge(text);
        if (m) offenders.push(`${rel} authors \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, and the example apps'
    // sources — where the one known author lived — were really read.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'a cube refreshKey authoring means the retirement is being undone').toEqual([]);
  });
});
