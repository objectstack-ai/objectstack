/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7070 step ③ — the refusal is REACHABLE THROUGH THE PLUGIN FACES.
 *
 * The three-step ruling of 2026-09-01 (总监批 #28) put its halves in three
 * packages, and no one of them can observe the whole:
 *
 *   ① / ② `ObjectTimeline` refuses an absent date axis and no longer floors it
 *          at `'date'` — pinned in `plugin-timeline`, which never sees a face;
 *   ③      `ListView` and `ObjectView` stop supplying `'created_at'` — pinned
 *          in `plugin-list` / `plugin-view`, which stub the renderer and so can
 *          only measure the PROP, never the screen.
 *
 * ①② landed first and, by their own measurement, changed nothing a user could
 * see — precisely because the faces still filled the flat `startDateField` rung
 * that `plugin-timeline`'s CONTROL block proves is a fully honoured binding. So
 * "the refusal exists" and "the face stopped inventing" were both true and still
 * did not add up to a refusal on screen. This file is the join, and the console
 * is where it can be made: it is the only package that depends on all three.
 *
 * ⭐ The rows carry a real `created_at` column, deliberately. That is the data
 * shape under which a restored floor renders a CONVINCING timeline — two real
 * events off a real column — rather than an empty one, so a pin that only
 * counted events would pass in both worlds. The same trick, for the same
 * reason, as the `date` column in `ObjectTimeline.absentDateAxisRefusal-7459`.
 *
 * ⚠️ A refusal is asserted POSITIVELY and paired with the canvas marker, because
 * the failure this most resembles is a component that threw: "no timeline" is
 * satisfied by a crash. Every block opens with a render proof, and every
 * absence asserted here is asserted PRESENT by a control in the same run.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore either face's `|| 'created_at'` and that face's refusal case goes RED
 * — and it goes red rendering a healthy two-event timeline, not an error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
import { ObjectView } from '@object-ui/plugin-view';
import { ObjectTimeline } from '@object-ui/plugin-timeline';

// The REAL renderer, registered under the type both faces emit. Stubbing it is
// what every face-level test does and exactly what this file exists not to do.
ComponentRegistry.register('object-timeline', ObjectTimeline as never, {
  namespace: 'test',
  label: 'Object Timeline (real)',
  category: 'view',
});

const ROWS = [
  { id: '1', name: 'Spring Launch', start_date: '2099-09-01', created_at: '2099-09-01T00:00:00Z' },
  { id: '2', name: 'Summer Push', start_date: '2100-10-01', created_at: '2100-10-01T00:00:00Z' },
];

const objectDef = {
  name: 'crm_campaign',
  label: 'Campaign',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    start_date: { name: 'start_date', type: 'date', label: 'Start Date' },
    created_at: { name: 'created_at', type: 'datetime', label: 'Created At' },
  },
};

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ROWS),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

const refusal = () => screen.queryByTestId('timeline-missing-date-axis');
const canvas = () => screen.queryByTestId('timeline-canvas');

/** Mount `ListView` on a timeline view, with the real renderer downstream. */
async function mountListView(schema: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
}

/** Mount `plugin-view`'s `ObjectView` on a timeline view, same downstream. */
async function mountObjectView(view: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ObjectView
        schema={{ type: 'object-view', objectName: 'crm_campaign' } as never}
        views={[{ id: 't', label: 'Timeline', type: 'timeline' as never, ...view }]}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
}

const LIST_BASE = {
  type: 'list-view',
  objectName: 'crm_campaign',
  viewType: 'timeline',
  columns: ['name'],
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ListView → ObjectTimeline: an undeclared axis reaches the refusal (objectui#7070 step ③)', () => {
  it('RENDER PROOF: a DECLARED axis renders the real timeline canvas', async () => {
    // First, and load-bearing. It proves three things the negative case below
    // silently assumes: the real component is what the registry resolves, it
    // mounts through this face without throwing, and `timeline-canvas` is a
    // marker this harness can actually observe. Without it, "no canvas" is
    // equally well explained by a crash.
    await mountListView({ ...LIST_BASE, timeline: { startDateField: 'start_date' } });
    await waitFor(() => expect(canvas()).not.toBeNull());
    expect(refusal()).toBeNull();
    expect(screen.getByText('Spring Launch')).toBeDefined();
  });

  it('a view that declares NO date axis now refuses, on screen', async () => {
    // ⭐ THE JOIN. Before step ③ this rendered a timeline bound to `created_at`
    // — a column these rows really do carry — so it looked built and was not.
    await mountListView({ ...LIST_BASE });
    await waitFor(() => expect(refusal()).not.toBeNull());

    expect(refusal()!.getAttribute('role'), 'the refusal is not announced').toBe('alert');
    // Not an EMPTY timeline: the outcome the ruling rejects would still emit the
    // canvas. Asserted present by the render proof above, in this same run.
    expect(canvas(), 'a timeline canvas was rendered beside the refusal').toBeNull();
    // …and specifically not the convincing-but-wrong chart the floor produced.
    expect(screen.queryByText('Spring Launch')).toBeNull();
    expect(screen.queryByText('Summer Push')).toBeNull();
  });

  it('the refusal names the keys the author has to declare', async () => {
    // A refusal the author cannot act on is a different defect. The list is
    // interpolated from the component's own binding vocabulary.
    await mountListView({ ...LIST_BASE });
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(refusal()!.textContent ?? '').toContain('timeline.startDateField');
  });

  it('a stored LEGACY `timeline.dateField` reaches the refusal too (objectui#6152 round 14)', async () => {
    // Step ③ kept the alias (the ruling ordered no regression for a pre-#2231
    // view), and this arm pinned that it still rendered. objectui#6152 round 14
    // retired the alias reads on their own ruling: every list-view door refuses
    // the key by name. A stored one now binds no axis, so it gets the refusal,
    // which names the key to write. The TOP-LEVEL spelling, which the core fold
    // used to rewrite, retired in the same round; the legacy `options` bag is
    // pinned beside it in the next arm.
    await mountListView({ ...LIST_BASE, timeline: { dateField: 'start_date' } });
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(canvas()).toBeNull();
    expect(refusal()!.textContent ?? '').toContain('timeline.startDateField');
  });

  it('…and from the legacy `options` bag (objectui#6152 round 14)', async () => {
    await mountListView({ ...LIST_BASE, options: { timeline: { dateField: 'start_date' } } });
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(canvas()).toBeNull();
  });

  it('CONTROL: a CALENDAR-bound view still renders its timeline', async () => {
    // objectui#3129: a calendar binding is a legitimate timeline axis in this
    // product. This is the shape most at risk from a fix aimed at "declared
    // timeline config only".
    await mountListView({ ...LIST_BASE, options: { calendar: { startDateField: 'start_date' } } });
    await waitFor(() => expect(canvas()).not.toBeNull());
    expect(refusal()).toBeNull();
  });
});

describe('ObjectView → ObjectTimeline: the second face reaches it too (objectui#7070 step ③)', () => {
  it('RENDER PROOF: a DECLARED axis renders the real timeline canvas', async () => {
    await mountObjectView({ timeline: { startDateField: 'start_date' } });
    await waitFor(() => expect(canvas()).not.toBeNull());
    expect(refusal()).toBeNull();
  });

  it('a view that declares NO date axis now refuses, on screen', async () => {
    // The route `generateViewSchema` owns — the authored `object-view` element,
    // which never passes through `ListView`. Fixing one face and not the other
    // is how this defect survived objectui#3129 for so long.
    await mountObjectView({});
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(canvas(), 'a timeline canvas was rendered beside the refusal').toBeNull();
    expect(screen.queryByText('Spring Launch')).toBeNull();
  });

  it('a stored LEGACY `timeline.dateField` reaches the refusal here too (objectui#6152 round 14)', async () => {
    await mountObjectView({ timeline: { dateField: 'start_date' } });
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(canvas()).toBeNull();
    expect(screen.queryByText('Spring Launch')).toBeNull();
  });
});
