// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10746 — switching a bound report's type to `joined` CLEARS the
 * container's selection keys in the same patch, instead of only hiding them.
 *
 * A joined report selects per block: each block binds its own `dataset` and
 * picks its own `rows` / `columns` / `values`. `ReportSchema`'s joined arm
 * therefore refuses those four keys on the container — objectstack PR #20160,
 * `JOINED_CONTAINER_SELECTION_KEYS` in `packages/spec/src/ui/report.zod.ts`:
 * "a `joined` report selects per block — move `KEY` onto `blocks[]`, or delete
 * it; on the container it selects nothing." — and has always refused a
 * container `order` ("a `joined` report orders per block — move `order` onto
 * `blocks[]`."). `chart` is inert on a joined container (objectstack#20161).
 *
 * The type picker used to commit `{ type: 'joined' }` and nothing else. In the
 * same render this inspector hides its dataset / values / rows / columns /
 * chart controls (`datasetBound`), and the spec's own `reportForm` hides its
 * whole "Dataset binding" section — `order` included — through
 * `visibleWhen: "data.type != 'joined'"`. A report bound first and switched
 * second kept every one of those keys INVISIBLY; its save was then refused at a
 * path no control on the Properties tab could reach.
 *
 * What the installed `@objectstack/spec` can measure here: when this was
 * written the spec in the lockfile predated PR #20160 — it refused a container
 * `order` and still ACCEPTED the four selection keys — so the four were pinned
 * as ABSENCE, against the rule quoted above. 17.5.0 (objectui#11073) carries
 * #20160: re-measured, a joined container with `dataset` is refused at
 * `dataset` with that rule's own sentence. So the final parse leg below now
 * covers all five keys, and the absence pins stay as they are. ⛔ Never weaken
 * them to "parses under the installed spec" — against a spec without #20160
 * that read green on the defect too.
 *
 * ⚠️ Assertion spelling. `toHaveBeenCalledWith` and `toEqual` treat an
 * `undefined`-valued key as absent, so `{ type: 'joined', dataset: undefined }`
 * satisfies `toHaveBeenCalledWith({ type: 'joined' })` — the defect and the fix
 * read alike under them. Every patch here is read with `toStrictEqual`, which
 * tells an own key holding `undefined` from a missing one.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportSchema } from '@objectstack/spec/ui';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';

afterEach(cleanup);

// One fetch double at MODULE scope, never torn down — the same reason as in
// `ReportDefaultInspector.test.tsx` (objectui#7439 / #6640): `useDatasetSemantics`
// fires a fire-and-forget read that no test body awaits.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

const catalog: DatasetCatalogEntry[] = [
  {
    name: 'sales_metrics',
    label: 'Sales metrics',
    dimensions: [
      { name: 'stage', type: 'text' },
      { name: 'close_quarter', type: 'date' },
    ],
    measures: [
      { name: 'total_amount', aggregate: 'sum' },
      { name: 'deal_count', aggregate: 'count' },
    ],
  },
];

const baseProps = {
  type: 'report',
  name: 'pipeline',
  locale: 'en-US' as const,
  onSelectionChange: vi.fn(),
  datasetCatalogOverride: catalog,
};

/** The six keys the type switch clears, in the order the inspector names them. */
const CLEARED = ['dataset', 'values', 'rows', 'columns', 'chart', 'order'] as const;
/** The four the spec's joined arm refuses on the container (objectstack PR #20160). */
const SPEC_REFUSED_SELECTION = ['dataset', 'rows', 'columns', 'values'] as const;

/** One dataset-bound block: where a joined report's data actually lives. */
const block = { name: 'won_deals', dataset: 'sales_metrics', rows: ['stage'], values: ['total_amount'] };

/**
 * A matrix report bound the way the Properties tab binds one: every curated
 * control has written its key, the spec form has written `order`, and the two
 * keys the joined branch READS (`runtimeFilter`, `drilldown`) are set so the
 * pins can show them surviving the switch.
 */
const boundDraft = {
  name: 'pipeline',
  label: 'Pipeline',
  type: 'matrix',
  dataset: 'sales_metrics',
  values: ['total_amount'],
  rows: ['stage'],
  columns: ['close_quarter'],
  chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount' },
  order: [{ by: 'total_amount' }],
  runtimeFilter: { stage: 'won' },
  drilldown: false,
};

type Patch = Record<string, unknown>;

/** Mount on `draft`, pick `optionLabel` in the Report type control, hand back the one patch. */
async function switchType(draft: Record<string, unknown>, optionLabel: string): Promise<Patch> {
  const onPatch = vi.fn<(patch: Patch) => void>();
  render(<ReportDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Report type' }));
  await userEvent.click(await screen.findByRole('option', { name: optionLabel }));
  expect(onPatch, 'the type picker commits exactly one patch').toHaveBeenCalledTimes(1);
  return onPatch.mock.calls[0][0];
}

/**
 * The host's merge, as all three hosts spell it (`ResourceEditPage`,
 * `ReportConfigPanel`, `StudioDesignSurface`) — `ResourceEditPage` passes
 * `handleDraftChange((d) => ({ ...d, ...patch }))` and `ReportConfigPanel`'s
 * `handlePatch` computes `{ ...draftRef.current, ...patch }`: a shallow spread.
 */
const merge = (draft: Record<string, unknown>, patch: Patch): Record<string, unknown> => ({ ...draft, ...patch });

/** What reaches the wire: the draft JSON-encoded, which is how `client.save` sends a body. */
const serialised = (doc: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(doc));

describe('ReportDefaultInspector — switching to `joined` clears the container binding (objectui#10746)', () => {
  it('THE DEFECT: a bound report switched to `joined` loses dataset / values / rows / columns / chart / order in the SAME patch', async () => {
    const patch = await switchType(boundDraft, 'Joined');
    expect(patch).toStrictEqual({
      type: 'joined',
      dataset: undefined,
      values: undefined,
      rows: undefined,
      columns: undefined,
      chart: undefined,
      order: undefined,
    });
  });

  it('a cleared key is an own key holding `undefined` on the draft — not `null`, not `""` — and is ABSENT once serialised', async () => {
    const patch = await switchType(boundDraft, 'Joined');
    const committed = merge(boundDraft, patch);
    for (const key of CLEARED) {
      expect(Object.hasOwn(committed, key), `${key} is an own key after the spread`).toBe(true);
      expect(committed[key], `${key} holds undefined, the one value JSON omits`).toBeUndefined();
    }
    const document = serialised(committed);
    for (const key of CLEARED) expect(document).not.toHaveProperty(key);
    // The keys the joined branch READS travel through untouched.
    expect(document).toStrictEqual({
      name: 'pipeline',
      label: 'Pipeline',
      type: 'joined',
      runtimeFilter: { stage: 'won' },
      drilldown: false,
    });
  });

  it('the parse leg the installed spec can measure: the container `order` refusal goes away; the four selection keys are asserted absent against the spec rule', async () => {
    const draft = { ...boundDraft, blocks: [block] };
    const patch = await switchType(draft, 'Joined');
    // What the defect committed: the type alone, every stale key kept.
    const before = ReportSchema.safeParse(serialised(merge(draft, { type: 'joined' })));
    expect(
      before.success,
      'INSTRUMENT CONTROL: the installed spec refuses a container `order` on a joined report',
    ).toBe(false);
    if (!before.success) {
      const orderIssue = before.error.issues.find((i) => i.path[0] === 'order');
      expect(orderIssue?.message).toMatch(/^a `joined` report orders per block/);
    }
    const after = serialised(merge(draft, patch));
    for (const key of SPEC_REFUSED_SELECTION) {
      expect(
        after,
        `\`${key}\` — "a \`joined\` report selects per block — move \`${key}\` onto \`blocks[]\`, or delete it"`,
      ).not.toHaveProperty(key);
    }
    expect(after).not.toHaveProperty('order');
    const parsed = ReportSchema.safeParse(after);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });

  it('names only the keys the draft carries: a partially bound report yields exactly those', async () => {
    const patch = await switchType(
      { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'sales_metrics', values: ['total_amount'] },
      'Joined',
    );
    expect(patch).toStrictEqual({ type: 'joined', dataset: undefined, values: undefined });
  });

  it('BOUNDARY: an unbound report switching to `joined` stays the one-key patch it always was', async () => {
    const patch = await switchType({ name: 'pipeline', label: 'Pipeline', type: 'tabular' }, 'Joined');
    expect(patch).toStrictEqual({ type: 'joined' });
  });

  it('CONTROL: switching between two non-joined types keeps the binding', async () => {
    const patch = await switchType(boundDraft, 'Summary');
    expect(patch).toStrictEqual({ type: 'summary' });
    expect(serialised(merge(boundDraft, patch))).toMatchObject({
      dataset: 'sales_metrics',
      values: ['total_amount'],
      rows: ['stage'],
      columns: ['close_quarter'],
      chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount' },
      order: [{ by: 'total_amount' }],
    });
  });

  it('CONTROL: `blocks` is untouched when the type becomes `joined`', async () => {
    const draft = { ...boundDraft, blocks: [block] };
    const patch = await switchType(draft, 'Joined');
    expect(patch).not.toHaveProperty('blocks');
    expect(merge(draft, patch).blocks, 'the same array, not a copy').toBe(draft.blocks);
  });

  it('`joined` → non-joined restores nothing: the patch is the type alone, `blocks` stays, and the author re-binds', async () => {
    const draft = { name: 'multi', label: 'Multi', type: 'joined', blocks: [block] };
    const patch = await switchType(draft, 'Summary');
    expect(patch).toStrictEqual({ type: 'summary' });
    const committed = merge(draft, patch);
    expect(committed.blocks).toBe(draft.blocks);
    for (const key of CLEARED) expect(committed).not.toHaveProperty(key);
  });
});
