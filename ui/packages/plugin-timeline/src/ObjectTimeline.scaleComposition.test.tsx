/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTimeline` composes the gantt axis under the canonical `scale`
 * (objectui#6355).
 *
 * ## Why this one needed its own pin
 *
 * `ObjectTimeline` resolves the axis (`timelineConfig?.scale ?? schema.scale`)
 * and writes it into the schema it hands to `TimelineRenderer`. Until this card
 * it wrote the RETIRED `timeScale` alias.
 *
 * That made it the highest-risk writer of the three the retirement had to
 * migrate, and the only one no grep of authored metadata would find: it is a
 * COMPOSED object, not a document anybody authors. Dropping
 * `resolveTimelineScale`'s fallback read while leaving this write in place would
 * have sent EVERY object-bound gantt — every one driven by a spec
 * `timeline.scale` — back to the `month` default. Silently: the tombstone
 * refuses documents at the authoring boundary, and this object never crosses
 * one, so nothing would have errored and no fixture would have changed.
 *
 * ## What is asserted, and why it is not the string
 *
 * The captured object is run through `resolveTimelineScale` — the real read
 * path, the actual function whose behaviour changed. Asserting `captured.scale
 * === 'year'` alone would still pass if the resolver stopped reading `scale`;
 * asserting the resolver's output makes the two halves agree or fail.
 *
 * `TimelineRenderer` is stubbed here ON PURPOSE, and the stub is the
 * measurement rather than a shortcut around it: what is under test is the value
 * of one key on the object crossing that boundary. (`timeline-date-binding.test.tsx`
 * documents the opposite case — for DATE BUCKETING a stub hides the defect,
 * because the evidence there lives in the markup the real renderer emits.)
 *
 * ## Why this file sits in `src/` and not in `src/__tests__/`
 *
 * It mocks `./renderer` with the SAME specifier `ObjectTimeline.tsx` itself
 * uses, from the same directory — the arrangement `ObjectTimeline.test.tsx`
 * already relies on. Written from `__tests__/` as `vi.mock('../renderer')` the
 * stand-in did not install: the real `TimelineRenderer` rendered and every
 * assertion failed on a missing stub marker. That is the inert-mock class
 * `scripts/check-vi-mock-specifiers.mjs` exists for, and the reason
 * `renderTimeline` below asserts the stub actually ran instead of trusting it.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { ObjectTimeline } from './ObjectTimeline';

/**
 * Every schema handed to `TimelineRenderer` during a test.
 *
 * `vi.hoisted` because `vi.mock` factories are hoisted above module-level
 * declarations: a plain `const` here is in its temporal dead zone when the
 * factory runs, and the stand-in never installs — the suite then exercises the
 * REAL renderer, which is the inert-mock failure `scripts/check-vi-mock-specifiers.mjs`
 * documents one level down (a mock that reports the same green a working one does).
 */
const { composed } = vi.hoisted(() => ({ composed: [] as Array<Record<string, unknown>> }));

// A PLAIN factory, no `importOriginal`. The `importOriginal` form left this
// stand-in inert here — the real `TimelineRenderer` rendered and no assertion
// could tell — so this follows the arrangement `ObjectTimeline.test.tsx` already
// proves works against this same module.
vi.mock('./renderer', () => ({
  TimelineRenderer: ({ schema }: { schema: Record<string, unknown> }) => {
    composed.push(schema);
    return <div data-testid="captured">{String((schema.items as unknown[])?.length ?? 0)}</div>;
  },
}));

/**
 * The REAL `resolveTimelineScale`, reached past the whole-module mock above.
 * Asserting through it rather than reading the key directly is the point: it is
 * the production read path, so a migration that renamed the key but left the
 * value unreachable cannot pass.
 */
let resolveTimelineScale: (schema: { scale?: unknown }) => string;

beforeAll(async () => {
  const actual = await vi.importActual<typeof import('./renderer')>('./renderer');
  resolveTimelineScale = actual.resolveTimelineScale;
  expect(typeof resolveTimelineScale, 'could not reach the real resolveTimelineScale').toBe('function');
});

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

const rows = [
  { id: '1', name: 'Spring Launch', start_date: '2099-09-01', end_date: '2099-09-30' },
  { id: '2', name: 'Summer Push', start_date: '2100-10-01', end_date: '2100-10-31' },
];

async function renderTimeline(schema: Record<string, unknown>) {
  const props = { schema, data: rows } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  render(<ObjectTimeline {...props} />);
  // Waiting on the STUB's own marker proves the stand-in actually installed. An
  // inert `vi.mock` reports the same green a working one does
  // (`scripts/check-vi-mock-specifiers.mjs`), so the capture is asserted, never assumed.
  await waitFor(() => expect(screen.getAllByTestId('captured').length).toBeGreaterThan(0));
  expect(composed.length, 'the TimelineRenderer stand-in never ran — the mock is inert').toBeGreaterThan(0);
  return composed[composed.length - 1];
}

/**
 * `variant: 'vertical'`, deliberately, even though the axis it carries is a
 * GANTT concern. The composition under test is variant-independent —
 * `ObjectTimeline` writes the resolved axis unconditionally — and rendering the
 * gantt variant here would exercise an unrelated pre-existing crash:
 * `calculateDateRange` reads gantt ROW shape (`row.items[].startDate`) while
 * `ObjectTimeline` composes feed items, so `Math.min()` over an empty list
 * yields `Infinity` and `new Date(Infinity).toISOString()` throws
 * `RangeError: Invalid time value`. That is filed separately; pinning it here
 * would couple this card's pin to a defect it does not own.
 */
const BASE = {
  type: 'timeline',
  variant: 'vertical',
  objectName: 'campaign',
  timeline: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
};

beforeEach(() => {
  composed.length = 0;
});

describe('ObjectTimeline composes the axis under `scale` (objectui#6355)', () => {
  it('emits the spec `timeline.scale` as `scale`, and the resolver reads it', async () => {
    const schema = await renderTimeline({ ...BASE, timeline: { ...BASE.timeline, scale: 'year' } });

    expect(schema.timeScale, 'ObjectTimeline still composes the RETIRED alias').toBeUndefined();
    expect(schema.scale).toBe('year');
    // The read path, not the key name: these must agree or the migration is half done.
    expect(resolveTimelineScale(schema)).toBe('year');
  });

  it('emits a flat `schema.scale` the same way', async () => {
    const schema = await renderTimeline({ ...BASE, scale: 'quarter' });

    expect(schema.timeScale).toBeUndefined();
    expect(resolveTimelineScale(schema)).toBe('quarter');
  });

  it('lets `timeline.scale` win over a flat `scale`, as the code intends', async () => {
    // Under the alias this was INVERTED and nothing noticed: ObjectTimeline
    // resolved `timelineConfig.scale ?? schema.scale` and wrote the winner to
    // `timeScale`, but the spread carried the flat `scale` through untouched and
    // `resolveTimelineScale`'s `scale ?? timeScale` ordering then preferred it.
    // Writing the resolved value under `scale` after the spread is what makes
    // the stated precedence real.
    const schema = await renderTimeline({
      ...BASE,
      scale: 'day',
      timeline: { ...BASE.timeline, scale: 'year' },
    });

    expect(resolveTimelineScale(schema)).toBe('year');
  });

  it('composes no axis at all when none is configured', async () => {
    // Counter-probe: the assertions above must be reading a value this component
    // actually put there, not one it always writes.
    const schema = await renderTimeline({ ...BASE });

    expect(schema.scale).toBeUndefined();
    expect(schema.timeScale).toBeUndefined();
    expect(resolveTimelineScale(schema)).toBe('month');
  });
});
