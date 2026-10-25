/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6655 — an object-bound timeline REFUSES `variant: 'gantt'` with a
 * diagnostic instead of throwing.
 *
 * ## The defect this pins
 *
 * The two timeline item shapes are not interchangeable. `ObjectTimeline` maps
 * each record to a flat FEED item (`{ title, time, startDate, endDate, … }`),
 * one per record and with no nested `items`. `calculateDateRange`, on the
 * renderer's gantt branch, reads the GANTT ROW shape instead
 * (`row.items[].startDate`). Against composed feed items every `row.items` is
 * `undefined`, so `allDates` is empty, `Math.min()` over it is `Infinity`, and
 * `new Date(Infinity).toISOString()` throws `RangeError: Invalid time value`
 * during render.
 *
 * ## What was ruled, and what is therefore NOT here
 *
 * The 2026-08-29 maintainer ruling adopted "refuse loudly": the object-bound
 * path rejects gantt with a real diagnostic naming the limitation. Composing
 * real gantt rows from records (grouping by `groupByField`) was presented and
 * explicitly NOT taken — that capability stays unruled. So nothing below
 * asserts that an object-bound gantt ever renders a chart; the pin is that it
 * says why it cannot.
 *
 * ## Why the refusal is not simply `variant === 'gantt'`
 *
 * `ObjectTimeline` is also the renderer behind the BARE `timeline` key
 * (`view:timeline` in `../index`; `../renderer`'s presentational registration
 * carries `skipFallback` precisely so the bare key lands here). The in-repo
 * catalog fixture `plugin-timeline/gantt-style-timeline.json` is exactly that:
 * `type: 'timeline'`, `variant: 'gantt'`, literal gantt ROWS. Those pass
 * straight through `effectiveItems` untouched and must keep rendering. The
 * refusal therefore keys on whether this component COMPOSED the items from
 * records, which is the same `schema.items` test `effectiveItems` itself makes.
 * An over-broad refusal would take the fixture down with it, which is what the
 * literal-rows cases below exist to catch.
 *
 * ## Why the real renderer, not a stub
 *
 * The evidence is markup the real `TimelineRenderer` emits (or, before the fix,
 * the throw it raises). `ObjectTimeline.test.tsx` stubs `./renderer` and prints
 * only `item.title`, so every assertion there stays green whether or not the
 * gantt branch was ever reached — the same trap `timeline-date-binding.test.tsx`
 * documents for date bucketing. Nothing is mocked here except the ambient React
 * context hooks.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectTimeline } from '../ObjectTimeline';
import { TimelineRenderer } from '../renderer';

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

/** Records, not items — this is what the object-bound path is handed. */
const rows = [
  { id: '1', name: 'Spring Launch', start_date: '2099-09-01', end_date: '2099-09-30' },
  { id: '2', name: 'Summer Push', start_date: '2100-10-01', end_date: '2100-10-31' },
];

/**
 * The object-bound schema: no `items`, so `ObjectTimeline` composes feed items
 * from `rows`. `data` is an undeclared passthrough prop (read off the rest
 * args, the way `ListView` feeds it), so it is applied untyped.
 */
const OBJECT_BOUND = {
  type: 'timeline',
  objectName: 'campaign',
  timeline: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
};

/** Literal gantt ROWS — the shape `calculateDateRange` actually reads. Trimmed
 *  from the in-repo catalog fixture `gantt-style-timeline.json`. */
const GANTT_ROWS = [
  {
    label: 'Backend Development',
    items: [
      { title: 'API Design', startDate: '2024-01-01', endDate: '2024-01-31', variant: 'success' },
      { title: 'Implementation', startDate: '2024-02-01', endDate: '2024-03-31', variant: 'info' },
    ],
  },
  {
    label: 'Frontend Development',
    items: [
      { title: 'UI Design', startDate: '2024-01-15', endDate: '2024-02-15', variant: 'warning' },
    ],
  },
];

function renderObjectBound(schema: Record<string, unknown>) {
  const props = { schema, data: rows } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  return render(<ObjectTimeline {...props} />);
}

const diagnostic = () => screen.queryByTestId('timeline-unsupported-variant');

describe('pin 1 — object-bound + `variant: gantt` refuses loudly (objectui#6655)', () => {
  it('renders the diagnostic instead of throwing `RangeError: Invalid time value`', () => {
    // The whole defect in one assertion: before the refusal this call throws
    // out of `calculateDateRange`.
    expect(() => renderObjectBound({ ...OBJECT_BOUND, variant: 'gantt' })).not.toThrow();

    const el = diagnostic();
    expect(el, 'the object-bound gantt path renders no diagnostic').not.toBeNull();
    expect(el!.getAttribute('role'), 'the diagnostic is not announced').toBe('alert');
  });

  it('names the limitation the ruling requires it to name', () => {
    renderObjectBound({ ...OBJECT_BOUND, variant: 'gantt' });
    const text = diagnostic()!.textContent ?? '';

    // Not a bare "something went wrong": the author has to be able to act on
    // it. The refused value, the variants that DO work here, and the reason
    // gantt does not.
    expect(text).toContain('gantt');
    expect(text).toContain('vertical');
    expect(text).toContain('horizontal');
    expect(text.toLowerCase()).toContain('literal rows');
  });

  it('renders no gantt chrome at all — the crash site is never reached', () => {
    renderObjectBound({ ...OBJECT_BOUND, variant: 'gantt' });

    // A rendered gantt would carry the row-label header from
    // `timeline.gantt.rowLabel` ("Items") and a bar per record.
    expect(screen.queryByText('Items')).toBeNull();
    expect(screen.queryByText('Spring Launch')).toBeNull();
  });
});

describe('pin 1b — the composed `scale` is no longer silently inert on this path', () => {
  it('an authored gantt axis now produces the diagnostic, not an ignored option', () => {
    // `ObjectTimeline` resolves `timeline.scale ?? schema.scale` and composes it
    // into the schema it hands the renderer (objectui#6355). That axis is a
    // GANTT-only concern, and on the object-bound path gantt was unreachable —
    // the axis was configuration for a variant that crashed. The author now
    // gets told why instead of getting nothing.
    renderObjectBound({
      ...OBJECT_BOUND,
      variant: 'gantt',
      timeline: { ...OBJECT_BOUND.timeline, scale: 'year' },
    });

    expect(diagnostic(), 'no diagnostic for an object-bound gantt carrying an axis').not.toBeNull();
    // The `year` axis these records would have produced. Its absence is the
    // measurement: no axis was drawn, and the author was told, rather than the
    // option being consumed by a path that cannot use it.
    expect(screen.queryByText('2099')).toBeNull();
    expect(screen.queryByText('2100')).toBeNull();
  });
});

describe('pin 2 — object-bound feed variants are unchanged (objectui#6655)', () => {
  it('`vertical` still renders its records and its bucket header', () => {
    renderObjectBound({ ...OBJECT_BOUND, variant: 'vertical' });

    expect(screen.getByText('Spring Launch')).toBeDefined();
    expect(screen.getByText('Summer Push')).toBeDefined();
    // The bucket header the vertical renderer emits — proof the real renderer
    // ran, not just that some text survived.
    expect(screen.getByText('Later')).toBeDefined();
    expect(diagnostic(), 'the refusal leaked onto a feed variant').toBeNull();
  });

  it('`horizontal` still renders its records', () => {
    renderObjectBound({ ...OBJECT_BOUND, variant: 'horizontal' });

    expect(screen.getByText('Spring Launch')).toBeDefined();
    expect(screen.getByText('Summer Push')).toBeDefined();
    expect(diagnostic(), 'the refusal leaked onto a feed variant').toBeNull();
  });

  it('the default variant (no `variant` key at all) still renders', () => {
    // `TimelineRenderer` defaults to `vertical`; a refusal keyed on anything
    // looser than an explicit `gantt` would take this with it.
    renderObjectBound({ ...OBJECT_BOUND });

    expect(screen.getByText('Spring Launch')).toBeDefined();
    expect(diagnostic()).toBeNull();
  });
});

describe('pin 3 — literal gantt rows are unchanged (objectui#6655)', () => {
  it('`ObjectTimeline` passes authored gantt rows straight through and renders them', () => {
    // The in-repo catalog fixture's shape, through the component that owns the
    // bare `timeline` key. This is the case an over-broad refusal breaks.
    render(
      <ObjectTimeline
        schema={{ type: 'timeline', variant: 'gantt', scale: 'month', items: GANTT_ROWS } as any}
      />,
    );

    expect(diagnostic(), 'the refusal caught an authored gantt').toBeNull();
    expect(screen.getByText('Backend Development')).toBeDefined();
    expect(screen.getByText('Frontend Development')).toBeDefined();
    expect(screen.getByText('API Design')).toBeDefined();
    expect(screen.getByText('UI Design')).toBeDefined();
  });

  it('an authored `rowLabel` still reaches the gantt header', () => {
    render(
      <ObjectTimeline
        schema={{ type: 'timeline', variant: 'gantt', items: GANTT_ROWS, rowLabel: 'Projects' } as any}
      />,
    );

    expect(diagnostic()).toBeNull();
    expect(screen.getByText('Projects')).toBeDefined();
  });

  it('the presentational `TimelineRenderer` is untouched by this card', () => {
    // The literal-rows path as the renderer sees it directly — no
    // `ObjectTimeline` in the way. The crash site (`calculateDateRange`) still
    // does exactly what it did.
    render(<TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', items: GANTT_ROWS } as any} />);

    expect(diagnostic()).toBeNull();
    expect(screen.getByText('Backend Development')).toBeDefined();
    expect(screen.getByText('API Design')).toBeDefined();
  });
});
