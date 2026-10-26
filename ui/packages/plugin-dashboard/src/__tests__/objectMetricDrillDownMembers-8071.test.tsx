/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-metric.drillDown` — the MEMBER SHAPE of the click-through config
 * (objectui#8071).
 *
 * The member pin for the second of the two PRESENTATION keys objectui#8071's
 * ninth slice takes, and the one that needs its cut stated: `drillDown` DOES
 * issue a query of its own — the drawer's record list runs off the metric's
 * resolved filter — so "reaches an adapter" is not what separates these two
 * keys from slice 8's four. The line is `fetchMetric` / `computeOne`, the path
 * that produces the NUMBER. This key cannot change the number; it decides what
 * opens when the number is clicked.
 *
 * Asserted through the REGISTERED block (`type: 'object-metric'` mounted by
 * `SchemaRenderer`) rather than on `ObjectMetricWidget` directly, so the pin
 * covers the path an author reaches: the block's `ElementDataSourceGate` shell
 * re-binds only `objectName` and `filter` and forwards this key untouched.
 *
 * ## What the protocol says, and why this pin is BEHAVIOUR
 *
 * `@objectstack/spec`'s `ObjectMetricPropsSchema` governs this block and
 * declares the key as `z.unknown().optional()`, described as "Click-through
 * drill config — opens the underlying records". The protocol deliberately does
 * not pin the member shape, so — exactly as `object-kanban.swimlaneField`
 * records for its own `z.unknown()` row — the READ SITE is the whole member
 * contract this block carries, and a member pin here can only be a reading of
 * the renderer. Declaring a narrower `object-metric` drill schema on this side
 * would make this repo stricter than the protocol it renders, which is the
 * wrong direction to fix anything in.
 *
 * ⚠️ AMENDED (objectui#9002): for two members that direction was ruled on.
 * Ruling B on objectui#9002 refuses `filter` and `mode` on this block's TYPE
 * (`ObjectMetricDrillDownConfig`), because a metric can never honour either.
 * That refusal is compile-time only and is pinned at that level in
 * `ObjectMetricWidget.drillDownRefusal-9002.test.tsx`; this file still reads
 * the renderer and nothing else.
 *
 * ## The members `ObjectMetricWidget` actually reads
 *
 *   - **`enabled`** — through `isDrillEnabled`, which is `config.enabled !==
 *     false`, NOT `!!config.enabled`. So `{}` is ENABLED and only an explicit
 *     `false` turns it off. That distinction is the row a "simplification" to
 *     a truthiness check silently breaks, and it is pinned with all four arms
 *     (absent / `{}` / `true` / `false`) against each other.
 *   - **`enabled` is not sufficient on its own.** The tile becomes clickable
 *     only when an object name AND a data source are also present — a drill
 *     that could not list anything is not offered, rather than offered and
 *     empty.
 *   - **`target`** — `'dialog'` draws a centred modal, anything else the
 *     edge-anchored side sheet. Each arm is the other's control, so a renderer
 *     that drew one shape for both cannot pass.
 *   - **`title`** — through `resolveDrillTitle`, which OUTRANKS the tile's own
 *     `title` and `label`. The fallback chain below it is `title` then `label`
 *     then the literal "Details".
 *   - **`report`** — its own SHAPE selects the branch: a dataset-bound report
 *     (a `dataset`; objectui#11506 retired the pre-9.0 `objectName` / `columns`
 *     markers) sends the drawer body to a `report` node wrapping it
 *     (`spec-report` until objectui#11440), and anything else falls through to
 *     the inline record list. That is asserted on the observable that separates the two
 *     branches — whether the record list is fetched at all.
 *
 * And the invariant the whole key hangs off: the drilled record list is scoped
 * by the METRIC's own resolved filter, macros already substituted. The
 * registration promises exactly this ("The same filter narrows the drill-down
 * list, so the number and the records behind it always agree"), and a drawer
 * that listed every row of the object would be the quiet failure — a plausible
 * record list that answers a different question from the tile above it.
 *
 * ## LIMITS, stated rather than frozen into an assertion
 *
 * `DrillDownConfig` is shared by five widgets, and when this pin was written
 * this one hand-rolled its own drawer instead of using `DrillDownDrawer`. Three
 * members the shared component honours had no read site on this block:
 * `columns`, `maxRows`, and `target: 'navigate'`. `filter` and `mode` had none
 * either — a metric has no click event to interpolate `${event.*}` against, and
 * its whole slice is the one filter. None of that was asserted here: pinning
 * "this member is dead" would freeze the gap instead of reporting it, and a pin
 * that has to be deleted before the gap can be closed is worse than no pin.
 * Filed as objectui#8970.
 *
 * ⇒ objectui#8970 has since routed the block through `DrillDownDrawer`, and the
 * restraint paid out exactly as intended: the first three now ACT and not one
 * assertion in this file had to be deleted to let them — every row below still
 * passes unchanged against the shared drawer. Their effects are pinned in
 * `ObjectMetricWidget.drillRoutedToSharedDrawer-8970.test.tsx`. `filter` and
 * `mode` are still unread here (the shared drawer honours neither), and are
 * still deliberately not asserted here; objectui#9002 refused them on the
 * type instead (see the amendment above).
 *
 * ## Nothing pre-existing covered this key
 *
 * Measured, then read end to end. The repo's locator (`memberPinProblem`)
 * requires a pin file to name BOTH the block and the key; exactly ONE collected
 * file names `object-metric` and `drillDown`, and it is
 * `registry-inputs-spec-parity.test.ts` — the ledger itself.
 *
 * `ObjectMetricWidget.i18nLabel.test.tsx` is the trap slice 8 flagged, and the
 * re-measurement corrects half of its description: it contains ZERO occurrences
 * of the string `object-metric` (control: `ObjectMetricWidget` reads 15 in the
 * same file), so it does not satisfy this repo's locator — only one keyed on
 * the key name alone. It authors `drillDown: { enabled: true }` three times,
 * purely to make the tile clickable, and its subject is `I18nLabel` resolution:
 * that an inline per-locale map reaches the drawer heading rather than
 * collapsing to the literal "Details". It asserts nothing about `enabled`'s
 * three-way reading, `target`, `report`, `drillDown.title`'s precedence, or the
 * filter the record list is scoped by — so it is not promoted, and its own
 * subject is left intact.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-metric` AND the `object-data-table` the drawer body renders,
// at MODULE scope — object-ui/no-dynamic-import-in-test-hook.
import '../index';

afterEach(cleanup);

type Params = Record<string, unknown>;

/** Aggregates the number, lists the records, and answers the table's schema probe. */
const drillAdapter = () => ({
  aggregate: vi.fn(async (_object: string, _params: Params) => [{ amount_sum: 120 }]),
  find: vi.fn(async (_object: string, _params: Params) => ({
    data: [{ id: '1', name: 'Acme Renewal' }],
  })),
  getObjectSchema: vi.fn(async () => ({ fields: { name: { type: 'text', label: 'Name' } } })),
});

const BASE = {
  type: 'object-metric',
  objectName: 'deal',
  label: 'Revenue',
  aggregate: { field: 'amount', function: 'sum' },
  filter: { stage: 'won' },
} as const;

const mount = (schema: Record<string, unknown>, adapter?: unknown) =>
  render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={{ ...BASE, ...schema } as never} />
    </SchemaRendererProvider>,
  );

/** Open the drill panel and hand back the panel element. */
const openPanel = async () => {
  fireEvent.click(await screen.findByRole('button'));
  return screen.findByRole('dialog');
};

/**
 * Which of the two panel shapes was drawn, read off the layout the primitive
 * commits to: the dialog is centred by transform, the sheet is anchored to an
 * edge. Returned as one value so the two `target` rows control each other.
 */
const panelKind = (panel: HTMLElement): 'modal' | 'sheet' | 'unknown' => {
  const cls = panel.className;
  if (cls.includes('translate-x-[-50%]')) return 'modal';
  if (cls.includes('inset-y-0') && cls.includes('right-0')) return 'sheet';
  return 'unknown';
};

/** The `$filter` of the drilled record list's fetch. */
const drillFilterOf = (adapter: ReturnType<typeof drillAdapter>) =>
  (adapter.find.mock.calls[0]?.[1] as { $filter?: unknown } | undefined)?.$filter;

describe('object-metric — `drillDown.enabled` decides whether the number is clickable', () => {
  it('is NOT clickable with no `drillDown` at all', async () => {
    mount({}, drillAdapter());
    expect(await screen.findByText('Revenue')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is NOT clickable when `enabled` is explicitly false', async () => {
    mount({ drillDown: { enabled: false } }, drillAdapter());
    expect(await screen.findByText('Revenue')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is clickable when `enabled` is true', async () => {
    mount({ drillDown: { enabled: true } }, drillAdapter());
    expect(await screen.findByRole('button')).toBeTruthy();
  });

  it('is clickable on an EMPTY config — the read is `!== false`, not truthiness', async () => {
    // The row a "simplification" to `!!config.enabled` turns red, and the
    // reason the four arms are pinned as a set rather than one positive.
    mount({ drillDown: {} }, drillAdapter());
    expect(await screen.findByRole('button')).toBeTruthy();
  });

  it('is NOT clickable when `enabled` is true but nothing could be listed', async () => {
    // No data source: a drill that cannot fetch records is withheld rather
    // than offered and empty.
    mount({ drillDown: { enabled: true }, fallbackValue: 42 }, undefined);
    expect(await screen.findByText('Revenue')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('object-metric — `drillDown.target` chooses the panel shape', () => {
  it('draws the edge-anchored sheet when `target` is omitted', async () => {
    mount({ drillDown: { enabled: true } }, drillAdapter());
    expect(panelKind(await openPanel())).toBe('sheet');
  });

  it('draws the centred modal on `target: "dialog"`', async () => {
    mount({ drillDown: { enabled: true, target: 'dialog' } }, drillAdapter());
    expect(panelKind(await openPanel())).toBe('modal');
  });
});

describe('object-metric — `drillDown.title` and the chain below it', () => {
  it('OUTRANKS both the tile `title` and the tile `label`', async () => {
    mount(
      {
        title: 'Tile title',
        drillDown: { enabled: true, title: 'Drill panel heading' },
      },
      drillAdapter(),
    );
    await openPanel();
    const heading = await screen.findByRole('heading');
    expect(heading.textContent).toBe('Drill panel heading');
  });

  it('falls back to the tile `title` when the config carries none', async () => {
    mount({ title: 'Tile title', drillDown: { enabled: true } }, drillAdapter());
    await openPanel();
    expect((await screen.findByRole('heading')).textContent).toBe('Tile title');
  });

  it('falls back to the tile `label` when neither is authored', async () => {
    // `label` is 'Revenue' from BASE — and the chain's last resort, the literal
    // "Details", must NOT be what a titled tile gets.
    mount({ drillDown: { enabled: true } }, drillAdapter());
    await openPanel();
    const heading = await screen.findByRole('heading');
    expect(heading.textContent).toBe('Revenue');
    expect(heading.textContent).not.toBe('Details');
  });
});

describe('object-metric — the drilled list agrees with the number', () => {
  it('scopes the record list by the METRIC filter, macros already resolved', async () => {
    const adapter = drillAdapter();
    mount(
      {
        filter: { close_date: { $gte: '{current_quarter_start}' }, stage: 'won' },
        drillDown: { enabled: true },
      },
      adapter,
    );
    await openPanel();

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('deal');
    const $filter = drillFilterOf(adapter) as {
      stage?: unknown;
      close_date?: { $gte?: unknown };
    };
    expect($filter.stage).toBe('won');
    // A macro that survived onto the wire is a literal nobody matches, and the
    // drawer would answer a different question from the tile above it.
    expect($filter.close_date?.$gte).not.toBe('{current_quarter_start}');
    expect(String($filter.close_date?.$gte)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe('object-metric — `drillDown.report` selects the drawer body by its SHAPE', () => {
  it('sends a dataset-bound report to the report body, not the record list', async () => {
    const adapter = drillAdapter();
    mount(
      {
        drillDown: {
          enabled: true,
          report: { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] },
        },
      },
      adapter,
    );
    await openPanel();

    // The record-list branch is the one that fetches; the report branch hands
    // the body to a `report` node wrapping the report instead.
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it.each([
    ['a value that is no report', { note: 'not a report' }],
    // objectui#11506 — the retired pre-9.0 object-bound form is no longer a report drill.
    ['the retired `objectName` report', { name: 'pipeline', objectName: 'deal', columns: [] }],
  ])('falls through to the record list for %s', async (_label, report) => {
    // The control that makes the row above a reading of `report`'s SHAPE
    // rather than of its mere presence.
    const adapter = drillAdapter();
    mount({ drillDown: { enabled: true, report } }, adapter);
    await openPanel();

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(drillFilterOf(adapter)).toMatchObject({ stage: 'won' });
  });
});
