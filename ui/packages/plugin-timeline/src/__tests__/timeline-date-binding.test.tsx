/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3129 — the timeline must bucket records by the date field its
 * config names.
 *
 * Deliberately does NOT mock `./renderer`. `ObjectTimeline.test.tsx` replaces
 * it with a stub that prints only `item.title`, so every assertion there passes
 * whether or not the date binding resolved — which is exactly how a timeline
 * that renders all of its records under "No date" shipped green. The date lives
 * in the bucket header the real renderer emits, so these tests read that.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectTimeline } from '../ObjectTimeline';
import type { ObjectTimelineProps } from '../ObjectTimeline';
import type { ListViewSchema, ListViewTimelineConfig } from '@object-ui/types';

/**
 * objectui#6152 round 12 (seat answer Q2 → B): the component's nested
 * `timeline` prop is the list view's own block, `NonNullable<ListViewSchema['timeline']>`,
 * and that type refuses the legacy `dateField` by name. Compile-time pins: the
 * equality below, and the `@ts-expect-error` on a typed block carrying the alias
 * (the directive itself fails to compile if the type ever admits it again).
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const nestedTimelineIsTheListViewBlock: Equal<
  NonNullable<ObjectTimelineProps['schema']['timeline']>,
  NonNullable<ListViewSchema['timeline']>
> = true;
const aliasRefusedByTheType: ListViewTimelineConfig = {
  // @ts-expect-error `dateField` is refused by name: write `startDateField`.
  dateField: 'start_date',
  titleField: 'name',
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
    useObjectLabel: () => ({
      fieldOptionLabel: (_o: string, _f: string, _v: string, fb: string) => fb,
      translateOptions: (_o: string, _f: string, opts: unknown[]) => opts,
      fieldLabel: (_o: string, _f: string, fb: string) => fb,
    }),
  };
});

/** Two campaigns comfortably in the future, so both land in the "Later" bucket. */
const rows = [
  { id: '1', name: 'Spring Launch', start_date: '2099-09-01', end_date: '2099-09-30' },
  { id: '2', name: 'Summer Push', start_date: '2099-10-01', end_date: '2099-10-31' },
];

/** The bucket headers the vertical renderer emits above each group. */
const bucketLabels = () =>
  Array.from(document.querySelectorAll('section > header > span:first-child')).map(
    (el) => el.textContent,
  );

async function renderTimeline(schema: Record<string, unknown>) {
  // `data` is an undeclared passthrough prop on ObjectTimelineProps (the
  // component reads it off the rest args, which is how ListView feeds it), so
  // it has to be applied untyped here.
  const props = { schema, data: rows } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  render(<ObjectTimeline {...props} />);
  await waitFor(() => expect(screen.getByText('Spring Launch')).toBeDefined());
}

describe('ObjectTimeline — honours the configured date field (objectui#3129)', () => {
  it('buckets by the nested spec key `timeline.startDateField`', async () => {
    await renderTimeline({
      type: 'object-timeline',
      objectName: 'crm_campaign',
      titleField: 'name',
      timeline: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
    });
    expect(bucketLabels()).toEqual(['Later']);
  });

  it('binds NOTHING from the retired nested alias `timeline.dateField` (objectui#6152 round 14)', async () => {
    // objectui#3129 gave this alias a rung on the nested config; objectui#6152
    // round 12 refused it by name on the TYPE (pinned at the top of this file)
    // and round 14 retired the READ. A block stored before the doors closed and
    // handed in untyped therefore binds no axis. With no other binding the
    // component refuses (objectui#7459) rather than inventing one, and the
    // refusal no longer names the alias as something to write.
    expect(nestedTimelineIsTheListViewBlock).toBe(true);
    expect(aliasRefusedByTheType.titleField).toBe('name');
    const props = {
      schema: {
        type: 'object-timeline',
        objectName: 'crm_campaign',
        titleField: 'name',
        timeline: { dateField: 'start_date', titleField: 'name' },
      },
      data: rows,
    } as unknown as React.ComponentProps<typeof ObjectTimeline>;
    render(<ObjectTimeline {...props} />);
    const refusal = await screen.findByTestId('timeline-missing-date-axis');
    expect(refusal.textContent).toContain('timeline.startDateField');
    expect(refusal.textContent).not.toContain('timeline.dateField');
    expect(screen.queryByText('Spring Launch')).toBeNull();
  });

  it('still honours the flat legacy props when no nested config is given', async () => {
    await renderTimeline({
      type: 'object-timeline',
      objectName: 'crm_campaign',
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
    });
    expect(bucketLabels()).toEqual(['Later']);
  });

  it('reports "No date" only when the named field really is absent', async () => {
    // The honest negative: a binding that names a field the rows do not carry
    // must still degrade to the no-date bucket rather than inventing an axis.
    await renderTimeline({
      type: 'object-timeline',
      objectName: 'crm_campaign',
      titleField: 'name',
      timeline: { startDateField: 'due_date', titleField: 'name' },
    });
    expect(bucketLabels()).toEqual(['No date']);
  });
});
