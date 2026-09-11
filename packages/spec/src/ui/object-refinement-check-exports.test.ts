// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16489] Object-level refinement checks are EXPORTED, one per refinement,
 * and each export IS the check its schema runs — the spec half of objectui#7715.
 *
 * Why: objectui derives its zod mirrors from a spec object's `.shape`
 * (`specFieldsExcept(SpecListViewSchema.shape, …)`, six sites at the pinned
 * `.objectui-sha`). `.shape` carries the FIELDS by reference and drops every
 * check attached to the OBJECT, so at 17.3.0 objectui's authoring door accepted
 * `appearance.allowedVisualizations: ['calendar']` with no `calendar:` block
 * while the spec's publish door refused it. A mirror needs the rule as a
 * function it can attach, and that function must be the schema's own — never a
 * copy that can drift.
 *
 * What this file pins, per export, and what each leg proves:
 *
 *  1. PARITY over the check's whole failure matrix — every distinct failure
 *     path and the accepting path — between three runners on the SAME fixture:
 *     (a) the export called directly with a collecting ctx, (b) the schema's
 *     own check object (`_zod.def.checks[i]`) run in isolation, (c) the
 *     schema's full `safeParse`. Agreement on one bad fixture would pass a
 *     weaker copy; agreement on every path, issue for issue, does not.
 *  2. COUNT + BIJECTION — the schema carries exactly as many `custom` checks
 *     as are exported for it, and each export's issue vector over the union
 *     matrix equals exactly one check object's vector and no other's. So there
 *     is no hidden check the exports do not cover, and no export the schema
 *     does not run.
 *  3. ATTACHMENT BY IDENTIFIER — the module attaches the export by name
 *     (`.superRefine(checkX)`), read from the source, so the schema cannot be
 *     running an inline copy that merely agrees on this matrix.
 *  4. BARREL identity — `./index` (what `@objectstack/spec/ui` ships) exports
 *     the very same function object.
 *
 * What it does NOT prove, stated so nobody reads it in: reference identity
 * between the export and the check object the schema holds. zod 4.4.3's
 * `_superRefine(fn)` wraps `fn` in a closure (`ch._zod.check = payload =>
 * fn(payload.value, payload)`) and keeps no handle to `fn`, so the function
 * the schema runs is not observable through zod. Legs 2 + 3 are the
 * substitute: identical behaviour on every path, attached by the exported
 * identifier.
 *
 * The fixtures are SHAPE-VALID on purpose and the parse leg asserts it: zod 4
 * skips object-level checks when the shape itself failed, so a shape-invalid
 * fixture would make "both refuse" true for the wrong reason.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ListViewSchema,
  ObjectListViewSchema,
  checkListViewCalendarVisualization,
} from './view.zod';
import { PageSchema, checkPageSourceCompleteness } from './page.zod';
import {
  GlobalFilterSchema,
  checkGlobalFilterDateDefaultValue,
  DashboardWidgetSchema,
  checkDashboardWidgetStageOrder,
} from './dashboard.zod';
import * as ui from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The projection of an issue this file compares — everything a consumer keys on. */
interface IssueSig {
  code: string;
  path: string;
  message: string;
  params?: unknown;
}

interface RawIssueLike {
  code?: string;
  path?: readonly PropertyKey[];
  message?: string;
  params?: unknown;
}

const sig = (i: RawIssueLike): IssueSig => ({
  code: String(i.code),
  path: (i.path ?? []).map(String).join('.'),
  message: String(i.message),
  ...(i.params !== undefined ? { params: i.params } : {}),
});

const sorted = (issues: IssueSig[]): IssueSig[] =>
  [...issues].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Any exported refinement check — `(value, ctx) => void`, whatever `value` is typed as. */
type RefinementCheck = (value: never, ctx: z.RefinementCtx) => void;

/** Leg (a): call the export directly with a collecting ctx. */
function runExport(check: RefinementCheck, value: unknown): IssueSig[] {
  const issues: RawIssueLike[] = [];
  const ctx = {
    value,
    issues,
    addIssue: (issue: string | RawIssueLike) => {
      issues.push(typeof issue === 'string' ? { code: 'custom', message: issue } : { code: 'custom', ...issue });
    },
  };
  check(value as never, ctx as unknown as z.RefinementCtx);
  return sorted(issues.map(sig));
}

interface ZodCheckLike {
  _zod: {
    def: { check: string };
    check: (payload: { value: unknown; issues: RawIssueLike[] }) => unknown;
  };
}

/** The check objects a schema actually holds — read through the lazySchema proxy. */
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

/** Leg (c): the schema's full parse, restricted to object-level (`custom`) issues.
 *  Throws when the fixture is not shape-valid — see the header. */
function runParse(schema: { safeParse: (v: unknown) => z.ZodSafeParseResult<unknown> }, value: unknown): IssueSig[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  const foreign = r.error.issues.filter((i) => i.code !== 'custom');
  if (foreign.length > 0) {
    throw new Error(
      `fixture is not shape-valid — the object-level check never ran: ${JSON.stringify(foreign)}`,
    );
  }
  return sorted(r.error.issues.map((i) => sig(i as RawIssueLike)));
}

interface Fixture {
  label: string;
  value: Record<string, unknown>;
  /** The paths the check is expected to refuse at; `[]` is the accepting path. */
  refusesAt: string[];
}

interface ExportUnderTest {
  name: string;
  check: RefinementCheck;
  /** Every distinct failure path of THIS check, plus its accepting paths. */
  fixtures: Fixture[];
}

interface MirroredSchema {
  name: string;
  schema: { safeParse: (v: unknown) => z.ZodSafeParseResult<unknown> };
  exports: ExportUnderTest[];
  /** Fixtures that are shape-valid for this schema and exercise NONE of its checks. */
  cleanFixtures: Record<string, unknown>[];
}

/** One issue vector per runner over the union matrix — the bijection's key. */
const vectorOf = (run: (value: unknown) => IssueSig[], values: unknown[]): string =>
  JSON.stringify(values.map(run));

// ---------------------------------------------------------------------------
// Fixture matrices — one entry per distinct failure path, plus accepting paths
// ---------------------------------------------------------------------------

// [#17063] `pageMountFixtures` / `checkListViewPageMount` stood here. The check
// existed only to police the `type: 'page'` mount, and the mount was retired
// under ADR-0049 enforce-or-remove (maintainer ruling 2026-09-09 「撤」) — so the
// export, its three refusal messages and this population went with it. Nothing
// weaker replaced them: the enum refuses the value by name and `pageName` is a
// `retiredKey()` tombstone, both pinned in `view.test.ts`.

const calendarFixtures: Fixture[] = [
  {
    label: "'calendar' allowed with no `calendar:` block",
    value: { type: 'grid', columns: ['name'], appearance: { allowedVisualizations: ['grid', 'calendar'] } },
    refusesAt: ['calendar'],
  },
  {
    label: "'calendar' allowed WITH the block",
    value: {
      type: 'grid',
      columns: ['name'],
      appearance: { allowedVisualizations: ['grid', 'calendar'] },
      calendar: { startDateField: 'due_date' },
    },
    refusesAt: [],
  },
  {
    label: "a switcher without 'calendar'",
    value: { type: 'grid', columns: ['name'], appearance: { allowedVisualizations: ['grid', 'kanban'] } },
    refusesAt: [],
  },
  { label: 'an `appearance` block with no switcher', value: { type: 'grid', columns: ['name'], appearance: {} }, refusesAt: [] },
  { label: 'no `appearance` at all', value: { type: 'grid', columns: ['name'] }, refusesAt: [] },
];

const PAGE_BASE = { name: 'home_page', label: 'Home', type: 'home' } as const;

const pageSourceFixtures: Fixture[] = [
  { label: 'an `html` page with no `source`', value: { ...PAGE_BASE, kind: 'html' }, refusesAt: ['source'] },
  { label: 'a `react` page with a whitespace-only `source`', value: { ...PAGE_BASE, kind: 'react', source: '   ' }, refusesAt: ['source'] },
  { label: 'a `jsx` page with an empty `source`', value: { ...PAGE_BASE, kind: 'jsx', source: '' }, refusesAt: ['source'] },
  { label: 'an `html` page with a `source`', value: { ...PAGE_BASE, kind: 'html', source: 'Card' }, refusesAt: [] },
  { label: 'a `full` page with no `source`', value: { ...PAGE_BASE, kind: 'full' }, refusesAt: [] },
  { label: 'a page with no `kind` (the `full` default)', value: { ...PAGE_BASE }, refusesAt: [] },
];

const DATE_FILTER = { field: 'created_at', type: 'date' } as const;

const dateDefaultFixtures: Fixture[] = [
  { label: 'an unknown preset name', value: { ...DATE_FILTER, defaultValue: 'last_7_dayz' }, refusesAt: ['defaultValue'] },
  { label: 'a number', value: { ...DATE_FILTER, defaultValue: 42 }, refusesAt: ['defaultValue'] },
  { label: 'a boolean', value: { ...DATE_FILTER, defaultValue: true }, refusesAt: ['defaultValue'] },
  { label: 'a wrapped token that is not a macro', value: { ...DATE_FILTER, defaultValue: '{not_a_macro}' }, refusesAt: ['defaultValue'] },
  { label: 'a preset name', value: { ...DATE_FILTER, defaultValue: 'last_7_days' }, refusesAt: [] },
  { label: 'an ISO date', value: { ...DATE_FILTER, defaultValue: '2026-01-15' }, refusesAt: [] },
  { label: 'an ISO date-time', value: { ...DATE_FILTER, defaultValue: '2026-01-15T08:30:00Z' }, refusesAt: [] },
  { label: 'a date-macro token', value: { ...DATE_FILTER, defaultValue: '{today}' }, refusesAt: [] },
  { label: 'no `defaultValue`', value: { ...DATE_FILTER }, refusesAt: [] },
  { label: 'a non-date filter with the bad spelling', value: { field: 'period', type: 'select', defaultValue: 'last_7_dayz' }, refusesAt: [] },
];

/**
 * The widget base every stage-order fixture builds on — shape-valid on purpose
 * (`id` two characters or more, a `dataset`, at least one `values` member), for
 * the reason the file header gives: zod 4 skips object-level checks when the
 * shape itself failed, so a shape-invalid fixture would make "refused" true for
 * the wrong reason.
 */
const WIDGET = { id: 'stage_widget', dataset: 'contracts', dimensions: ['status'], values: ['count'] } as const;

const stageOrderFixtures: Fixture[] = [
  {
    label: '`stageOrder` on a widget type that does not read it',
    value: { ...WIDGET, type: 'horizontal-bar', options: { stageOrder: ['draft', 'approved'] } },
    refusesAt: ['options.stageOrder'],
  },
  {
    label: '`stageOrder` on a second non-funnel type — the message interpolates, the check does not',
    value: { ...WIDGET, type: 'pie', options: { stageOrder: ['draft'] } },
    refusesAt: ['options.stageOrder'],
  },
  {
    label: '`stageOrder` on a widget that declares NO type (the `metric` default)',
    value: { ...WIDGET, options: { stageOrder: ['draft'] } },
    refusesAt: ['options.stageOrder'],
  },
  {
    label: '`stageOrder` on the one type that reads it',
    value: { ...WIDGET, type: 'funnel', options: { stageOrder: ['draft', 'approved'] } },
    refusesAt: [],
  },
  {
    label: 'a non-funnel carrying the SIBLING options, which every type reads',
    value: { ...WIDGET, type: 'horizontal-bar', options: { sortBy: 'count', sortOrder: 'desc', limit: 10 } },
    refusesAt: [],
  },
  { label: 'a non-funnel with no `options` at all', value: { ...WIDGET, type: 'horizontal-bar' }, refusesAt: [] },
];

// ---------------------------------------------------------------------------
// The population — every mirrored spec object that carries an object-level check
// ---------------------------------------------------------------------------

const listViewExports: ExportUnderTest[] = [
  { name: 'checkListViewCalendarVisualization', check: checkListViewCalendarVisualization, fixtures: calendarFixtures },
];

const MIRRORED: MirroredSchema[] = [
  { name: 'ListViewSchema', schema: ListViewSchema, exports: listViewExports, cleanFixtures: [{ type: 'grid', columns: ['name'] }] },
  // `objects[].listViews.*` re-attaches the same check (zod 4 refuses
  // `.omit()` on a refined object, so the door cannot inherit it). Pinned
  // here too so a second copy cannot appear at the ADR-0047 authoring door.
  { name: 'ObjectListViewSchema', schema: ObjectListViewSchema, exports: listViewExports, cleanFixtures: [{ type: 'grid', columns: ['name'] }] },
  {
    name: 'PageSchema',
    schema: PageSchema,
    exports: [{ name: 'checkPageSourceCompleteness', check: checkPageSourceCompleteness, fixtures: pageSourceFixtures }],
    cleanFixtures: [{ ...PAGE_BASE }],
  },
  {
    name: 'GlobalFilterSchema',
    schema: GlobalFilterSchema,
    exports: [{ name: 'checkGlobalFilterDateDefaultValue', check: checkGlobalFilterDateDefaultValue, fixtures: dateDefaultFixtures }],
    cleanFixtures: [{ field: 'created_at', type: 'date' }],
  },
  // `dashboard.widgets[]` is mirrored the same way and for the same reason, so
  // the ADR-0049 `stageOrder` type gate belongs in this catalogue: measured at
  // the `.objectui-sha` pin `53ded82bf7a494f54e344e19099dbf00854b8694`,
  // objectui's `packages/types/src/zod/complex.zod.ts` builds its own
  // `DashboardWidgetSchema` from
  // `specFieldsExcept(SpecDashboardWidgetSchema.shape, …)` — a `.shape` spread,
  // which carries the FIELDS and drops every object-level check. That mirror
  // re-attaches none of these exports today, which is a live gap recorded on
  // the check's own docblock rather than a reason to leave the export
  // uncatalogued: an export nothing pins here can drift away from the rule the
  // door runs, and then a mirror that DOES re-attach it re-attaches the drift.
  {
    name: 'DashboardWidgetSchema',
    schema: DashboardWidgetSchema,
    exports: [{ name: 'checkDashboardWidgetStageOrder', check: checkDashboardWidgetStageOrder, fixtures: stageOrderFixtures }],
    cleanFixtures: [{ ...WIDGET, type: 'horizontal-bar' }],
  },
];

// ---------------------------------------------------------------------------
// Leg 1 — parity on every fixture, per export, per door
// ---------------------------------------------------------------------------

describe.each(MIRRORED)('$name — parity between the exported checks and the schema', ({ schema, exports }) => {
  const unionMatrix = exports.flatMap((e) => e.fixtures.map((f) => f.value));

  describe.each(exports)('$name', ({ check, fixtures }) => {
    it.each(fixtures)('$label — the direct call refuses at exactly the declared paths', ({ value, refusesAt }) => {
      const direct = runExport(check, value);
      expect(direct.map((i) => i.path).sort()).toEqual([...refusesAt].sort());
      for (const issue of direct) expect(issue.code).toBe('custom');
    });

    it.each(fixtures)('$label — the schema parse and the direct call agree issue for issue', ({ value }) => {
      // The parse runs EVERY check on the object; the other exports' issues on
      // this fixture are subtracted so the comparison is about THIS export.
      const others = exports.filter((e) => e.check !== check);
      const expected = sorted([
        ...runExport(check, value),
        ...others.flatMap((o) => runExport(o.check, value)),
      ]);
      expect(runParse(schema, value)).toEqual(expected);
    });
  });

  // Leg 2 — count + bijection.
  it('carries exactly one `custom` check per export, and no other check', () => {
    const checks = checksOf(schema);
    expect(checks.map((c) => c._zod.def.check)).toEqual(exports.map(() => 'custom'));
  });

  it('each export is behaviourally identical to exactly ONE of the checks the schema holds (a bijection over the union matrix)', () => {
    const checks = checksOf(schema);
    const exportVectors = exports.map((e) => vectorOf((v) => runExport(e.check, v), unionMatrix));
    const checkVectors = checks.map((c) => vectorOf((v) => runCheckObject(c, v), unionMatrix));

    // Every export vector appears among the check vectors exactly once, and
    // vice versa — the two multisets are equal.
    expect([...checkVectors].sort()).toEqual([...exportVectors].sort());
    // …and the matching is discriminating: no two exports collapse to the same
    // vector, or "exactly one" would be vacuous.
    expect(new Set(exportVectors).size).toBe(exports.length);
    // No export is a no-op on its own matrix (a vector of all-empty issue lists
    // would match any dead check).
    for (const [i, e] of exports.entries()) {
      expect(exportVectors[i], `${e.name} refuses nothing on its own matrix`).not.toBe(
        vectorOf(() => [], unionMatrix),
      );
    }
  });

  it('accepts its clean fixtures — the export is additive, the accept set did not move', () => {
    for (const value of MIRRORED.find((m) => m.schema === schema)!.cleanFixtures) {
      expect(runParse(schema, value)).toEqual([]);
      for (const e of exports) expect(runExport(e.check, value)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — attached by identifier, in the module that declares the schema
// ---------------------------------------------------------------------------

describe('each schema attaches its export BY IDENTIFIER — no inline copy', () => {
  const read = (file: string) => fs.readFileSync(path.join(HERE, file), 'utf8');
  // An attachment is a CODE line that begins (after indentation) with
  // `.superRefine(name)` — every door chains the check on its own line. A
  // docblock that names the same spelling as guidance for a mirror sits on a
  // ` * ` line and is not counted, so no comment handling is needed here.
  const attachments = (src: string, name: string): number =>
    src.match(new RegExp(`^[ \\t]*\\.superRefine\\(${name}\\)`, 'gm'))?.length ?? 0;

  // …and a NAME is only a sound key for that count if the module declares it exactly
  // once. `attachments()` and the `toContain` lines below both key on the spelling:
  // a second, shadowing binding of the same name — a local `function checkX` inside
  // another function, say — satisfies every one of them while the door chains a
  // different function object, and if it happened to agree on the fixture matrix it
  // would satisfy leg 2 as well. Measured on the diff that added this: four names,
  // one declaration each — so this closes a residual hole in the pin, it does not fix
  // a live shadowing (#16715). It must stay green.
  const declarations = (src: string, name: string): number =>
    src.match(new RegExp(`^\\s*(export )?function ${name}\\b`, 'gm'))?.length ?? 0;

  it('view.zod.ts declares the export and chains it onto ListViewShapeSchema for ListViewSchema', () => {
    const src = read('view.zod.ts');
    expect(src).toContain('export function checkListViewCalendarVisualization(');
    // Exactly one declaration — the count below keys on this name.
    expect(declarations(src, 'checkListViewCalendarVisualization')).toBe(1);
    // The mirrored door, exactly: shape → calendar check.
    expect(src).toMatch(
      /ListViewShapeSchema\s*\.superRefine\(checkListViewCalendarVisualization\)/,
    );
    // Three doors (authoring terminal, `objects[].listViews.*`, the flattened
    // overlay) attach the check — `viewDoorsCarryingObjectLevelChecks` in
    // view.test.ts pins the behaviour; this pins that every attachment is the
    // export, by name, and none is an inline copy.
    expect(attachments(src, 'checkListViewCalendarVisualization')).toBe(3);
    // [#17063] `checkListViewPageMount` was retired with the `type: 'page'`
    // mount it policed, so neither a declaration nor an attachment of it may
    // return: a re-attachment would be a check with no rule left to enforce.
    // Counted, not `toContain`-ed — the file's own tombstone docblock names the
    // retired check in prose on purpose, and a mention is not a relapse.
    expect(declarations(src, 'checkListViewPageMount')).toBe(0);
    expect(attachments(src, 'checkListViewPageMount')).toBe(0);
  });

  it('page.zod.ts declares the export and attaches it to PageSchema', () => {
    const src = read('page.zod.ts');
    expect(src).toContain('export function checkPageSourceCompleteness(');
    expect(declarations(src, 'checkPageSourceCompleteness')).toBe(1);
    expect(attachments(src, 'checkPageSourceCompleteness')).toBe(1);
  });

  it('dashboard.zod.ts declares the export and attaches it to GlobalFilterSchema', () => {
    const src = read('dashboard.zod.ts');
    expect(src).toContain('export function checkGlobalFilterDateDefaultValue(');
    expect(declarations(src, 'checkGlobalFilterDateDefaultValue')).toBe(1);
    expect(attachments(src, 'checkGlobalFilterDateDefaultValue')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — the barrel ships the same function objects, one per refinement
// ---------------------------------------------------------------------------

describe('`./index` (the `@objectstack/spec/ui` surface) exports the same function objects', () => {
  // NOT the full export list: `checkDashboardWidgetStageOrder` is catalogued in
  // `MIRRORED` above (legs 1-2) and carries its own legs 3-4 — barrel identity
  // and attached-by-identifier — beside the schema it guards, in
  // `dashboard.test.ts`. Read this `it.each` as the rows that live here, not as
  // an enumeration of every exported refinement.
  it.each([
    ['checkListViewCalendarVisualization', checkListViewCalendarVisualization],
    ['checkPageSourceCompleteness', checkPageSourceCompleteness],
    ['checkGlobalFilterDateDefaultValue', checkGlobalFilterDateDefaultValue],
  ] as const)('%s — reference identity, and the `(value, ctx)` arity', (name, fn) => {
    expect((ui as Record<string, unknown>)[name]).toBe(fn);
    expect(typeof fn).toBe('function');
    expect(fn.length).toBe(2);
  });

  // [#17063] The retired member, from the same surface, in the same leg. A
  // downstream mirror re-attaching a check it imports from here is the whole
  // point of this file, so the barrel is where a relapse would first become
  // reachable — the runtime namespace answers it, with the three survivors
  // above as the lit control that the namespace is really populated.
  it('no longer exports `checkListViewPageMount` — retired with the mount it policed', () => {
    expect('checkListViewPageMount' in (ui as Record<string, unknown>)).toBe(false);
  });
});
