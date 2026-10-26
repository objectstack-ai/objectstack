/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7459 — an object-bound `ObjectTimeline` that declares NO date axis
 * refuses, and the refusal is REACHABLE.
 *
 * The sibling of `plugin-gantt`'s `ObjectGantt.unconfiguredRefusal-7070` and of
 * `plugin-calendar`'s #7029 twin, written for the maintainer ruling those two
 * produced (2026-09-01, objectui#7070, 总监批 #28): house posture is
 * 日期轴永不虚构 — a date axis is never fabricated.
 *
 * ## Why one file pins TWO changes
 *
 * The ruling ordered a refusal screen (①) and the retirement of the renderer's
 * own invented field name at the end of its resolver chain (②), and neither is
 * observable alone:
 *
 *   - a refusal added while the floor stands can never be TAKEN — the floor
 *     guaranteed a name always resolved, so the branch is dead code;
 *   - the floor retired with no refusal produces the outcome the ruling
 *     explicitly rejects: every record reads a key no object carries and
 *     buckets into "No date" — a timeline that looks built and is not.
 *
 * So the pairing itself is the subject. `renders the refusal` and `stays
 * reachable` below both go RED the moment the floor returns, and the fully
 * declared CONTROLS stay GREEN in both worlds — the asymmetry that separates
 * "stopped inventing" from "refuses everything".
 *
 * ## Refusal is not "an empty timeline", and that is asserted, not assumed
 *
 * The failure mode the ruling is trying to avoid renders a real timeline with
 * nothing on it, so a pin that only counts events passes on BOTH outcomes. Two
 * independent canvas markers are therefore asserted ABSENT here, each proven
 * non-vacuous by a control in this same file that asserts it PRESENT:
 *
 *   1. `data-testid="timeline-canvas"` — the component's own success surface.
 *      Named by #7459 precisely so this distinction could be measured; every
 *      other terminal state of the component already named itself.
 *   2. `role="list"` — the `<ol>` rail the REAL `TimelineRenderer` emits. An
 *      empty timeline still emits it, which is what makes it discriminating.
 *
 * The renderer is deliberately NOT stubbed, for the reason
 * `__tests__/timeline-object-bound-gantt-refusal.test.tsx` states one file
 * over: `ObjectTimeline.test.tsx` stubs `./renderer` and prints only titles, so
 * assertions there stay green whether or not the branch under test was reached.
 * Only the ambient React context hooks are mocked.
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectTimeline } from './ObjectTimeline';
import type { ListViewTimelineConfig } from '@object-ui/types';

// objectui#6152 round 12: the typed nested block refuses the alias by name.
const aliasRefusedByTheType: ListViewTimelineConfig = {
  // @ts-expect-error `dateField` is refused by name: write `startDateField`.
  dateField: 'start_date',
};

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
  };
});

afterEach(cleanup);

/**
 * Records, not items — this is what the object-bound path is handed.
 *
 * Every row carries `start_date` (the name an author would DECLARE) and, on
 * purpose, a column literally named `date` as well. That second column is the
 * reachability case's whole point: it is the data shape under which a returned
 * floor renders a CONVINCING timeline rather than an empty one, so "no events"
 * would not have caught it. Nobody declared `date`; the refusal must still fire.
 */
const ROWS = [
  { id: '1', name: 'Spring Launch', start_date: '2099-09-01', end_date: '2099-09-30', date: '2099-09-01' },
  { id: '2', name: 'Summer Push', start_date: '2100-10-01', end_date: '2100-10-31', date: '2100-10-01' },
];

/** The same rows with the incidental `date` column removed. */
const ROWS_WITHOUT_DATE_COLUMN = ROWS.map(({ date: _date, ...rest }) => rest);

function renderObjectBound(schema: Record<string, unknown>, rows: unknown[] = ROWS) {
  const props = { schema, data: rows } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  return render(<ObjectTimeline {...props} />);
}

const refusal = () => screen.queryByTestId('timeline-missing-date-axis');
const canvas = () => screen.queryByTestId('timeline-canvas');
/** The `<ol>` rail the real renderer emits — present even for zero events. */
const rails = () => screen.queryAllByRole('list');

const OBJECT_BOUND = { type: 'timeline', objectName: 'campaign' };

describe('ObjectTimeline — an undeclared date axis is REFUSED (objectui#7459)', () => {
  it('renders the refusal, and the CANVAS IS ABSENT — not an empty timeline', () => {
    renderObjectBound({ ...OBJECT_BOUND }, ROWS_WITHOUT_DATE_COLUMN);

    const el = refusal();
    expect(el, 'an object-bound timeline with no declared date axis rendered no refusal').not.toBeNull();
    expect(el!.getAttribute('role'), 'the refusal is not announced').toBe('alert');

    // The distinction the ruling asked to be measured. Both markers, each of
    // which a control below asserts PRESENT, so neither zero is vacuous.
    expect(canvas(), 'a timeline canvas was rendered beside the refusal').toBeNull();
    expect(rails(), 'the timeline rail was rendered beside the refusal').toHaveLength(0);

    // …and specifically NOT the outcome the ruling rejects: every record
    // bucketed under "No date" on an axis nobody declared.
    expect(screen.queryByText('No date')).toBeNull();
    expect(screen.queryByText('Spring Launch')).toBeNull();
    expect(screen.queryByText('Summer Push')).toBeNull();
  });

  it('stays reachable when the records HAPPEN to carry a column named `date`', () => {
    // THE PAIRING CASE. Restore the retired floor and this one goes red while
    // rendering something that looks entirely healthy: two real events off a
    // real column. Declared-ness, not existence, is what the axis is.
    renderObjectBound({ ...OBJECT_BOUND }, ROWS);

    expect(refusal(), 'a column named `date` resurrected the fabricated axis').not.toBeNull();
    expect(canvas()).toBeNull();
    expect(rails()).toHaveLength(0);
    expect(screen.queryByText('Spring Launch')).toBeNull();
  });

  it('REFUSES a half-declared axis — an end date alone is not a timeline axis', () => {
    // `endDateField` falls back to the start axis, so a view that declared only
    // an end date declared no axis to lay events on. The same judgement
    // `getGanttConfig` makes when it refuses a half-declared gantt.
    renderObjectBound({ ...OBJECT_BOUND, timeline: { endDateField: 'end_date' } });

    expect(refusal()).not.toBeNull();
    expect(canvas()).toBeNull();
  });

  it('names the fields the author has to declare', () => {
    renderObjectBound({ ...OBJECT_BOUND });
    const text = refusal()!.textContent ?? '';

    // Not a bare "not configured": the author must be able to act on it. The
    // list is interpolated from the component's own
    // `OBJECT_BOUND_TIMELINE_DATE_BINDINGS`, so this asserts the real
    // vocabulary rather than a sentence that could drift from the resolver.
    for (const binding of ['timeline.startDateField', 'mapping.date', 'dateField']) {
      expect(text, `the refusal does not name \`${binding}\``).toContain(binding);
    }
    // objectui#6152 round 14: the nested alias is no longer read, so the
    // refusal no longer sends the author to it.
    expect(text, 'the refusal names the retired nested alias').not.toContain('timeline.dateField');
  });

  it('REFUSES a stored block that binds its axis only through the retired `timeline.dateField` (objectui#6152 round 14)', () => {
    // The typed block refuses the alias by name (`aliasRefusedByTheType` above,
    // objectui#6152 round 12), and round 14 retired the rung that still read
    // it. A block stored before the doors closed, handed in untyped, therefore
    // declares no axis this component reads, and it gets the same refusal as a
    // block that declares none.
    renderObjectBound({ ...OBJECT_BOUND, timeline: { ...aliasRefusedByTheType } }, ROWS_WITHOUT_DATE_COLUMN);

    expect(refusal()).not.toBeNull();
    expect(canvas()).toBeNull();
    expect(screen.queryByText('Spring Launch')).toBeNull();
  });

  it('leaves the objectui#6655 variant refusal first for a composed gantt', () => {
    // Both refusals apply to this schema. The variant one wins deliberately:
    // "this path does not render gantt" is the more useful first sentence for a
    // chart that would be refused either way. Pinned so the order is a decision
    // rather than an accident of line placement.
    renderObjectBound({ ...OBJECT_BOUND, variant: 'gantt' });

    expect(screen.queryByTestId('timeline-unsupported-variant')).not.toBeNull();
    expect(refusal()).toBeNull();
    expect(canvas()).toBeNull();
  });
});

describe('ObjectTimeline — every DECLARED rung still resolves (objectui#7459)', () => {
  // Without these a fix that refused EVERYTHING would pass the block above,
  // and retiring the floor could have taken a declared binding with it. Each
  // case is one rung of the resolver chain, in its own spelling: the nested
  // `timeline` block for the first, this component's props and
  // `TimelineExtensionSchema` for the rest. The nested `timeline.dateField`
  // alias is not a rung since objectui#6152 round 14; the refusal block above
  // pins what a stored one gets.
  const RUNGS: Array<[string, Record<string, unknown>]> = [
    ['timeline.startDateField', { timeline: { startDateField: 'start_date' } }],
    ['mapping.date', { mapping: { date: 'start_date' } }],
    ['startDateField (flat, deprecated)', { startDateField: 'start_date' }],
    ['dateField (flat, deprecated)', { dateField: 'start_date' }],
  ];

  for (const [label, binding] of RUNGS) {
    it(`CONTROL: \`${label}\` renders the timeline, with its events`, () => {
      renderObjectBound({ ...OBJECT_BOUND, ...binding }, ROWS_WITHOUT_DATE_COLUMN);

      expect(refusal(), `a declared \`${label}\` was refused`).toBeNull();
      // Both absence markers from the refusal cases, asserted PRESENT here —
      // this is what makes those zeros readings rather than phantom checks.
      expect(canvas(), 'the timeline canvas is missing on a declared axis').not.toBeNull();
      expect(rails().length, 'the timeline rail is missing on a declared axis').toBeGreaterThan(0);
      expect(screen.getByText('Spring Launch')).toBeDefined();
      expect(screen.getByText('Summer Push')).toBeDefined();
    });
  }

  it('CONTROL: an AUTHORED item list is never refused — it declares no field names', () => {
    // The carve-out that keeps the in-repo catalog fixtures
    // (`vertical-timeline.json` / `horizontal-timeline.json` /
    // `gantt-style-timeline.json`) rendering: an authored item carries its own
    // `time`, so no field NAME is read for it and there is no axis to declare.
    // A refusal keyed on anything looser than "this component COMPOSED the
    // items" would take every literal timeline down with it.
    render(
      <ObjectTimeline
        schema={{
          type: 'timeline',
          items: [
            { time: '2024-01-15', title: 'Project Started', description: 'Kickoff' },
            { time: '2024-02-01', title: 'First Milestone', description: 'Design done' },
          ],
        } as any}
      />,
    );

    expect(refusal(), 'an authored timeline was refused for declaring no date FIELD').toBeNull();
    expect(canvas()).not.toBeNull();
    expect(screen.getByText('Project Started')).toBeDefined();
    expect(screen.getByText('First Milestone')).toBeDefined();
  });
});
