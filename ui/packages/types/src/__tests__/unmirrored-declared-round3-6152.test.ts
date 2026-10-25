/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 3 — the declared-but-unmirrored keys this round closed on
 * four pairs, and the `page` spelling it retired.
 *
 * ## What moved
 *
 * `UnmirroredDeclared` in `zod-mirror-parity.test.ts` recorded keys the
 * TypeScript face invites an author to write and the zod mirror had never heard
 * of. Two faces paid for each one:
 *
 *   - the TOLERANT face (`BaseSchema` is `.passthrough()`) kept any value at the
 *     key unexamined, so a wrong-typed value parsed green;
 *   - the STRICT authoring face (`StrictAnyComponentSchema`, derived from the
 *     mirrors) refused the key outright although `tsc` accepted it.
 *
 * Each key below was measured READ before it was mirrored (a type-checker census
 * over every package's sources; the readings are in objectui#6152's round-3
 * report). This file pins the result, not the census:
 *
 *   - a VALID value parses on BOTH faces (the strict leg is the one that moved:
 *     refused, now accepted);
 *   - a WRONG-TYPED value is refused AT THE KEY on the tolerant face (the leg that
 *     moved the other way: kept unexamined, now refused).
 *
 * `PaginationSchema.page` is the other half of the pagination row: a second
 * spelling of `currentPage`, RETIRED on both faces in the same change, so it is
 * refused by name on the mirror and is a `tsc` error on the interface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { PaginationSchema as TsPaginationSchema } from '../navigation';
import { PaginationSchema as PaginationMirror } from '../zod/navigation.zod.js';
import { FormSchema as FormMirror } from '../zod/form.zod.js';
import { ReportComponentSchema as ReportMirror } from '../zod/reports.zod.js';
import { DetailViewSchema as DetailViewMirror } from '../zod/views.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

type Row = { key: string; valid: unknown; wrong: unknown };
type Pair = {
  name: string;
  mirror: { shape: Record<string, unknown>; safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } } };
  base: Record<string, unknown>;
  rows: Row[];
};

const PAIRS: Pair[] = [
  {
    name: 'pagination',
    mirror: PaginationMirror as unknown as Pair['mirror'],
    base: { type: 'pagination', totalPages: 10 },
    rows: [{ key: 'currentPage', valid: 3, wrong: 'three' }],
  },
  {
    name: 'form',
    mirror: FormMirror as unknown as Pair['mirror'],
    base: { type: 'form', fields: [{ name: 'first_name', label: 'First name' }, { name: 'last_name', label: 'Last name' }] },
    rows: [
      { key: 'mobileStickyActions', valid: true, wrong: 'yes' },
      { key: 'fieldContainerClass', valid: 'grid grid-cols-2 gap-4', wrong: 2 },
      {
        key: 'fieldTabs',
        valid: [
          { key: 'a', label: 'A', fields: ['first_name'] },
          { key: 'b', fields: ['last_name'], containerClass: 'space-y-2', visibleWhen: { dialect: 'cel', source: 'record.kind == "b2b"' } },
        ],
        wrong: [{ label: 'no key', fields: ['first_name'] }],
      },
      { key: 'defaultFieldTab', valid: 'b', wrong: 2 },
      { key: 'fieldTabsPosition', valid: 'left', wrong: 'middle' },
      {
        key: 'fieldPanes',
        valid: [
          { key: 'left', fields: ['first_name'], defaultSize: 40, minSize: 20 },
          { key: 'right', fields: ['last_name'] },
        ],
        wrong: [{ key: 'left', fields: 'first_name' }],
      },
      { key: 'fieldPanesOrientation', valid: 'vertical', wrong: 'diagonal' },
      { key: 'fieldPanesResizable', valid: false, wrong: 'false' },
    ],
  },
  {
    name: 'report',
    mirror: ReportMirror as unknown as Pair['mirror'],
    base: { type: 'report', title: 'Pipeline' },
    rows: [
      {
        key: 'conditionalFormatting',
        valid: [{ field: 'amount', operator: 'greater_than', value: 1000, backgroundColor: '#fee2e2', textColor: '#991b1b' }],
        wrong: [{ field: 'amount', operator: 'between', value: 1000 }],
      },
    ],
  },
  {
    name: 'detail-view',
    mirror: DetailViewMirror as unknown as Pair['mirror'],
    base: { type: 'detail-view', objectName: 'account' },
    rows: [
      { key: 'primaryField', valid: 'name', wrong: 7 },
      { key: 'summaryFields', valid: ['status', 'owner'], wrong: 'status' },
      { key: 'autoTabs', valid: true, wrong: 'on' },
      { key: 'defaultTab', valid: 'activity', wrong: 1 },
      {
        key: 'sectionGroups',
        valid: [{ title: 'Company', collapsible: true, defaultCollapsed: false, sections: [{ title: 'Basics', fields: [{ name: 'name' }] }] }],
        wrong: [{ description: 'no title', sections: [] }],
      },
      {
        key: 'highlightFields',
        valid: [{ name: 'industry', label: 'Industry', type: 'select', icon: 'Factory', readonly: true }],
        wrong: [{ name: 'industry', label: 'Industry', type: 'hologram' }],
      },
    ],
  },
];

const ROWS = PAIRS.flatMap((pair) => pair.rows.map((row) => ({ ...row, pair })));

describe('objectui#6152 round 3 — declared keys the mirrors now declare', () => {
  it.each(PAIRS)('CONTROL: the minimal `$name` document parses on both faces', ({ base }) => {
    expect(AnyComponentSchema.safeParse(base).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(base);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
  });

  it.each(ROWS)('`$pair.name`.`$key` is a member of the mirror', ({ key, pair }) => {
    expect(key in pair.mirror.shape).toBe(true);
  });

  it.each(ROWS)('an authored `$pair.name`.`$key` parses on the strict face and the tolerant face', ({ key, valid, pair }) => {
    const doc = { ...pair.base, [key]: valid };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
    const tolerant = AnyComponentSchema.safeParse(doc);
    expect(tolerant.success, JSON.stringify(tolerant.error?.issues)).toBe(true);
  });

  it.each(ROWS)('a wrong-typed `$pair.name`.`$key` is refused at the key on the tolerant face', ({ key, wrong, pair }) => {
    const parsed = pair.mirror.safeParse({ ...pair.base, [key]: wrong });
    expect(parsed.success).toBe(false);
    const issues = parsed.error?.issues ?? [];
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.path[0]).toBe(key);
  });

  it('a `report-viewer` node judges the rules on the report it carries — the reader `ReportViewer` evaluates', () => {
    const rules = [{ field: 'amount', operator: 'less_than', value: 0, textColor: '#b91c1c' }];
    const doc = { type: 'report-viewer', report: { type: 'report', title: 'Pipeline', conditionalFormatting: rules } };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
    const wrong = AnyComponentSchema.safeParse({ ...doc, report: { ...doc.report, conditionalFormatting: [{ ...rules[0], operator: 'between' }] } });
    expect(wrong.success).toBe(false);
  });

  it('the catalog pagination document objectui#5250 M3 charged with `currentPage` now parses on the strict face', () => {
    const doc = JSON.parse(readFileSync(join(REPO_ROOT, 'examples/schema-catalog/src/schemas/components-basic-pagination/basic-pagination.json'), 'utf8'));
    // Non-vacuity: the document really authors the key this row is about.
    expect(doc).toMatchObject({ type: 'pagination', currentPage: 1 });
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
  });
});

describe('objectui#6152 round 3 — `page` is a RETIRED second spelling of `currentPage`', () => {
  const BASE = { type: 'pagination', totalPages: 10 } as const;

  it('stays a member of the mirror, so an authored value is refused by name rather than kept', () => {
    expect('page' in PaginationMirror.shape).toBe(true);
  });

  it.each([
    ['the mirror', (v: unknown) => PaginationMirror.safeParse(v)],
    ['the tolerant face', (v: unknown) => AnyComponentSchema.safeParse(v)],
    ['the strict face', (v: unknown) => StrictAnyComponentSchema.safeParse(v)],
  ] as const)('an authored `page` is refused at the key on %s, and the refusal names `currentPage`', (_face, parse) => {
    const parsed = parse({ ...BASE, page: 2 });
    expect(parsed.success).toBe(false);
    const atPage = (parsed.error?.issues ?? []).filter((issue) => issue.path[0] === 'page');
    expect(atPage.length, JSON.stringify(parsed.error?.issues)).toBeGreaterThan(0);
    expect(atPage.some((issue) => issue.message.includes('`currentPage`')), JSON.stringify(atPage)).toBe(true);
  });

  it('is a `tsc` error on the interface, while `currentPage` is the live spelling', () => {
    // The directive is real enforcement: this package type-checks its tests
    // (`tsconfig.test.json`), so re-declaring `page` fails on the unused directive.
    // @ts-expect-error `page` is RETIRED (objectui#6152) — rename the key to `currentPage`
    const retired: TsPaginationSchema = { type: 'pagination', totalPages: 10, page: 2 };
    const live: TsPaginationSchema = { type: 'pagination', totalPages: 10, currentPage: 2 };
    expect(retired.type).toBe('pagination');
    expect(live.currentPage).toBe(2);
  });
});
