/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8348 — `object-calendar` honours ONLY the `data` spelling its
 * published row declares.
 *
 * ## The ruling this pins
 *
 * Decision batch #83 (2026-09-08), maintainer verbatim: 「8348 以协议为准」 — the
 * CONTRACT decides. A block whose `ComponentPropsMap[...].data` row is
 * `z.array(...)` stops honouring the `{ provider, items }` record-source config
 * object under `data`: what `os validate` and the save gate refuse, the renderer
 * refuses too.
 *
 * MEASURED on the `@objectstack/spec` this repo resolves (17.4.0):
 *
 *     ComponentPropsMap['object-calendar'].data
 *       -> z.array(z.unknown()).optional()   "Pre-fetched records — skips the internal fetch"
 *     ...safeParse({ objectName: 'visit', data: { provider: 'value', items: [] } })
 *       -> success=false  [{ code: 'invalid_type', path: ['data'], expected: 'array' }]
 *
 * ## What this file adds that the shared-ladder pin cannot
 *
 * `record-source-config.behaviourNeutrality-7632.test.ts` measures the resolver
 * in isolation — the right place for the arm verdict itself, and the wrong place
 * for "does the block still draw". This file is the card's OWN harness: a real
 * `object-calendar` node, through the real `SchemaRenderer`, with a recording
 * data source. objectui#8348 was filed on exactly this instrument, and its
 * finding read
 *
 *     OBJECT-DATA grid present: true
 *     OBJECT-DATA titles:       ['Authored member one', 'Authored member two']
 *     OBJECT-DATA find calls:   0
 *
 * — rows drawn from a spelling the contract refuses, and no query. Rows 1 and 2
 * below are that same measurement after the ruling.
 *
 * ## ⛔ Why the `data` arm and the PROPS channel are BOTH exercised here
 *
 * `SchemaRenderer` spreads every non-metadata node key as a React prop, so an
 * authored `data` ARRAY arrives twice: as `rest.data` at this package's renderer
 * boundary (`index.tsx`'s `resolveExternalData`, which keeps it only when
 * `Array.isArray`) AND as `schema.data` inside the component. The
 * `{ provider, items }` OBJECT arrives only on the second carrier — the boundary
 * drops it — which is why removing the ladder's off-arm rung removes it
 * outright. Rows 3-5 hold the declared carriers still, so a change that broke
 * inline rows generally could not pass this file off as the ruling.
 *
 * ⚠️ THE ACCEPTED COST, stated as row 2: a stored calendar authored
 * `data: { provider: 'value', items: [...] }` stops drawing those rows and
 * queries its object instead. Batch #83 accepts that under the standing
 * 2026-08-27 posture — no transition windows, no staged deprecation.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// The month grid is orthogonal to what this file observes (which records became
// events, and whether a query went out). Same stub idiom as the
// `recordSourceMembers-8314` pin next door.
vi.mock('../CalendarView', () => ({
  CalendarView: ({ events }: any) => (
    <div
      data-testid="calendar-view"
      data-event-titles={events.map((e: any) => e.title).join('|')}
    />
  ),
}));

import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module scope, not a hook: this import IS the registration this file renders
// through (AGENTS.md's test-discipline section).
import '../index';

afterEach(cleanup);

const OBJECT = 'visit';
const CALENDAR = { startDateField: 'starts_at', titleField: 'name' };

const today = new Date();
const inThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0).toISOString();

/** The rows an author put in the metadata. */
const AUTHORED = [
  { id: 'r1', name: 'Authored member one', starts_at: inThisMonth(10) },
  { id: 'r2', name: 'Authored member two', starts_at: inThisMonth(12) },
];

/** The row only a real query can put on screen — the discriminator. */
const FETCHED = [{ id: 'q1', name: 'Fetched by the query', starts_at: inThisMonth(20) }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: FETCHED }),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: { id: { type: 'text' }, name: { type: 'text' }, starts_at: { type: 'datetime' } },
    }),
  } as any;
}

/**
 * A node for the `plugin-calendar:object-calendar` registration, always carrying
 * a live `objectName` so every reading below is about the authored record source
 * rather than about a calendar with nothing to fetch.
 */
const node = (extra: Record<string, unknown>) =>
  ({
    type: 'plugin-calendar:object-calendar',
    id: 'n',
    objectName: OBJECT,
    calendar: CALENDAR,
    ...extra,
  }) as never;

function renderNode(schema: unknown, dataSource: any) {
  return render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
}

async function titles(): Promise<string[]> {
  await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
  return (screen.getByTestId('calendar-view').getAttribute('data-event-titles') ?? '')
    .split('|')
    .filter(Boolean);
}

/** The config object the spec row refuses by kind. */
const OFF_ARM = { provider: 'value', items: AUTHORED };

describe('object-calendar refuses the off-arm `{ provider, items }` under `data` (objectui#8348)', () => {
  it('1. the authored rows are NOT drawn — the card’s own measurement, inverted', async () => {
    const ds = makeDataSource();
    renderNode(node({ data: OFF_ARM }), ds);

    expect(await titles()).not.toContain('Authored member one');
    expect(await titles()).not.toContain('Authored member two');
  });

  it('2. …and the block queries its object instead — the accepted cost, on screen', async () => {
    // Before this card the same document drew the authored rows and issued ZERO
    // queries. The ladder now falls past the off-arm `data` to `objectName`, so
    // the calendar resolves the `object` provider and fetches.
    const ds = makeDataSource();
    renderNode(node({ data: OFF_ARM }), ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(await titles()).toEqual(['Fetched by the query']);
    expect(ds.find.mock.calls[0][0]).toBe(OBJECT);
  });

  it('3. ⛔ CONTROL: the DECLARED array under `data` still draws, and still issues no query', async () => {
    // The arm the spec row names — "Pre-fetched records — skips the internal
    // fetch". If this row went dark, rows 1-2 would be measuring a broken
    // calendar rather than the ruling. It is also what keeps the registration's
    // published promise true: with an array `data`, `objectName` is unused and
    // `staticData` is never reached.
    const ds = makeDataSource();
    renderNode(node({ data: AUTHORED }), ds);

    expect(await titles()).toEqual(['Authored member one', 'Authored member two']);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('4. ⛔ CONTROL: `staticData` — the declared inline-rows door — still draws', async () => {
    const ds = makeDataSource();
    renderNode(node({ staticData: AUTHORED }), ds);

    expect(await titles()).toEqual(['Authored member one', 'Authored member two']);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('5. ⛔ CONTROL: the off-arm `data` does not suppress `staticData` either', async () => {
    // The ladder does not merely drop the rows: rung 1 no longer APPLIES on this
    // block, so rung 2 is reached. A reader who assumed "refused" meant "resolves
    // null" would predict an empty calendar here.
    const ds = makeDataSource();
    renderNode(node({ data: OFF_ARM, staticData: AUTHORED }), ds);

    expect(await titles()).toEqual(['Authored member one', 'Authored member two']);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('6. the spec row is what all of the above is judged against — read, not restated', async () => {
    // Derived rather than asserted as a constant: a spec release that widened
    // `object-calendar.data` to accept the object arm would turn this red, which
    // is the tripwire that says "re-derive the arm", not "delete this line".
    const { ComponentPropsMap } = await import('@objectstack/spec/ui');
    const row = ComponentPropsMap['object-calendar'];

    expect(row.safeParse({ objectName: OBJECT, data: AUTHORED }).success).toBe(true);

    const refused = row.safeParse({ objectName: OBJECT, data: OFF_ARM });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      const issue = refused.error.issues.find((i: any) => i.path[0] === 'data');
      expect(issue?.code).toBe('invalid_type');
      expect((issue as any)?.expected).toBe('array');
    }
  });
});
