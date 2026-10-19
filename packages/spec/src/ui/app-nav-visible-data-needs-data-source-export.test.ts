// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24534] `navItemVisibleDataNeedsDataSource` is EXPORTED, and the export IS
 * the check `NavigationItemSchema` runs, so a hand-written mirror of the
 * navigation item attaches the spec's own rule by identifier instead of
 * restating it. The rule itself (what is refused, where, and with which
 * words) is pinned in `app-nav-visible-data-needs-data-source.test.ts`; this
 * file pins only the export, on the same four legs as
 * `app-nav-target-exclusivity-export.test.ts`, plus the export's input
 * contract:
 *
 *  1. PARITY over the check's matrix (every refusing branch and every
 *     accepting path) between the export called directly with a collecting
 *     ctx and `NavigationItemSchema`'s own parse. The matrix authors `visible`
 *     as the `{ dialect, source }` envelope, the one spelling whose parsed
 *     value equals what was written, so the two runners read the same input.
 *  2. MOUNT: the union `NavigationItemSchema` lazily resolves to carries
 *     exactly one `custom` check, and that check's issue vector over the
 *     matrix equals the export's.
 *  3. ATTACHMENT BY IDENTIFIER: the module declares the export exactly once
 *     and chains it by name exactly once, read from the source, so the door
 *     cannot be running an inline copy that merely agrees on this matrix.
 *  4. BARREL identity: `./index` (what `@objectstack/spec/ui` ships) exports
 *     the very same function object, with the `(value, ctx)` arity.
 *  5. BOTH SPELLINGS: the export accepts `visible` as authored (the bare
 *     string a mirror whose own `visible` stays the authored string hands it)
 *     and as parsed (the envelope the spec's door hands it), and answers the
 *     same on both. The card's own entry as written draws the door's identical
 *     issue from a direct call, and so does its parsed `visible`. Over the leg-1
 *     matrix rewritten with bare strings, the direct call and the door agree
 *     issue for issue. The same bare string with a `dataSource` draws nothing,
 *     and neither does a boolean or absent `visible`. So a mirror attaches the
 *     export as it is, by identifier.
 *
 * What it does NOT prove: reference identity between the export and the
 * check object the schema holds. zod 4 wraps the function handed to
 * `superRefine` in a closure and keeps no handle to it; legs 2 + 3 are the
 * substitute, as in the two sibling export pins.
 *
 * The fixtures are SHAPE-VALID on purpose and the parse leg throws otherwise,
 * so "both refuse" can never be true for the wrong reason.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NavigationItemSchema, navItemVisibleDataNeedsDataSource } from './app.zod';
import { EvaluatedExpressionInputSchema } from '../shared/expression.zod';
import * as ui from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface IssueSig {
  code: string;
  path: string;
  message: string;
}

interface RawIssueLike {
  code?: string;
  path?: readonly PropertyKey[];
  message?: string;
}

const sig = (i: RawIssueLike): IssueSig => ({
  code: String(i.code),
  path: (i.path ?? []).map(String).join('.'),
  message: String(i.message),
});

const sorted = (issues: IssueSig[]): IssueSig[] =>
  [...issues].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Leg (a): call the export directly with a collecting ctx. */
function runExport(value: unknown): IssueSig[] {
  const issues: RawIssueLike[] = [];
  const ctx = {
    value,
    issues,
    addIssue: (issue: string | RawIssueLike) => {
      issues.push(typeof issue === 'string' ? { code: 'custom', message: issue } : { code: 'custom', ...issue });
    },
  };
  navItemVisibleDataNeedsDataSource(value, ctx as unknown as z.RefinementCtx);
  return sorted(issues.map(sig));
}

interface ZodCheckLike {
  _zod: {
    def: { check: string };
    check: (payload: { value: unknown; issues: RawIssueLike[] }) => unknown;
  };
}

/** Leg (b): run ONE of the schema's own check objects in isolation. */
function runCheckObject(check: ZodCheckLike, value: unknown): IssueSig[] {
  const payload = { value, issues: [] as RawIssueLike[] };
  check._zod.check(payload);
  return sorted(payload.issues.map(sig));
}

/** Leg (c): the door's full parse, restricted to object-level (`custom`) issues.
 *  Throws when the fixture is not shape-valid — see the header. */
function runParse(value: unknown): IssueSig[] {
  const r = NavigationItemSchema.safeParse(value);
  if (r.success) return [];
  const foreign = r.error.issues.filter((i) => i.code !== 'custom');
  if (foreign.length > 0) {
    throw new Error(`fixture is not shape-valid — the object-level check never ran: ${JSON.stringify(foreign)}`);
  }
  return sorted(r.error.issues.map((i) => sig(i as RawIssueLike)));
}

/**
 * The checks held by the discriminated union `NavigationItemSchema` lazily
 * resolves to — the one place this module chains the refinement (its
 * branches carry their own checks; those are not this export's).
 */
function unionChecksOf(schema: unknown): ZodCheckLike[] {
  const lazyDef = (schema as { _zod: { def: { type: string; getter: () => unknown } } })._zod.def;
  expect(lazyDef.type).toBe('lazy');
  const union = lazyDef.getter() as { _zod: { def: { type: string; checks?: ZodCheckLike[] } } };
  expect(union._zod.def.type).toBe('union');
  return union._zod.def.checks ?? [];
}

/** One issue vector per runner over the matrix — the equality's key. */
const vectorOf = (run: (value: unknown) => IssueSig[], values: unknown[]): string =>
  JSON.stringify(values.map(run));

// ---------------------------------------------------------------------------
// Fixture matrix — every refusing branch, plus every accepting path
// ---------------------------------------------------------------------------

interface Fixture {
  label: string;
  value: Record<string, unknown>;
  /** The paths the check is expected to refuse at; `[]` is an accepting path. */
  refusesAt: string[];
}

/** The card's entry, as written there. */
const CARD_ENTRY = { id: 'nav_envs', type: 'object', objectName: 'sys_environment', visible: 'data.total == 1' } as const;
const API_BINDING = { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.environments' } as const;
const cel = (source: string) => ({ dialect: 'cel', source }) as const;

const fixtures: Fixture[] = [
  // Refusals — the one rule, on the branches that spread the base.
  { label: 'the card\'s entry, `visible` as the envelope', value: { ...CARD_ENTRY, visible: cel('data.total == 1') }, refusesAt: ['visible'] },
  { label: 'a `dashboard` entry', value: { id: 'nav_ops', type: 'dashboard', dashboardName: 'ops', visible: cel('!data.has_more') }, refusesAt: ['visible'] },
  { label: 'a `url` entry reading the bare root', value: { id: 'nav_cloud', type: 'url', url: '/apps/cloud', visible: cel('data') }, refusesAt: ['visible'] },
  { label: 'a `group` entry', value: { id: 'nav_group', type: 'group', children: [], visible: cel('has(data.total)') }, refusesAt: ['visible'] },
  // Accepting paths — the control the card names, and the reader's edges.
  { label: 'the card\'s entry WITH a `dataSource` (the control)', value: { ...CARD_ENTRY, visible: cel('data.total == 1'), dataSource: API_BINDING }, refusesAt: [] },
  { label: 'an ambient root only (`current_user`)', value: { ...CARD_ENTRY, visible: cel('\'org_admin\' in current_user.positions') }, refusesAt: [] },
  { label: 'a member named `data`, not the root', value: { ...CARD_ENTRY, visible: cel('features.data == true') }, refusesAt: [] },
  { label: 'no `visible` at all', value: { id: 'nav_envs', type: 'object', objectName: 'sys_environment' }, refusesAt: [] },
];

const matrix = fixtures.map((f) => f.value);
const refusing = fixtures.filter((f) => f.refusesAt.length > 0);
const accepting = fixtures.filter((f) => f.refusesAt.length === 0);

// ---------------------------------------------------------------------------
// Leg 1 — parity on every fixture between the export and the door
// ---------------------------------------------------------------------------

describe('navItemVisibleDataNeedsDataSource — parity between the export and NavigationItemSchema', () => {
  it.each(fixtures)('$label — the direct call refuses at exactly the declared paths', ({ value, refusesAt }) => {
    const direct = runExport(value);
    expect(direct.map((i) => i.path).sort()).toEqual([...refusesAt].sort());
    for (const issue of direct) expect(issue.code).toBe('custom');
  });

  it.each(fixtures)('$label — the NavigationItemSchema parse and the direct call agree issue for issue', ({ value }) => {
    expect(runParse(value)).toEqual(runExport(value));
  });

  it('the matrix has both kinds of path, so agreement is not vacuous', () => {
    expect(refusing.length).toBeGreaterThanOrEqual(4);
    expect(accepting.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — the mount: the union carries the check
// ---------------------------------------------------------------------------

describe('the mount — the union NavigationItemSchema resolves to carries the check', () => {
  it('carries exactly one `custom` check', () => {
    expect(unionChecksOf(NavigationItemSchema).map((c) => c._zod.def.check)).toEqual(['custom']);
  });

  it('that check is behaviourally identical to the export over the whole matrix', () => {
    const [check] = unionChecksOf(NavigationItemSchema);
    expect(vectorOf((v) => runCheckObject(check, v), matrix)).toBe(vectorOf(runExport, matrix));
    // …and the export is not a no-op on its own matrix (an all-empty vector
    // would match any dead check).
    expect(vectorOf(runExport, matrix)).not.toBe(vectorOf(() => [], matrix));
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — attached by identifier, in the module that declares the schema
// ---------------------------------------------------------------------------

describe('app.zod.ts attaches the export BY IDENTIFIER — no inline copy', () => {
  const src = fs.readFileSync(path.join(HERE, 'app.zod.ts'), 'utf8');
  // An attachment is a CODE line carrying `.superRefine(name)`; docblock
  // (` * `) and `//` lines are excluded, so prose naming the same spelling is
  // not counted.
  const attachments = (name: string): number =>
    src.split(/\r?\n/).filter((line) => !/^[ \t]*(\*|\/\/)/.test(line) && line.includes(`.superRefine(${name})`)).length;
  // A NAME is only a sound key for that count if the module declares it exactly
  // once — a second, shadowing binding would satisfy the count while the door
  // chains a different function object.
  const declarations = (name: string): number =>
    src.match(new RegExp(`^\\s*(export )?function ${name}\\b`, 'gm'))?.length ?? 0;

  it('declares `export function navItemVisibleDataNeedsDataSource(` exactly once', () => {
    expect(src).toContain('export function navItemVisibleDataNeedsDataSource(');
    expect(declarations('navItemVisibleDataNeedsDataSource')).toBe(1);
  });

  it('chains it exactly once — on the union, by name', () => {
    expect(attachments('navItemVisibleDataNeedsDataSource')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — the barrel ships the same function object
// ---------------------------------------------------------------------------

describe('`./index` (the `@objectstack/spec/ui` surface) exports the same function object', () => {
  it('navItemVisibleDataNeedsDataSource — reference identity, and the `(value, ctx)` arity', () => {
    expect((ui as Record<string, unknown>).navItemVisibleDataNeedsDataSource).toBe(navItemVisibleDataNeedsDataSource);
    expect(typeof navItemVisibleDataNeedsDataSource).toBe('function');
    expect(navItemVisibleDataNeedsDataSource.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Leg 5 — both spellings: the export reads `visible` as authored and as parsed
// ---------------------------------------------------------------------------

/** The leg-1 matrix with each envelope `visible` written back as the bare string an author writes. */
const authoredFixtures: Fixture[] = fixtures
  .filter((f) => f.value.visible !== undefined)
  .map((f) => ({
    ...f,
    label: `${f.label}, \`visible\` written as the bare string`,
    value: { ...f.value, visible: (f.value.visible as { source: string }).source },
  }));

describe('both spellings — the export reads `visible` as authored and as parsed, and answers the same', () => {
  const parsedVisible = EvaluatedExpressionInputSchema.parse(CARD_ENTRY.visible);

  it('the spec normalises the bare string to the envelope the check reads', () => {
    expect(parsedVisible).toEqual(cel('data.total == 1'));
  });

  it('the door refuses the card\'s entry as written, with one `custom` issue at `visible`', () => {
    const door = runParse(CARD_ENTRY);
    expect(door).toHaveLength(1);
    expect(door[0]).toMatchObject({ code: 'custom', path: 'visible' });
  });

  it('the export raises the identical issue on that entry\'s parsed `visible`', () => {
    expect(runExport({ ...CARD_ENTRY, visible: parsedVisible })).toEqual(runParse(CARD_ENTRY));
  });

  it('the export raises the door\'s identical issue (code, path and message) on the card\'s entry AS WRITTEN', () => {
    const direct = runExport(CARD_ENTRY);
    expect(direct).toHaveLength(1);
    expect(direct).toEqual(runParse(CARD_ENTRY));
  });

  it.each(authoredFixtures)('$label — the direct call refuses at exactly the declared paths, issue for issue with the door', ({ value, refusesAt }) => {
    const direct = runExport(value);
    expect(direct.map((i) => i.path).sort()).toEqual([...refusesAt].sort());
    expect(runParse(value)).toEqual(direct);
  });

  it('the authored matrix has both kinds of path, so agreement is not vacuous', () => {
    expect(authoredFixtures.filter((f) => f.refusesAt.length > 0).length).toBeGreaterThanOrEqual(4);
    expect(authoredFixtures.filter((f) => f.refusesAt.length === 0).length).toBeGreaterThanOrEqual(3);
  });

  it('the control — the same bare string with a `dataSource` — draws nothing, from the door or the export', () => {
    const withSource = { ...CARD_ENTRY, dataSource: API_BINDING };
    expect(NavigationItemSchema.safeParse(withSource).success).toBe(true);
    expect(runExport(withSource)).toEqual([]);
    expect(runExport({ ...withSource, visible: parsedVisible })).toEqual([]);
  });

  it('a boolean or absent `visible` judges nothing', () => {
    expect(runExport({ ...CARD_ENTRY, visible: true })).toEqual([]);
    expect(runExport({ ...CARD_ENTRY, visible: false })).toEqual([]);
    expect(runExport({ id: CARD_ENTRY.id, type: CARD_ENTRY.type, objectName: CARD_ENTRY.objectName })).toEqual([]);
  });
});
