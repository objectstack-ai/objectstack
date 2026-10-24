/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 4 — what this round did to the declared-but-unmirrored keys
 * it closed by RETIREMENT and by MIRRORING. (The eighteen keys it filed as runtime
 * slots by name moved between two test ledgers only; `zod-mirror-parity.test.ts`
 * reconciles them, and no published face changed for them.)
 *
 * ## Retired on both faces
 *
 * Four keys the TypeScript face declared and the zod mirror had never heard of:
 *
 *   - `label.content` — a THIRD spelling of the label text, after `text` and
 *     `label`; the renderer's third read is dropped in the same change;
 *   - `report.chartConfig`, `report.reportType`, `detail-view.autoDiscoverRelated`
 *     — each re-measured ZERO-READ by a type-checker census, with no authored
 *     document (`reportType`'s one in-code producer stops writing it).
 *
 * Each is `?: never` on the interface and a `retirementTombstone()` on the mirror,
 * so an authored value is refused BY NAME at the key on every face instead of
 * being kept unexamined by `.passthrough()`.
 *
 * ## Mirrored
 *
 *   - `chatbot.requestBody` — read by all three chatbot registrations, and until
 *     now refused by the strict face on a `chatbot` node although `tsc` accepted it;
 *   - `chatbot-floating.floatingConfig` — read by that registration alone, now
 *     judged member by member (its `triggerIcon` tombstone is pinned in
 *     `floating-chatbot-trigger-icon-retired.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { LabelSchema as TsLabelSchema } from '../form';
import type { ReportComponentSchema as TsReportComponentSchema } from '../reports';
import type { DetailViewSchema as TsDetailViewSchema } from '../views';
import { LabelSchema as LabelMirror } from '../zod/form.zod.js';
import { ReportComponentSchema as ReportMirror } from '../zod/reports.zod.js';
import { DetailViewSchema as DetailViewMirror } from '../zod/views.zod.js';
import { ChatbotSchema as ChatbotMirror, ChatbotFloatingSchema as ChatbotFloatingMirror } from '../zod/complex.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = (v: unknown) => { success: boolean; error?: { issues: Issue[] } };
type Mirror = { shape: Record<string, unknown>; safeParse: Parse };

type Retired = { name: string; key: string; value: unknown; base: Record<string, unknown>; mirror: Mirror };

const RETIRED: Retired[] = [
  { name: 'label', key: 'content', value: 'Email', base: { type: 'label', text: 'Email' }, mirror: LabelMirror as unknown as Mirror },
  {
    name: 'report',
    key: 'chartConfig',
    value: { chartType: 'bar', xAxisField: 'stage', yAxisFields: ['amount'] },
    base: { type: 'report', title: 'Pipeline' },
    mirror: ReportMirror as unknown as Mirror,
  },
  { name: 'report', key: 'reportType', value: 'summary', base: { type: 'report', title: 'Pipeline' }, mirror: ReportMirror as unknown as Mirror },
  {
    name: 'detail-view',
    key: 'autoDiscoverRelated',
    value: true,
    base: { type: 'detail-view', objectName: 'account' },
    mirror: DetailViewMirror as unknown as Mirror,
  },
];

const FACES: ReadonlyArray<readonly [string, (row: Retired) => Parse]> = [
  ['the mirror', (row) => (v) => row.mirror.safeParse(v)],
  ['the tolerant face', () => (v) => AnyComponentSchema.safeParse(v) as ReturnType<Parse>],
  ['the strict face', () => (v) => StrictAnyComponentSchema.safeParse(v) as ReturnType<Parse>],
];

const RETIRED_ON_FACES = RETIRED.flatMap((row) => FACES.map(([face, parse]) => ({ ...row, face, parse: parse(row) })));

describe('objectui#6152 round 4 — keys RETIRED on both faces', () => {
  it.each(RETIRED)('CONTROL: the minimal `$name` document parses on both faces', ({ base }) => {
    expect(AnyComponentSchema.safeParse(base).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(base);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
  });

  it.each(RETIRED)('`$name`.`$key` stays a MEMBER of the mirror, so an authored value is refused by name rather than kept', ({ key, mirror }) => {
    expect(key in mirror.shape).toBe(true);
  });

  it.each(RETIRED_ON_FACES)('an authored `$name`.`$key` is refused at the key on $face', ({ key, value, base, parse }) => {
    const parsed = parse({ ...base, [key]: value });
    expect(parsed.success).toBe(false);
    const atKey = (parsed.error?.issues ?? []).filter((issue) => issue.path[0] === key);
    expect(atKey.length, JSON.stringify(parsed.error?.issues)).toBeGreaterThan(0);
  });

  it.each(RETIRED)('the `$name`.`$key` refusal is the tombstone kind (`invalid_type`), not an unrecognised key', ({ key, value, base, mirror }) => {
    const parsed = mirror.safeParse({ ...base, [key]: value });
    const atKey = (parsed.error?.issues ?? []).filter((issue) => issue.path[0] === key);
    expect(atKey.map((issue) => issue.code)).toEqual(['invalid_type']);
  });

  it('the `label.content` refusal names the live spelling `text`', () => {
    const parsed = LabelMirror.safeParse({ type: 'label', content: 'Email' });
    const atKey = (parsed.error?.issues ?? []).filter((issue) => issue.path[0] === 'content');
    expect(atKey.some((issue) => issue.message.includes('`text`')), JSON.stringify(atKey)).toBe(true);
  });

  it('each is a `tsc` error on its interface, while a live neighbour type-checks', () => {
    // The directives are real enforcement: this package type-checks its tests
    // (`tsconfig.test.json`), so re-declaring a key fails on the unused directive.
    // @ts-expect-error `content` is RETIRED (objectui#6152) — write `text`
    const label: TsLabelSchema = { type: 'label', content: 'Email' };
    // @ts-expect-error `chartConfig` is RETIRED (objectui#6152) — nothing read it
    const chart: TsReportComponentSchema = { type: 'report', chartConfig: { chartType: 'bar' } };
    // @ts-expect-error `reportType` is RETIRED (objectui#6152) — nothing read it
    const kind: TsReportComponentSchema = { type: 'report', reportType: 'summary' };
    // @ts-expect-error `autoDiscoverRelated` is RETIRED (objectui#6152) — nothing read it
    const detail: TsDetailViewSchema = { type: 'detail-view', autoDiscoverRelated: true };
    const live: TsLabelSchema = { type: 'label', text: 'Email', label: 'Email' };
    expect([label.type, chart.type, kind.type, detail.type, live.text]).toEqual(['label', 'report', 'report', 'detail-view', 'Email']);
  });
});

describe('objectui#6152 round 4 — `chatbot.requestBody` and `chatbot-floating.floatingConfig` are MIRRORED', () => {
  const messages = [{ id: 'm1', role: 'user', content: 'hi' }];
  const ROWS = [
    {
      name: 'chatbot',
      key: 'requestBody',
      mirror: ChatbotMirror as unknown as Mirror,
      base: { type: 'chatbot', messages },
      valid: { tenant: 'acme', temperature: 0.2 },
      wrong: 'tenant=acme',
      wrongPath: 'requestBody',
    },
    {
      name: 'chatbot-floating',
      key: 'floatingConfig',
      mirror: ChatbotFloatingMirror as unknown as Mirror,
      base: { type: 'chatbot-floating', messages },
      valid: { position: 'bottom-left', defaultOpen: true, panelWidth: 420, panelHeight: 560, title: 'Support', triggerSize: 48 },
      wrong: { position: 'top-left' },
      wrongPath: 'floatingConfig.position',
    },
  ] as const;

  it.each(ROWS)('`$name`.`$key` is a member of the mirror', ({ key, mirror }) => {
    expect(key in mirror.shape).toBe(true);
  });

  it.each(ROWS)('an authored `$name`.`$key` parses on the strict face and the tolerant face', ({ key, base, valid }) => {
    const doc = { ...base, [key]: valid };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
    const tolerant = AnyComponentSchema.safeParse(doc);
    expect(tolerant.success, JSON.stringify(tolerant.error?.issues)).toBe(true);
  });

  it.each(ROWS)('a wrong-typed `$name`.`$key` is refused at its path on the tolerant face', ({ key, base, wrong, wrongPath }) => {
    const parsed = AnyComponentSchema.safeParse({ ...base, [key]: wrong });
    expect(parsed.success).toBe(false);
    const paths = (parsed.error?.issues ?? []).map((issue) => issue.path.join('.'));
    expect(paths, JSON.stringify(parsed.error?.issues)).toContain(wrongPath);
  });
});

describe('objectui#6152 round 4 — the pagination catalog document authors only what `pagination` declares', () => {
  it('`with-item-count` parses on the strict face, and no longer carries `pageSize` / `totalItems`', () => {
    const doc = JSON.parse(readFileSync(join(REPO_ROOT, 'examples/schema-catalog/src/schemas/components-basic-pagination/with-item-count.json'), 'utf8'));
    // Non-vacuity: this is the document the finding named, and it is a pagination node.
    expect(doc).toMatchObject({ type: 'pagination', currentPage: 3, totalPages: 20 });
    expect('pageSize' in doc || 'totalItems' in doc).toBe(false);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
  });
});
