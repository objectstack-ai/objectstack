/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `chartType` row of `content/docs/api/schema-reference.md`'s `ChartSchema`
 * table lists exactly the `ChartType` set the `chart` node declares
 * (objectui#11521).
 *
 * ## The defect
 *
 * The row was a hand list: `"bar"`, `"line"`, `"area"`, `"pie"`, `"donut"`,
 * `"radar"`, `"scatter"`, `"heatmap"`. `heatmap` is no `@objectstack/spec`
 * chart family, and the node refuses it at `chartType` on both doors. The list
 * also left out the declared families that are not among those seven. The page
 * is what authors and AI copy, so it taught a refused value and hid accepted
 * ones.
 *
 * ## Where the set comes from — read at test time, never written here
 *
 * `ChartType` is `@objectstack/spec`'s own `ChartType`, re-exported
 * (`../data-display.ts`). That is a TS type, but the set also exists at
 * runtime: the spec's `ChartTypeSchema` is a zod enum, and the node's mirror
 * declares `chartType` with it, by reference (`ChartTypeSchema` in
 * `../zod/data-display.zod.ts`). So this file reads the set off the node's own
 * zod declaration on every run, holds that set equal to the installed spec's
 * enum, and holds the TS face to the zod face at compile time
 * (`tsc -p tsconfig.test.json`, the third leg of this package's `type-check`).
 * A family the spec adds or drops moves the declared set, and this pin then
 * asks for the row to move with it. ⛔ Writing the set out in this file would
 * re-create the defect one layer up: the row was itself a confident hand list.
 *
 * ## The pins
 *
 * - The row's quoted values, parsed off disk, equal the declared set, with no
 *   value twice.
 * - The declared set is the installed spec's `ChartTypeSchema`.
 * - Each value the row lists parses on the tolerant face
 *   (`safeValidateSchema`) and on the strict authoring face, which
 *   `objectui validate` runs, and `heatmap` is refused at `chartType` on both, as one
 *   `invalid_value` whose `values` are the declared set. That is the row's
 *   "refused with the set named".
 *
 * Everything that could let the row pin pass vacuously (a moved heading, a
 * renamed property, a row with no quoted values) throws instead.
 *
 * The shape follows objectui#11491's `grid-columns-set-11491.test.ts`: the
 * declared set on the zod face, both doors, and a compile-time check that the
 * two faces state one set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { ChartTypeSchema as SpecChartTypeSchema, type ChartType as SpecChartType } from '@objectstack/spec/ui';
import { enumOptions, shapeEnumOptions } from '@object-ui/test-support';
import { ChartSchema } from '../zod/data-display.zod.js';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import type { ChartSchema as ChartSchemaType, ChartType } from '../data-display.js';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

interface Issue {
  code: string;
  path: PropertyKey[];
  values?: unknown[];
}

const issuesOf = (r: { success: boolean; error?: { issues: unknown[] } }): Issue[] =>
  r.success ? [] : (r.error!.issues as Issue[]);

const DOC = 'content/docs/api/schema-reference.md';
const HEADING = '\n### ChartSchema\n';
const ROW_PREFIX = '| `chartType` |';

/** The `chartType` row of the `ChartSchema` table, split into its cells. */
function chartTypeRow(): string[] {
  const src = readFileSync(join(uiRoot(), DOC), 'utf8');
  const start = src.indexOf(HEADING);
  if (start < 0) throw new Error(`"${HEADING.trim()}" heading not found in ${DOC}: the section moved`);
  const end = src.indexOf('\n### ', start + HEADING.length);
  const section = src.slice(start, end < 0 ? src.length : end);
  const rows = section.split('\n').filter((line) => line.startsWith(ROW_PREFIX));
  if (rows.length !== 1) {
    throw new Error(`expected one "${ROW_PREFIX}" row under ${HEADING.trim()} in ${DOC}, found ${rows.length}`);
  }
  // Cells split on unescaped pipes; the leading and trailing pipes leave empty ends.
  return rows[0].split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
}

/** The values the row's description cell lists, each spelled `"family"` in backticks. */
function documentedFamilies(): string[] {
  const [, type, description] = chartTypeRow();
  if (type !== '`ChartType`') throw new Error(`the row's type cell reads ${type}, not \`ChartType\``);
  const values = [...description.matchAll(/`"([^"`]+)"`/g)].map((m) => m[1]);
  if (values.length === 0) throw new Error(`parsed no quoted value out of the chartType row in ${DOC}`);
  return values;
}

/** The set the node declares at `chartType`, read off its zod mirror. */
const DECLARED = shapeEnumOptions(ChartSchema, 'chartType');

const sorted = (values: readonly string[]) => [...values].sort();

/** A chart node that parses on both faces, apart from the family under test. */
const chartNode = (chartType: string) => ({
  type: 'chart',
  chartType,
  xAxisKey: 'month',
  data: [{ month: 'Jan', revenue: 4200 }],
  series: [{ name: 'revenue' }],
});

/** The doors an authored document passes through. */
const FACES = {
  tolerant: (doc: unknown) => safeValidateSchema(doc),
  strict: (doc: unknown) => StrictAnyComponentSchema.safeParse(doc),
} as const;

describe('the ChartSchema `chartType` row lists the declared ChartType set (objectui#11521)', () => {
  it('reads a non-empty declared set off the node', () => {
    expect(DECLARED, 'could not read the enum at ChartSchema.chartType').not.toEqual([]);
  });

  it('the declared set is the installed spec\'s ChartTypeSchema', () => {
    const spec = enumOptions(SpecChartTypeSchema);
    expect(spec, 'could not read ChartTypeSchema.options from the spec').not.toEqual([]);
    expect(sorted(DECLARED)).toEqual(sorted(spec));
  });

  it('the row lists each declared family once, and nothing else', () => {
    const documented = documentedFamilies();
    const twice = documented.filter((value, i) => documented.indexOf(value) !== i);
    expect(twice, 'listed more than once').toEqual([]);
    expect(
      sorted(documented),
      `${DOC} › ChartSchema › chartType must list the declared ChartType set`,
    ).toEqual(sorted(DECLARED));
  });

  for (const [face, parse] of Object.entries(FACES)) {
    describe(`${face} face`, () => {
      it('accepts every family the row lists', () => {
        for (const family of documentedFamilies()) {
          const issues = issuesOf(parse(chartNode(family)));
          expect(issues, `chartType "${family}" refused`).toEqual([]);
        }
      });

      it('refuses "heatmap" at `chartType`, naming the declared set', () => {
        const issues = issuesOf(parse(chartNode('heatmap')));
        expect(issues).toHaveLength(1);
        const [issue] = issues;
        expect(issue.code).toBe('invalid_value');
        expect(issue.path).toEqual(['chartType']);
        expect(sorted(issue.values as string[])).toEqual(sorted(DECLARED));
      });
    });
  }

  it('the two faces and the spec state one set (compile-time)', () => {
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const tsIsSpec: Same<ChartType, SpecChartType> = true;
    const facesAgree: Same<z.infer<typeof ChartSchema>['chartType'], ChartSchemaType['chartType']> = true;
    expect([tsIsSpec, facesAgree]).toEqual([true, true]);
  });
});
