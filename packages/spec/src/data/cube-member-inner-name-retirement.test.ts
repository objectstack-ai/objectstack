// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inner `name` on cube measures and dimensions RETIRED (#20300) — ADR-0049
 * enforce-or-remove, graded RETIRE by the maintainer's criterion for
 * declared-but-unenforced families: does a mainstream platform have the
 * capability? Cube.dev and LookML key a member by its declared name, with no
 * second inner name that can disagree — and here the record key already
 * delivered it.
 *
 * Measured before removal, with a lit control, and recorded on the tombstone
 * in `analytics.zod.ts` and on both ledger rows: zero reads of a member's inner
 * `name` in non-test source, against four reads of the neighbouring
 * `measure.label` / `dimension.label` in the same two `getMeta` projections.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `retiredKey()` tombstones on `MetricSchema` and `DimensionSchema` — both
 *      `strictObject`s, so the tombstone (the `action.aria` posture) is what
 *      carries the prescription instead of a bare unknown-key verdict, and it
 *      types the key `never` for `tsc`.
 *   2. D2 conversion `cube-member-inner-name-removed` (step 18), a delete over
 *      every member of every `analyticsCubes[]` entry, retired from the load
 *      path: a live author is refused, a stored or built cube replays clean.
 *      The key was REQUIRED, so every persisted cube carries it — the
 *      conversion is what keeps a deployed cube booting.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `data/Metric:name` and
 *      `data/Dimension:name`, and the family's D3 entry is
 *      `cube-member-inner-name-retired` (one D3 entry per retirement family,
 *      even when D2 is lossless).
 *   4. The liveness rows STAY, `dead`, because the tombstone keeps the key in
 *      the walked shape (`check:liveness` is the judge of that half).
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
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack, ObjectStackDefinitionSchema } from '../stack.zod';
import {
  CubeSchema,
  DimensionSchema,
  MetricSchema,
  defineCube,
  type Cube,
  type Dimension,
  type Metric,
} from './analytics.zod';

const CONVERSION_ID = 'cube-member-inner-name-removed';

/** A well-formed metric and dimension — every live key an author commonly writes, not the retired one. */
const METRIC = { label: 'Orders', type: 'count', sql: '*' } as const;
const DIMENSION = { label: 'Status', type: 'string', sql: 'status' } as const;

/** A well-formed cube over those members. */
const CUBE = {
  name: 'orders',
  sql: 'orders',
  measures: { count: METRIC },
  dimensions: { status: DIMENSION },
} as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const METRIC_PRESCRIPTION =
  /`measures\.<metric>\.name` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*the record key is the metric's name.*Delete the key\..*rename its key in `measures`.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand\./s;
const DIMENSION_PRESCRIPTION =
  /`dimensions\.<dimension>\.name` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*the record key is the dimension's name.*Delete the key\..*rename its key in `dimensions`.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand\./s;

/** What a 17.4-or-earlier parse emitted: the REQUIRED inner name on every member, equal to its key. */
const persistedCube = () => ({
  name: 'orders',
  sql: 'orders',
  measures: {
    count: { name: 'count', ...METRIC },
    total_amount: { name: 'total_amount', label: 'Total', type: 'sum', sql: 'amount' },
  },
  dimensions: { status: { name: 'status', ...DIMENSION } },
});

describe('cube member inner name retirement — the tombstone, at every door that carries a cube', () => {
  it('the metric schema refuses `name` at its path, with the prescription', () => {
    const r = MetricSchema.safeParse({ name: 'count', ...METRIC });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['name']);
    expect(issue.message).toMatch(METRIC_PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue.message.startsWith('`measures.<metric>.name` was removed')).toBe(true);
  });

  it('the dimension schema refuses `name` at its path, with the prescription', () => {
    const r = DimensionSchema.safeParse({ name: 'status', ...DIMENSION });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['name']);
    expect(issue.message).toMatch(DIMENSION_PRESCRIPTION);
    expect(issue.message.startsWith('`dimensions.<dimension>.name` was removed')).toBe(true);
  });

  it('refuses every value shape — the key-equal one included; the tombstone accepts only absence', () => {
    for (const value of ['count', 'total_count', 'TotalCount', '', null, 1]) {
      const r = MetricSchema.safeParse({ name: value, ...METRIC });
      expect(r.success, `measures name: ${JSON.stringify(value)}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues[0]!.path).toEqual(['name']);
      expect(r.error.issues[0]!.message).toMatch(METRIC_PRESCRIPTION);
    }
    for (const value of ['status', 'order_status', null]) {
      const r = DimensionSchema.safeParse({ name: value, ...DIMENSION });
      expect(r.success, `dimensions name: ${JSON.stringify(value)}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues[0]!.message).toMatch(DIMENSION_PRESCRIPTION);
    }
  });

  it('the cube schema refuses it at measures.<key>.name and dimensions.<key>.name — one issue per member', () => {
    const r = CubeSchema.safeParse(persistedCube());
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => [i.code, i.path])).toEqual([
      ['invalid_type', ['measures', 'count', 'name']],
      ['invalid_type', ['measures', 'total_amount', 'name']],
      ['invalid_type', ['dimensions', 'status', 'name']],
    ]);
  });

  it('the `analytics_cube` write door (the registry binding) refuses it', () => {
    // `getMetadataTypeSchema('analytics_cube')` is what `saveMetaItem` validates a
    // `PUT /api/v1/meta/analytics_cube` body against; a rebinding to some other
    // shape would pass the pins above and still accept the key in production.
    const door = getMetadataTypeSchema('analytics_cube');
    expect(door, 'no schema bound for `analytics_cube`').toBeDefined();
    expect(door).toBe(CubeSchema);
    const r = door!.safeParse({ ...CUBE, measures: { count: { name: 'count', ...METRIC } } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.path).toEqual(['measures', 'count', 'name']);
    expect(r.error.issues[0]!.message).toMatch(METRIC_PRESCRIPTION);
  });

  it('`defineCube()` refuses it with the prescription', () => {
    expect(() => defineCube({ ...CUBE, dimensions: { status: { name: 'status', ...DIMENSION } } } as never))
      .toThrow(DIMENSION_PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never rewrites it', () => {
    const stack = (cube: Record<string, unknown>) => ({
      manifest: { id: 'com.example.cube-member-name', name: 'cube_member_name', version: '1.0.0', type: 'app' },
      analyticsCubes: [cube],
    });
    let thrown: unknown;
    try {
      defineStack(stack({ ...CUBE, measures: { count: { name: 'count', ...METRIC } } }) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['analyticsCubes', 0, 'measures', 'count', 'name']);
    expect(refusal.issues?.[0]?.message).toMatch(METRIC_PRESCRIPTION);
    // CONTROL: the same stack without the key is accepted by the same door.
    expect(() => defineStack(stack({ ...CUBE }) as never)).not.toThrow();
  });

  it('CONTROL: the same cube without the key passes every door, every live key intact', () => {
    const cube = CubeSchema.safeParse(CUBE);
    expect(cube.success).toBe(true);
    if (!cube.success) return;
    // Absence stays absence: the tombstone materializes nothing.
    expect(cube.data.measures.count).not.toHaveProperty('name');
    expect(cube.data.dimensions.status).not.toHaveProperty('name');
    expect(cube.data.measures.count).toEqual(METRIC);
    expect(cube.data.dimensions.status).toEqual(DIMENSION);
    expect(defineCube(CUBE).measures.count).toEqual(METRIC);
  });

  it('the did-you-mean never offers the tombstone: a near-miss `nme` is refused as unknown, not steered onto `name`', () => {
    // `strictObject` excludes a key that accepts nothing from its suggestion
    // pool (`acceptsNothing`), so an author who typed `nme` is not told to
    // write the retired key and meet a second refusal.
    const r = MetricSchema.safeParse({ ...METRIC, nme: 'count' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toContain('`nme`');
    expect(issue.message).not.toMatch(/`nme` → `name`/);
  });

  it('fails tsc at the authoring site: the input type of `name` is `never` on both members', () => {
    const metric: Metric = {
      ...METRIC,
      // @ts-expect-error — `name` is a retiredKey() tombstone: its input type is `never`.
      name: 'count',
    };
    const dimension: Dimension = {
      ...DIMENSION,
      // @ts-expect-error — `name` is a retiredKey() tombstone: its input type is `never`.
      name: 'status',
    };
    const cube: Cube = { ...CUBE, measures: { count: metric }, dimensions: { status: dimension } };
    // The parse channel agrees with the type channel on the same literals.
    expect(() => MetricSchema.parse(metric)).toThrow(METRIC_PRESCRIPTION);
    expect(() => DimensionSchema.parse(dimension)).toThrow(DIMENSION_PRESCRIPTION);
    expect(CubeSchema.safeParse(cube).success).toBe(false);
  });
});

describe('cube member inner name retirement — the D2 conversion', () => {
  it('a STORED `analytics_cube` row carrying the key replays clean through the rehydration seam', () => {
    // The seam wraps an `analytics_cube` row as `{ analyticsCubes: [row] }` and
    // replays the full chain, retired entries included.
    const notices: { conversionId?: string; path?: string; from?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('analytics_cube', persistedCube(), {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string }),
    }) as ReturnType<typeof persistedCube>;

    expect(notices.map((n) => [n.conversionId, n.path, n.from])).toEqual([
      [CONVERSION_ID, 'analyticsCubes[0](orders).measures.count.name', 'name'],
      [CONVERSION_ID, 'analyticsCubes[0](orders).measures.total_amount.name', 'name'],
      [CONVERSION_ID, 'analyticsCubes[0](orders).dimensions.status.name', 'name'],
    ]);
    // CONTROL: every live key on the same members survives byte-for-byte.
    expect(rehydrated.measures.count).toEqual(METRIC);
    expect(rehydrated.measures.total_amount).toEqual({ label: 'Total', type: 'sum', sql: 'amount' });
    expect(rehydrated.dimensions.status).toEqual(DIMENSION);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(CubeSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const artifact = () => ({ analyticsCubes: [persistedCube()] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('was removed in @objectstack/spec 17.5.0');

    const healed = applyConversions(artifact(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(
      after.success,
      `expected the converted artifact to parse; got ${JSON.stringify(after.error?.issues ?? [])}`,
    ).toBe(true);
  });

  it('LIT CONTROL — a member that was always wrong is refused on BOTH sides of the conversion', () => {
    // `nme` is not the retired key, so the strip leaves it and the door still
    // refuses — which is what makes the leg above a reading and not a tautology.
    const artifact = () => {
      const cube = persistedCube() as Record<string, unknown>;
      cube.measures = { count: { name: 'count', nme: 'count', ...METRIC } };
      return { analyticsCubes: [cube] };
    };
    expect(ObjectStackDefinitionSchema.safeParse(artifact()).success).toBe(false);
    const healed = applyConversions(artifact(), { includeRetired: true });
    expect(ObjectStackDefinitionSchema.safeParse(healed).success).toBe(false);
  });

  it('strips a DISAGREEING name too — the key already won — and the notice prints both spellings', () => {
    // The in-memory driver's own fixtures authored this shape and queried
    // `orders.totalAmount`: the key was the name every consumer used, so the
    // strip changes no answer; the notice is what tells the author there were two.
    const input = {
      analyticsCubes: [{
        name: 'orders',
        sql: 'orders',
        measures: { totalAmount: { name: 'total_amount', label: 'Total', type: 'sum', sql: 'amount' } },
        dimensions: { status: DIMENSION },
      }],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(mine.map((n) => [n.path, n.from, n.to])).toEqual([
      [
        'analyticsCubes[0](orders).measures.totalAmount.name',
        'name "total_amount"',
        '(removed; the record key "totalAmount" is the name)',
      ],
    ]);
    const cube = (stack.analyticsCubes as Array<{ measures: Record<string, unknown>; dimensions: unknown }>)[0]!;
    // The KEY stays — the conversion never re-keys a member.
    expect(Object.keys(cube.measures)).toEqual(['totalAmount']);
    expect(cube.measures.totalAmount).toEqual({ label: 'Total', type: 'sum', sql: 'amount' });
    // Copy-on-write: the untouched bag is handed back by reference.
    expect(cube.dimensions).toBe(input.analyticsCubes[0]!.dimensions);
  });

  it('strips only the members that carry the key, and is idempotent by construction', () => {
    const input = {
      analyticsCubes: [
        persistedCube(),
        // A cube already canonical: no notice, and handed back by reference.
        { ...CUBE },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(3);
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

describe('cube member inner name retirement — ADR-0087 registration', () => {
  it('declares both keys under major 18, wires the D2 into the step-18 chain and carries the family D3 entry', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('data/Metric:name');
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('data/Dimension:name');
    const step = MIGRATIONS_BY_MAJOR[18]!;
    expect(step.conversionIds).toContain(CONVERSION_ID);
    const d3 = step.semantic.find((s) => s.id === 'cube-member-inner-name-retired');
    expect(d3, 'the family D3 entry').toBeDefined();
    // The D3 entry names its D2 by its whole id.
    expect(d3!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(d3!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types the key `never` on
// `Metric` and `Dimension`, so every TYPED authoring site fails to compile. The
// residue is what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped
// `.js`, and TS literals typed `any` / `unknown` — which is exactly where the
// in-repo producers were (`Record<string, any>` bags in the ad-hoc cube mints).
// This walk covers that residue across five roots, each already declared for
// `@objectstack/spec#test` in `scripts/cross-package-test-inputs.mjs` and
// mirrored in `turbo.json` — the same roots and extensions the RLS `tags` pin
// walks.
//
// ⭐ `name` is the commonest key in this tree, so a textual matcher would be
// all noise. The matcher is STRUCTURAL instead: an offender is one object
// literal (or one YAML mapping) whose OWN keys include `name`, `sql` and `type`
// — a cube member — AND whose enclosing object is the value of a `measures` or
// `dimensions` key (or of a variable so named). A cube's own `name`, a join's
// `name`, and a dataset's `measures: [{ name, … }]` ARRAY are not matched.
//
// The bound, stated: a member assembled by SPREAD (`{ ...base, name }`),
// assigned into a bag (`bag[key] = { name, … }`) or built under computed keys
// is invisible to a text walk; `docs/**`, `.claude/**`, `.github/**` and the
// repo-root files are outside the radius.
describe('tree-scoped absence: no cube member inside the declared radius still carries an inner name', () => {
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
   * spell the retired key on a member.
   */
  const EXCLUDED = new Set([
    // This pin names the key to assert its absence, and its conversion legs
    // author the pre-retirement persisted shape on purpose.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement member on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // The liveness ledgers key one row per schema PROPERTY, so the `measures` /
    // `dimensions` blocks of `analytics_cube.json` carry `name`, `sql` and
    // `type` rows side by side under `children` — a classification of the
    // shape, not an authoring, and the two `name` rows are the ones the
    // tombstone route requires to STAY.
    'packages/spec/liveness/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const BAGS = new Set(['measures', 'dimensions']);
  const isMemberKeySet = (keys: Set<string>): boolean => keys.has('name') && keys.has('sql') && keys.has('type');

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:` — and remembering the key (or the
   * `const X =` binding) that opened it. Strings and comments are skipped; a
   * single- or double-quoted string never spans a line, so a mis-lexed quote
   * (a regex literal) costs at most that line. Returns the 1-based line of each
   * closing brace whose frame is a member carrying `name` inside a bag.
   * (Copied from the RLS `tags` pin and extended with the opener, never
   * imported: a shared helper would be one point of failure for every
   * retirement's absence leg at once.)
   */
  const lexOffenders = (text: string): number[] => {
    const out: number[] = [];
    const stack: { kind: string; keys: Set<string>; opener?: string; lastKey?: string }[] = [];
    let lastSig = '';
    // `const measures: Record<string, any> = { … }` — the binding a `{` opens
    // under is the name after `const` / `let` / `var`, whatever type annotation
    // sits between it and the `=`.
    let prevIdent = '';
    let pendingDecl = '';
    let boundName = '';
    let line = 1;
    let i = 0;
    const n = text.length;
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
        const top = stack[stack.length - 1];
        if (c !== '`' && text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',')) {
          top.keys.add(token);
          top.lastKey = token;
        }
        lastSig = 'str';
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(text[i]!)) i += 1;
        const token = text.slice(start, i);
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        const top = stack[stack.length - 1];
        if (text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',')) {
          top.keys.add(token);
          top.lastKey = token;
        }
        if (prevIdent === 'const' || prevIdent === 'let' || prevIdent === 'var') pendingDecl = token;
        prevIdent = token;
        lastSig = 'id';
        continue;
      }
      if (c === '=' && text[i + 1] !== '=' && text[i + 1] !== '>' && !'=!<>+-*/%&|^'.includes(text[i - 1] ?? '')) {
        boundName = pendingDecl;
        pendingDecl = '';
      }
      if (c === '{' || c === '[' || c === '(') {
        const parent = stack[stack.length - 1];
        let opener: string | undefined;
        if (c === '{' && lastSig === ':' && parent?.kind === '{') opener = parent.lastKey;
        else if (c === '{' && lastSig === '=') opener = boundName;
        stack.push({ kind: c, keys: new Set(), opener });
      } else if (c === '}' || c === ']' || c === ')') {
        const frame = stack.pop();
        const parent = stack[stack.length - 1];
        if (
          frame?.kind === '{' && c === '}' && isMemberKeySet(frame.keys)
          && parent?.kind === '{' && parent.opener !== undefined && BAGS.has(parent.opener)
        ) out.push(line);
      }
      if (!/\s/.test(c)) lastSig = c;
      i += 1;
    }
    return out;
  };

  /**
   * YAML: a mapping's OWN keys are the key lines at one column, bounded by a
   * line at a smaller column. A member is the mapping under a key whose own
   * parent key is `measures` / `dimensions`. Returns the 1-based line of each
   * `name` key whose mapping is such a member.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:/.exec(raw);
      return m ? { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]!, item: Boolean(m[2]) } : null;
    });
    const parentOf = (at: number): number => {
      const row = rows[at]!;
      for (let k = at - 1; k >= 0; k -= 1) {
        const r = rows[k];
        if (r && r.col < row.col) return k;
      }
      return -1;
    };
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row || row.key !== 'name' || row.item) return;
      const keys = new Set<string>([row.key]);
      for (let k = at - 1; k >= 0; k -= 1) {
        const r = rows[k];
        if (!r) continue;
        if (r.col < row.col) break;
        if (r.col === row.col) keys.add(r.key);
      }
      for (let k = at + 1; k < rows.length; k += 1) {
        const r = rows[k];
        if (!r) continue;
        if (r.col < row.col) break;
        if (r.col === row.col) keys.add(r.key);
      }
      if (!isMemberKeySet(keys)) return;
      const member = parentOf(at);
      if (member < 0 || rows[member]!.item) return;
      const bag = parentOf(member);
      if (bag >= 0 && BAGS.has(rows[bag]!.key)) out.push(row.idx + 1);
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

  /** Cheap pre-filter: a file that never spells a bag and a member's halves cannot hold an offender. */
  const mayHoldMember = (text: string): boolean =>
    (text.includes('measures') || text.includes('dimensions')) && text.includes('name') && text.includes('sql');

  const offendersIn = (ext: string, text: string): number[] => {
    if (!mayHoldMember(text)) return [];
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

  it('the matcher finds a member authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the member spelling, in each syntax the walk reads.
    expect(offendersIn('.ts', "({ measures: { count: { name: 'count', label: 'C', type: 'count', sql: '*' } } })")).toEqual([1]);
    expect(offendersIn('.ts', "defineCube({\n  name: 'o',\n  sql: 'o',\n  dimensions: {\n    status: {\n      name: 'status',\n      type: 'string',\n      sql: 'status',\n    },\n  },\n});")).toEqual([9]);
    expect(offendersIn('.ts', "const measures: Record<string, any> = { total: { name: 'total', type: 'sum', sql: 'amount' } };")).toEqual([1]);
    expect(offendersIn('.json', '{ "measures": { "count": { "name": "count", "type": "count", "sql": "*" } } }')).toEqual([1]);
    expect(offendersIn('.yaml', 'measures:\n  count:\n    name: count\n    type: count\n    sql: "*"\n')).toEqual([3]);
    expect(offendersIn('.md', "Prose.\n\n```ts\n({ dimensions: { d: { type: 'string', sql: 'd', name: 'd' } } });\n```\n")).toEqual([4]);
    expect(offendersIn('.md', 'Prose.\n\n```yaml\ndimensions:\n  d:\n    type: string\n    sql: d\n    name: d\n```\n')).toEqual([8]);
    // Neighbours that must NOT match.
    // A member without the key; a cube's OWN `name` beside its `sql`.
    expect(offendersIn('.ts', "({ name: 'orders', sql: 'orders', measures: { count: { label: 'C', type: 'count', sql: '*' } } })")).toEqual([]);
    // A join's `name` under `joins`, and a dataset's measures ARRAY.
    expect(offendersIn('.ts', "({ joins: { owner: { name: 'sys_user', type: 'x', sql: 'y' } } })")).toEqual([]);
    expect(offendersIn('.ts', "defineDataset({ measures: [{ name: 'n', aggregate: 'count', type: 'x', sql: 'y' }] })")).toEqual([]);
    // The member SHAPE declared in a schema (no enclosing bag), and the
    // `getMeta` projection that WRITES a published `name` into an array.
    expect(offendersIn('.ts', "strictObject({ surface: 'm' }, { name: retiredKey(X), type: T, sql: z.string() })")).toEqual([]);
    expect(offendersIn('.ts', "({ measures: Object.entries(c.measures).map(([k, m]) => ({ name: k, type: m.type, sql: 'x' })) })")).toEqual([]);
    // Prose and quoted strings are not authorings.
    expect(offendersIn('.md', 'A member once took `name`, `type` and `sql` under `measures`.')).toEqual([]);
    expect(offendersIn('.ts', "const s = \"measures: { c: { name: 'c', type: 'count', sql: '*' } }\";")).toEqual([]);
    // A YAML `name` whose mapping is not a bag member.
    expect(offendersIn('.yaml', 'joins:\n  owner:\n    name: sys_user\n    type: x\n    sql: y\n')).toEqual([]);
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

  it('no cube member carrying an inner name survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let bagBearing = 0;
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
        if (mayHoldMember(text) && text.includes('measures') && text.includes('dimensions')) bagBearing += 1;
        for (const lineNo of offendersIn(ext, text)) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold a
    // member were really read.
    expect(visited).toBeGreaterThan(1000);
    expect(bagBearing).toBeGreaterThan(20);
    expect(offenders, 'a cube member carrying an inner `name` means the retirement is being undone').toEqual([]);
  });
});
