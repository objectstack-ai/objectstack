/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9256 — the RE-MEASURE slice: registrations whose renderer reads
 * NEITHER content channel and whose `type` literal has a published declaration
 * that still accepted `children`. Family D's earlier pins live in
 * `content-channel-family-d-9256.test.ts`, `content-channel-e3-residual-9256.test.ts`
 * and `content-channel-input-9256.test.ts`; this file carries the ones this
 * slice adds, and nothing it pins is restated there.
 *
 * ## Why these were missed, and how they were found
 *
 * The first family-D sweep keyed its population on the renderer's DECLARED
 * schema type: a registration typed with a published declaration was family D,
 * and one typed with an inline or local type was filed as having no published
 * face to narrow. That second bucket was wrong for every registration whose
 * `type` LITERAL has a published declaration anyway — the declaration an author
 * types against is chosen by the literal, not by the renderer's props type. The
 * re-measure keys the population on the literal instead: every registered key
 * is joined to the published TypeScript declarations and zod arms that carry
 * its literal, and each governing registration's reads are taken from the
 * TypeScript compiler-API instrument (one program per workspace package, on a
 * BUILT tree, every `.body` / `.children` read filed under its receiver's
 * declared type, with the inline-typed and prop-spread hops attributed file by
 * file). The table is on objectui#9256.
 *
 * ## What is narrowed here
 *
 *   - `markdown`, `chart`, `bar-chart`, `code-editor`, `detail`, `report` —
 *     both channels `?: never` on the TypeScript face and a by-name refusal on
 *     the zod mirror (two `retirementTombstone` members fed one
 *     `neitherContentChannelGuidance` string), each kept a MEMBER so
 *     `zod-mirror-parity`'s key sets stay equal.
 *   - `list-view` — the zod mirror only, because this arm FEEDS its TypeScript
 *     face: `ListViewSchema` is `z.input` of the mirror intersected with
 *     `ListViewRuntimeProps`, so the two members are what put the refusal on
 *     both faces.
 *   - the six designers (`page-designer`, `data-model-designer`,
 *     `process-designer`, `report-designer`, `object-manager`,
 *     `field-designer`) — the TypeScript face only: none of them has a zod
 *     mirror, so that face is the only gate, as it was for `nl-query`.
 *     (⚠️ AMENDED 2026-10-02 (objectui#10859 batch 7) — a reading of
 *     objectui#9256's tree. All six have a zod arm now in
 *     `zod/designer.zod.ts`, which refuses both channels by name with the same
 *     guidance; its pin is `designer-zod-arms-10859.test.ts`.)
 *
 * `body` was already refused on every one of these faces by `BaseSchema`
 * (objectui#6771); it is restated because that refusal names `children` as the
 * remedy, and `children` is dead here too.
 *
 * ## ⚠️ Half of this file is a COMPILE-TIME assertion and vitest CANNOT read it
 *
 * `?: never` is erased before a test runs. The `@ts-expect-error` lines in the
 * last block are read by `tsc -p tsconfig.test.json` (the `type-check` script),
 * NOT by this runner: under vitest alone, deleting a tombstone from the
 * TypeScript face leaves every case here GREEN. Both readers are the gate.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  MarkdownSchema as MarkdownMirror,
  ChartSchema as ChartMirror,
  BarChartSchema as BarChartMirror,
} from '../zod/data-display.zod';
import { CodeEditorSchema as CodeEditorMirror } from '../zod/form.zod';
import { DetailSchema as DetailMirror } from '../zod/crud.zod';
import { ReportComponentSchema as ReportMirror } from '../zod/reports.zod';
import { ListViewSchema as ListViewMirror } from '../zod/objectql.zod';
import { AnyComponentSchema } from '../zod/index.zod';
import type { MarkdownSchema, ChartSchema, BarChartSchema } from '../data-display';
import type { CodeEditorSchema } from '../form';
import type { DetailSchema } from '../crud';
import type { ReportComponentSchema } from '../reports';
import type { ListViewSchema } from '../objectql';
import type {
  PageDesignerSchema,
  DataModelDesignerSchema,
  ProcessDesignerSchema,
  ReportDesignerSchema,
  ObjectManagerSchema,
  FieldDesignerSchema,
} from '../designer';

type Mirror = {
  safeParse: (v: unknown) => { success: boolean; error?: z.ZodError };
  shape: Record<string, { description?: string } | undefined>;
};

/**
 * One row per narrowed zod arm: its `type`, the mirror, and the node's OTHER
 * required members — `{ type: 'markdown' }` alone is refused for a missing
 * `content`, which has nothing to do with this change and would read here as a
 * false positive. The CONTROL block proves every `required` set parses.
 */
const ROWS: ReadonlyArray<readonly [type: string, mirror: Mirror, required: Record<string, unknown>]> = [
  ['markdown', MarkdownMirror as unknown as Mirror, { content: '# Title' }],
  ['chart', ChartMirror as unknown as Mirror, { chartType: 'bar', series: [] }],
  ['bar-chart', BarChartMirror as unknown as Mirror, {}],
  ['code-editor', CodeEditorMirror as unknown as Mirror, {}],
  ['detail', DetailMirror as unknown as Mirror, {}],
  ['report', ReportMirror as unknown as Mirror, {}],
  ['list-view', ListViewMirror as unknown as Mirror, { objectName: 'account' }],
];

/**
 * The node `AnyComponentSchema` judges, where it is not the mirror's own node
 * (objectui#12670): a page `list-view` is armed by `ListViewBlockSchema`, whose
 * props live in the `properties` bag and whose object is named in `data`. The
 * mirror rows above stay the `ListView` component's props. That arm refuses
 * both channels by name too, with its own string.
 */
const PUBLISHED_REQUIRED: Readonly<Record<string, Record<string, unknown>>> = {
  'list-view': { properties: { data: { provider: 'object', object: 'account' } } },
};

const CHANNELS = ['body', 'children'] as const;
const CONTENT = [{ type: 'text', content: 'measured' }];
const issues = (m: Mirror, doc: unknown) => {
  const r = m.safeParse(doc);
  return r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};
const CASES = ROWS.flatMap(([type, mirror, required]) =>
  CHANNELS.map((key) => [`${type}.${key}`, type, mirror, key, required] as const));

/* ── (a) both channels are REFUSED BY NAME, at the key's own path ─────────── */

describe('objectui#9256 re-measure — both content channels are refused where the renderer reads neither', () => {
  it('the population is the narrowed one — a row dropped from the table fails here', () => {
    expect(ROWS).toHaveLength(7);
    expect(CASES).toHaveLength(14);
  });

  it.each(CASES)('%s is refused at that key\'s own path', (label, type, mirror, key, required) => {
    const found = issues(mirror, { ...required, type, [key]: CONTENT });
    expect(found, `${label} parsed green — the tombstone is not installed`).not.toBeNull();
    expect(found!.some((i) => i.path === key && i.code === 'invalid_type')).toBe(true);
  });

  it.each(CASES)('%s — the message names the channel, the card, and what the node renders instead', (_label, type, mirror, key, required) => {
    const issue = issues(mirror, { ...required, type, [key]: CONTENT })!.find((i) => i.path === key)!;
    expect(issue.message).toContain(`\`${key}\``);
    expect(issue.message).toContain(`\`${type}\` reads NEITHER content channel`);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('What it renders instead: ');
    // ⛔ Not `BaseSchema`'s generic `body` refusal, which names `children` as
    // the remedy — on these nodes `children` is refused as well.
    expect(issue.message).not.toContain('Did you mean');
  });

  it.each(CASES)('%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (_label, type, mirror, key, required) => {
    const issue = issues(mirror, { ...required, type, [key]: CONTENT })!.find((i) => i.path === key)!;
    expect(mirror.shape[key]?.description).toBe(issue.message);
  });

  it.each(CASES)('%s — the refusal is about the KEY, not a value domain: every value is refused', (_label, type, mirror, key, required) => {
    for (const value of [CONTENT, 'text', 42, null, {}, []]) {
      expect(issues(mirror, { ...required, type, [key]: value })?.some((i) => i.path === key)).toBe(true);
    }
  });

  it.each(CASES)('%s — the refusal reaches the node through `AnyComponentSchema`, not only its own arm', (_label, type, _mirror, key, required) => {
    const published = PUBLISHED_REQUIRED[type] ?? required;
    expect(AnyComponentSchema.safeParse({ ...published, type }).success).toBe(true);
    const refused = AnyComponentSchema.safeParse({ ...published, type, [key]: CONTENT });
    expect(refused.success).toBe(false);
    const issue = refused.error!.issues.find((i) => i.path.join('.') === key);
    expect(issue?.message).toContain(`\`${type}\` reads NEITHER content channel`);
  });
});

/* ── (b) CONTROLS — nothing that parsed before stops parsing ──────────────── */

describe('objectui#9256 re-measure — CONTROLS', () => {
  it.each(ROWS)('`%s` still parses with its own required members and a `className`', (type, mirror, required) => {
    expect(issues(mirror, { ...required, type })).toBeNull();
    expect(issues(mirror, { ...required, type, className: 'p-4' })).toBeNull();
  });

  it.each(CASES)('%s — the tombstone is a MEMBER of the mirror shape, so the parity ratchet\'s key sets stay equal', (_label, _type, mirror, key) => {
    expect(Object.keys(mirror.shape)).toContain(key);
  });

  it('a nested narrowed node is refused inside a container that reads `children`', () => {
    const tree = (child: Record<string, unknown>) => ({ type: 'div', children: [child] });
    expect(AnyComponentSchema.safeParse(tree({ type: 'markdown', content: '# Title' })).success).toBe(true);
    expect(AnyComponentSchema.safeParse(
      tree({ type: 'markdown', content: '# Title', children: CONTENT }),
    ).success).toBe(false);
  });

  it('family C still reads a content channel — `div` takes `children`', () => {
    // The distinction this card rests on: a reader keeps its channel, a
    // non-reader loses both. Measured in the same run as the rows above.
    expect(AnyComponentSchema.safeParse({ type: 'div', children: CONTENT }).success).toBe(true);
  });

  it('the ITEM channels of the narrowed nodes are untouched — `detail` tabs still carry `content`', () => {
    // `DetailSchema.tabs[].content` is an ITEM key, not the node's own channel;
    // the tombstone above is about the node's `body` / `children` only.
    expect(issues(DetailMirror as unknown as Mirror, {
      type: 'detail',
      tabs: [{ key: 'notes', label: 'Notes', content: CONTENT }],
    })).toBeNull();
  });
});

/* ── (c) the TypeScript face — ⚠️ READ BY `tsc`, NOT BY VITEST ────────────── */

describe('objectui#9256 re-measure — the TypeScript face refuses both channels at the AUTHORING site', () => {
  // Each refused line spreads a base that the CONTROL test below proves
  // compiles, so the ONLY difference an `@ts-expect-error` can be answering is
  // the channel written beside it — not a missing required member.
  const markdown = { type: 'markdown', content: '# Title' } satisfies MarkdownSchema;
  const chart = { type: 'chart', chartType: 'bar', series: [] } satisfies ChartSchema;
  const barChart = { type: 'bar-chart' } satisfies BarChartSchema;
  const codeEditor = { type: 'code-editor' } satisfies CodeEditorSchema;
  const detail = { type: 'detail' } satisfies DetailSchema;
  const report = { type: 'report' } satisfies ReportComponentSchema;
  const listView = { type: 'list-view', objectName: 'account' } satisfies ListViewSchema;
  const pageDesigner = {
    type: 'page-designer', canvas: { width: 800, height: 600 }, components: [],
  } satisfies PageDesignerSchema;
  const dataModelDesigner = {
    type: 'data-model-designer', entities: [], relationships: [],
  } satisfies DataModelDesignerSchema;
  const processDesigner = {
    type: 'process-designer', processName: 'approval', nodes: [], edges: [],
  } satisfies ProcessDesignerSchema;
  const reportDesigner = {
    type: 'report-designer', reportName: 'pipeline', objectName: 'account', sections: [],
  } satisfies ReportDesignerSchema;
  const objectManager = { type: 'object-manager', objects: [] } satisfies ObjectManagerSchema;
  const fieldDesigner = { type: 'field-designer', objectName: 'account', fields: [] } satisfies FieldDesignerSchema;

  it('the `@ts-expect-error` lines in this block are the assertion; vitest only proves they are reachable', () => {
    // @ts-expect-error objectui#9256 — `markdown` reads neither channel
    const markdownBody: MarkdownSchema = { ...markdown, body: CONTENT };
    // @ts-expect-error objectui#9256 — `markdown` reads neither channel
    const markdownChildren: MarkdownSchema = { ...markdown, children: CONTENT };
    // @ts-expect-error objectui#9256 — `chart` reads neither channel
    const chartBody: ChartSchema = { ...chart, body: CONTENT };
    // @ts-expect-error objectui#9256 — `chart` reads neither channel
    const chartChildren: ChartSchema = { ...chart, children: CONTENT };
    // @ts-expect-error objectui#9256 — `bar-chart` reads neither channel
    const barChartBody: BarChartSchema = { ...barChart, body: CONTENT };
    // @ts-expect-error objectui#9256 — `bar-chart` reads neither channel
    const barChartChildren: BarChartSchema = { ...barChart, children: CONTENT };
    // @ts-expect-error objectui#9256 — `code-editor` reads neither channel
    const codeEditorBody: CodeEditorSchema = { ...codeEditor, body: CONTENT };
    // @ts-expect-error objectui#9256 — `code-editor` reads neither channel
    const codeEditorChildren: CodeEditorSchema = { ...codeEditor, children: CONTENT };
    // @ts-expect-error objectui#9256 — `detail` reads neither channel
    const detailBody: DetailSchema = { ...detail, body: CONTENT };
    // @ts-expect-error objectui#9256 — `detail` reads neither channel
    const detailChildren: DetailSchema = { ...detail, children: CONTENT };
    // @ts-expect-error objectui#9256 — `report` reads neither channel
    const reportBody: ReportComponentSchema = { ...report, body: CONTENT };
    // @ts-expect-error objectui#9256 — `report` reads neither channel
    const reportChildren: ReportComponentSchema = { ...report, children: CONTENT };
    // @ts-expect-error objectui#9256 — `list-view` reads neither channel (this face is `z.input` of the mirror)
    const listViewBody: ListViewSchema = { ...listView, body: CONTENT };
    // @ts-expect-error objectui#9256 — `list-view` reads neither channel (this face is `z.input` of the mirror)
    const listViewChildren: ListViewSchema = { ...listView, children: CONTENT };
    // @ts-expect-error objectui#9256 — `page-designer` reads neither channel
    const pageDesignerBody: PageDesignerSchema = { ...pageDesigner, body: CONTENT };
    // @ts-expect-error objectui#9256 — `page-designer` reads neither channel
    const pageDesignerChildren: PageDesignerSchema = { ...pageDesigner, children: CONTENT };
    // @ts-expect-error objectui#9256 — `data-model-designer` reads neither channel
    const dataModelDesignerBody: DataModelDesignerSchema = { ...dataModelDesigner, body: CONTENT };
    // @ts-expect-error objectui#9256 — `data-model-designer` reads neither channel
    const dataModelDesignerChildren: DataModelDesignerSchema = { ...dataModelDesigner, children: CONTENT };
    // @ts-expect-error objectui#9256 — `process-designer` reads neither channel
    const processDesignerBody: ProcessDesignerSchema = { ...processDesigner, body: CONTENT };
    // @ts-expect-error objectui#9256 — `process-designer` reads neither channel
    const processDesignerChildren: ProcessDesignerSchema = { ...processDesigner, children: CONTENT };
    // @ts-expect-error objectui#9256 — `report-designer` reads neither channel
    const reportDesignerBody: ReportDesignerSchema = { ...reportDesigner, body: CONTENT };
    // @ts-expect-error objectui#9256 — `report-designer` reads neither channel
    const reportDesignerChildren: ReportDesignerSchema = { ...reportDesigner, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-manager` reads neither channel
    const objectManagerBody: ObjectManagerSchema = { ...objectManager, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-manager` reads neither channel
    const objectManagerChildren: ObjectManagerSchema = { ...objectManager, children: CONTENT };
    // @ts-expect-error objectui#9256 — `field-designer` reads neither channel
    const fieldDesignerBody: FieldDesignerSchema = { ...fieldDesigner, body: CONTENT };
    // @ts-expect-error objectui#9256 — `field-designer` reads neither channel
    const fieldDesignerChildren: FieldDesignerSchema = { ...fieldDesigner, children: CONTENT };

    expect([
      markdownBody, markdownChildren, chartBody, chartChildren, barChartBody, barChartChildren,
      codeEditorBody, codeEditorChildren, detailBody, detailChildren, reportBody, reportChildren,
      listViewBody, listViewChildren, pageDesignerBody, pageDesignerChildren,
      dataModelDesignerBody, dataModelDesignerChildren, processDesignerBody, processDesignerChildren,
      reportDesignerBody, reportDesignerChildren, objectManagerBody, objectManagerChildren,
      fieldDesignerBody, fieldDesignerChildren,
    ]).toHaveLength(26);
  });

  it('CONTROL — the same nodes WITHOUT a content channel compile (no `@ts-expect-error` here, and `tsc` is the reader)', () => {
    const ok = [
      markdown, chart, barChart, codeEditor, detail, report, listView,
      pageDesigner, dataModelDesigner, processDesigner, reportDesigner, objectManager, fieldDesigner,
    ];
    expect(ok).toHaveLength(13);
  });
});
