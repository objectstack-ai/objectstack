// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16714] `objectNavTargetExclusivity` is EXPORTED, and the export IS the
 * check the navigation door runs — the spec half of the objectui mirror gap.
 *
 * Why: objectui's `NavigationItemSchema` is hand-written (not `.shape`-derived,
 * so the #16489 mechanism does not reach it) and its own `superRefine` checks
 * only `id` / `label`. Its `filters` prose copied a precedence order from this
 * module's docblock, so that door accepted `filters` + `recordId` while the
 * spec's refused it. A mirror needs the rule as a function it can chain, and
 * that function must be the schema's own — never a copy that can drift.
 *
 * What this file pins, and what each leg proves:
 *
 *  1. PARITY over the check's whole matrix — every distinct failure path and
 *     every accepting path — between the export called directly with a
 *     collecting ctx and `NavigationItemSchema`'s own parse. The accepting
 *     paths are the ruling's negative controls: `filters` alone, `recordId`
 *     alone, `viewName` alone and `recordId` + `viewName` all still pass, and
 *     so do `runAction` + `filters` / `viewName`. Those last five are the two
 *     deliberate asymmetries: an implementation that made every target field
 *     pairwise exclusive would turn the refusal legs green while refusing
 *     configurations that are legal today.
 *  2. MOUNT — the `type: 'object'` branch of the union inside
 *     `NavigationItemSchema` carries exactly one `custom` check, and that
 *     check's issue vector over the matrix equals the export's. The exported
 *     `ObjectNavItemSchema` carries NO check and accepts every fixture,
 *     including the refused ones: exporting the function moved no accept set.
 *     A later ruling that mounts the guard there flips that pin deliberately.
 *  3. ATTACHMENT BY IDENTIFIER — the module declares the export exactly once
 *     and chains it by name (`.superRefine(objectNavTargetExclusivity)`)
 *     exactly once, read from the source, so the door cannot be running an
 *     inline copy that merely agrees on this matrix.
 *  4. BARREL identity — `./index` (what `@objectstack/spec/ui` ships) exports
 *     the very same function object, with the `(value, ctx)` arity.
 *
 * What it does NOT prove, stated so nobody reads it in: reference identity
 * between the export and the check object the schema holds — zod 4 wraps the
 * function handed to `superRefine` in a closure and keeps no handle to it.
 * Legs 2 + 3 are the substitute, the same one `object-refinement-check-exports.test.ts`
 * uses for the `check*` family.
 *
 * The fixtures are SHAPE-VALID on purpose (ids of two characters or more,
 * every key declared) and the parse leg throws otherwise, so "both refuse"
 * can never be true for the wrong reason.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NavigationItemSchema, ObjectNavItemSchema, objectNavTargetExclusivity } from './app.zod';
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
  objectNavTargetExclusivity(value as never, ctx as unknown as z.RefinementCtx);
  return sorted(issues.map(sig));
}

interface ZodCheckLike {
  _zod: {
    def: { check: string };
    check: (payload: { value: unknown; issues: RawIssueLike[] }) => unknown;
  };
}

/** The check objects a schema actually holds — read through the lazySchema proxy where there is one. */
function checksOf(schema: unknown): ZodCheckLike[] {
  const def = (schema as { _zod: { def: { checks?: ZodCheckLike[] } } })._zod.def;
  return def.checks ?? [];
}

/** Leg (b): run ONE of the schema's own check objects in isolation. */
function runCheckObject(check: ZodCheckLike, value: unknown): IssueSig[] {
  const payload = { value, issues: [] as RawIssueLike[] };
  check._zod.check(payload);
  return sorted(payload.issues.map(sig));
}

/** Leg (c): a schema's full parse, restricted to object-level (`custom`) issues.
 *  Throws when the fixture is not shape-valid — see the header. */
function runParse(schema: { safeParse: (v: unknown) => z.ZodSafeParseResult<unknown> }, value: unknown): IssueSig[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  const foreign = r.error.issues.filter((i) => i.code !== 'custom');
  if (foreign.length > 0) {
    throw new Error(`fixture is not shape-valid — the object-level check never ran: ${JSON.stringify(foreign)}`);
  }
  return sorted(r.error.issues.map((i) => sig(i as RawIssueLike)));
}

/**
 * The `type: 'object'` branch of the discriminated union `NavigationItemSchema`
 * lazily resolves to — the one place this module chains the guard. Located by
 * the branch's `type` literal, never by position.
 */
function objectBranchOf(schema: unknown): unknown {
  const getter = (schema as { _zod: { def: { getter: () => unknown } } })._zod.def.getter;
  const union = getter() as { _zod: { def: { type: string; options: unknown[] } } };
  expect(union._zod.def.type).toBe('union');
  const branches = union._zod.def.options.filter((opt) => {
    const literal = (opt as { _zod: { def: { shape: { type: { _zod: { def: { values: unknown[] } } } } } } })
      ._zod.def.shape.type._zod.def.values;
    return literal.includes('object');
  });
  expect(branches).toHaveLength(1);
  return branches[0];
}

/** One issue vector per runner over the matrix — the equality's key. */
const vectorOf = (run: (value: unknown) => IssueSig[], values: unknown[]): string =>
  JSON.stringify(values.map(run));

// ---------------------------------------------------------------------------
// Fixture matrix — one entry per distinct failure path, plus every accepting path
// ---------------------------------------------------------------------------

interface Fixture {
  label: string;
  value: Record<string, unknown>;
  /** The paths the check is expected to refuse at; `[]` is an accepting path. */
  refusesAt: string[];
}

const NAV = { id: 'nav_tickets', label: 'Tickets', type: 'object', objectName: 'ticket' } as const;

const fixtures: Fixture[] = [
  // Refusals — the guard's two rules, every distinct path.
  { label: '`filters` + `recordId`', value: { ...NAV, filters: { status: 'open' }, recordId: '{current_user_id}' }, refusesAt: ['filters'] },
  { label: '`filters` + `viewName`', value: { ...NAV, filters: { status: 'open' }, viewName: 'by_status' }, refusesAt: ['filters'] },
  {
    label: '`filters` + `recordId` + `viewName` (one issue, not two)',
    value: { ...NAV, filters: { status: 'open' }, recordId: '{current_user_id}', viewName: 'all' },
    refusesAt: ['filters'],
  },
  { label: '`runAction` + `recordId`', value: { ...NAV, runAction: 'create_ticket', recordId: '{current_user_id}' }, refusesAt: ['runAction'] },
  {
    label: 'both rules at once — `filters` + `runAction` + `recordId`',
    value: { ...NAV, filters: { status: 'open' }, runAction: 'create_ticket', recordId: '{current_user_id}' },
    refusesAt: ['filters', 'runAction'],
  },
  // Negative controls (the ruling's item 4) — each target field alone.
  { label: '`filters` alone', value: { ...NAV, filters: { owner_id: '{current_user_id}', status: 'open' } }, refusesAt: [] },
  { label: '`recordId` alone', value: { ...NAV, recordId: '{current_user_id}' }, refusesAt: [] },
  { label: '`viewName` alone', value: { ...NAV, viewName: 'all' }, refusesAt: [] },
  { label: 'no target field at all (the default view)', value: { ...NAV }, refusesAt: [] },
  // Asymmetry (i): the legacy combination stays tolerated.
  { label: '`recordId` + `viewName` (tolerated legacy combination)', value: { ...NAV, recordId: '{current_user_id}', viewName: 'all' }, refusesAt: [] },
  // Asymmetry (ii): `runAction` is refused with `recordId` ONLY.
  { label: '`runAction` alone', value: { ...NAV, runAction: 'create_ticket' }, refusesAt: [] },
  { label: '`runAction` + `filters`', value: { ...NAV, runAction: 'create_ticket', filters: { status: 'open' } }, refusesAt: [] },
  { label: '`runAction` + `viewName`', value: { ...NAV, runAction: 'create_ticket', viewName: 'all' }, refusesAt: [] },
];

const matrix = fixtures.map((f) => f.value);
const refusing = fixtures.filter((f) => f.refusesAt.length > 0);
const accepting = fixtures.filter((f) => f.refusesAt.length === 0);

// ---------------------------------------------------------------------------
// Leg 1 — parity on every fixture between the export and the door
// ---------------------------------------------------------------------------

describe('objectNavTargetExclusivity — parity between the export and NavigationItemSchema', () => {
  it.each(fixtures)('$label — the direct call refuses at exactly the declared paths', ({ value, refusesAt }) => {
    const direct = runExport(value);
    expect(direct.map((i) => i.path).sort()).toEqual([...refusesAt].sort());
    for (const issue of direct) expect(issue.code).toBe('custom');
  });

  it.each(fixtures)('$label — the NavigationItemSchema parse and the direct call agree issue for issue', ({ value }) => {
    expect(runParse(NavigationItemSchema, value)).toEqual(runExport(value));
  });

  it('the matrix has both kinds of path, so agreement is not vacuous', () => {
    expect(refusing.length).toBeGreaterThanOrEqual(5);
    expect(accepting.length).toBeGreaterThanOrEqual(8);
  });

  it('the refusal message carries the fix, not only the verdict', () => {
    const [filtersIssue] = runExport({ ...NAV, filters: { status: 'open' }, recordId: 'r_1' });
    expect(filtersIssue.message).toContain('pick ONE landing');
    const [runActionIssue] = runExport({ ...NAV, runAction: 'create_ticket', recordId: 'r_1' });
    expect(runActionIssue.message).toMatch(/runAction.*cannot be combined with.*recordId/s);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — the mount: where the check lives, and where it deliberately does not
// ---------------------------------------------------------------------------

describe('the mount — the union branch carries the check, the exported ObjectNavItemSchema does not', () => {
  it("the `type: 'object'` branch of NavigationItemSchema carries exactly one `custom` check", () => {
    const checks = checksOf(objectBranchOf(NavigationItemSchema));
    expect(checks.map((c) => c._zod.def.check)).toEqual(['custom']);
  });

  it('that check is behaviourally identical to the export over the whole matrix', () => {
    const [check] = checksOf(objectBranchOf(NavigationItemSchema));
    expect(vectorOf((v) => runCheckObject(check, v), matrix)).toBe(vectorOf(runExport, matrix));
    // …and the export is not a no-op on its own matrix (an all-empty vector
    // would match any dead check).
    expect(vectorOf(runExport, matrix)).not.toBe(vectorOf(() => [], matrix));
  });

  it('ObjectNavItemSchema carries no object-level check — the export moved no accept set (#16714 ruling)', () => {
    // Deliberate non-change: which schema mounts the check is a separate
    // question from whether a mirror can chain it, and it is NOT decided by
    // this export. A later ruling that mounts the guard on the exported
    // schema flips this pin on purpose; until then every fixture on the
    // matrix — the refused ones included — is accepted here.
    expect(checksOf(ObjectNavItemSchema)).toEqual([]);
    for (const { value } of fixtures) {
      expect(ObjectNavItemSchema.safeParse(value).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — attached by identifier, in the module that declares the schema
// ---------------------------------------------------------------------------

describe('app.zod.ts attaches the export BY IDENTIFIER — no inline copy', () => {
  const src = fs.readFileSync(path.join(HERE, 'app.zod.ts'), 'utf8');
  // An attachment is a CODE line carrying `.superRefine(name)` — here the
  // door chains it mid-line (`}).strict().superRefine(name),`), so unlike the
  // `check*` pin the match is not anchored at line start. Docblock (` * `)
  // and `//` lines are excluded, so prose naming the same spelling is not counted.
  const attachments = (name: string): number =>
    src.split(/\r?\n/).filter((line) => !/^[ \t]*(\*|\/\/)/.test(line) && line.includes(`.superRefine(${name})`)).length;
  // A NAME is only a sound key for that count if the module declares it exactly
  // once — a second, shadowing binding would satisfy the count while the door
  // chains a different function object.
  const declarations = (name: string): number =>
    src.match(new RegExp(`^\\s*(export )?function ${name}\\b`, 'gm'))?.length ?? 0;

  it('declares `export function objectNavTargetExclusivity(` exactly once', () => {
    expect(src).toContain('export function objectNavTargetExclusivity(');
    expect(declarations('objectNavTargetExclusivity')).toBe(1);
  });

  it('chains it exactly once — on the union branch, by name', () => {
    expect(attachments('objectNavTargetExclusivity')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — the barrel ships the same function object
// ---------------------------------------------------------------------------

describe('`./index` (the `@objectstack/spec/ui` surface) exports the same function object', () => {
  it('objectNavTargetExclusivity — reference identity, and the `(value, ctx)` arity', () => {
    expect((ui as Record<string, unknown>).objectNavTargetExclusivity).toBe(objectNavTargetExclusivity);
    expect(typeof objectNavTargetExclusivity).toBe('function');
    expect(objectNavTargetExclusivity.length).toBe(2);
  });
});
