// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19920] The published type `JoinedReportBlock` names one sub-report of a joined report; it is
 * not `unknown`, and neither is a `blocks[]` element of `Report` / `ReportParsed`.
 *
 * `JoinedReportBlockSchema` was annotated `z.ZodTypeAny`, so `z.input<typeof …>` of it WAS
 * `unknown`, and `ReportSchema`'s `blocks: z.array(JoinedReportBlockSchema)` was `unknown[]`: any
 * value type-checked as a block. The schema now carries its inferred type.
 *
 * Two halves, judged by two programs (the `view-metadata-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile. While the block type was `unknown` every one of them compiled, so each
 *   directive was unused: TS2578 in a file with no `test-typecheck-debt.json` entry, which reds the
 *   gate.
 * - The RUNTIME half ties the typed bodies to the doors: each one parses, and the joined report's
 *   parsed `blocks` are values of the block's output type.
 */

import { describe, it, expect } from 'vitest';
import {
  JoinedReportBlockSchema,
  ReportSchema,
  type JoinedReportBlock,
  type JoinedReportBlockParsed,
  type Report,
  type ReportParsed,
} from './report.zod';

type ParsedBlock = NonNullable<ReportParsed['blocks']>[number];

// ── Real bodies, each typed through the published names ──────────────────────────────────────

const openBlock: JoinedReportBlock = {
  name: 'open_block',
  label: 'Open Tasks',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['status'],
  values: ['est_hours'],
  order: [{ by: 'est_hours', direction: 'desc' }],
};
const listBlock: JoinedReportBlock = { name: 'done_block', dataset: 'task_metrics', values: ['task_count'] };
const joined: Report = { name: 'task_overview', label: 'Task Overview', type: 'joined', blocks: [openBlock, listBlock] };

// ── What the block type refuses at compile time ──────────────────────────────────────────────

const someValue: unknown = JSON.parse('{"nope":1}');
// @ts-expect-error -- `unknown` is not a block; it was assignable while JoinedReportBlock was `unknown`.
const fromUnknown: JoinedReportBlock = someValue;
// @ts-expect-error -- a block is an object.
const scalar: JoinedReportBlock = 42;
// @ts-expect-error -- `notABlockKey` is declared by no block (TS2353).
const undeclaredKey: JoinedReportBlock = { name: 'b', dataset: 'task_metrics', notABlockKey: 1 };
// @ts-expect-error -- `chart` was removed from the block (#20161); the closed shape refuses it too.
const retiredChart: JoinedReportBlock = { name: 'b', dataset: 'task_metrics', chart: { type: 'bar' } };
// @ts-expect-error -- `joined` is excluded from a block's type enum (no recursion).
const nestedJoined: JoinedReportBlock = { name: 'b', type: 'joined' };
// @ts-expect-error -- a `blocks[]` element of Report is a block, not any value.
const reportWithScalarBlock: Report = { name: 'r', label: 'R', type: 'joined', blocks: [42] };
// @ts-expect-error -- nor is a parsed one.
const parsedScalarBlock: ParsedBlock = 42;
void [fromUnknown, scalar, undeclaredKey, retiredChart, nestedJoined, reportWithScalarBlock, parsedScalarBlock];

describe('JoinedReportBlock is a joined-report block, not unknown', () => {
  it('each block typed as JoinedReportBlock parses at the block door', () => {
    for (const block of [openBlock, listBlock]) {
      expect(JoinedReportBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it('a joined report typed as Report parses, and its parsed blocks are JoinedReportBlockParsed', () => {
    const parsed: ReportParsed = ReportSchema.parse(joined);
    const blocks: JoinedReportBlockParsed[] = parsed.blocks ?? [];
    expect(blocks.map((b) => [b.name, b.type])).toEqual([
      ['open_block', 'summary'],
      ['done_block', 'tabular'],
    ]);
  });
});
