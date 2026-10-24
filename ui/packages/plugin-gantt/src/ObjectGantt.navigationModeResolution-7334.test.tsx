/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7334 — the RESOLUTION half of the repair: what `ObjectGantt` makes
 * of a `navigation` that reaches it on its view schema.
 *
 * The FORWARDING half lives one package over, in
 * `plugin-list/src/__tests__/ListView.ganttNavigationForward-7334.test.tsx`,
 * which pins that ListView's `case 'gantt'` branch puts the authored key on the
 * node at all. Neither file is sufficient alone and they fail for different
 * reasons, which is why they are two:
 *
 *   - delete the forwarding and the plugin-list file goes red here-and-now;
 *   - change `?? { mode: 'drawer' }` to ignore what it is handed, or narrow the
 *     mode classification, and THIS file goes red while that one stays green.
 *
 * ⭐ WHY THE ASSERTION IS ON A MODE VALUE AND NOT ON A VISIBLE DRAWER. This
 * defect's whole shape is "a drawer opens anyway": `navConfig` fell back to
 * `{ mode: 'drawer' }` for every gantt in the product, so a test asserting only
 * that something opened on click was green before the repair and green after
 * it, by construction. Worse, the four overlay modes are NOT separable from the
 * DOM here — `drawer`, `modal`, `split` and `popover` all render the one
 * `RecordDetailDrawer` at the tail of `ObjectGantt`, so no rendered assertion
 * can tell `modal` from `drawer` at all. The mode value is the only instrument
 * with the resolution this card needs.
 *
 * The instrument is a pass-through spy on `useNavigationOverlay`: it records
 * the options `ObjectGantt` hands in and then calls the real hook, so what is
 * captured is the component's own `navConfig` rather than a second copy of its
 * `??`. The hook's RETURNED `mode` / `isOverlay` are captured in the same
 * breath, because those are what the component dispatches on.
 *
 * REVERSE VERIFICATION — direction predicted before running: replace
 * `schema.navigation ?? { mode: 'drawer' }` with the bare literal
 * `{ mode: 'drawer' }` and the two AUTHORED cases go red (`page` and `modal`
 * both read `drawer`) while the FALLBACK case stays green — the exact
 * asymmetry that makes the fallback case a regression guard rather than a
 * restatement.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured = vi.hoisted(() => ({
  calls: [] as Array<{ navigation: any; mode: string; isOverlay: boolean }>,
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useNavigationOverlay: (options: any) => {
      const state = actual.useNavigationOverlay(options);
      captured.calls.push({
        navigation: options?.navigation,
        mode: state.mode,
        isOverlay: state.isOverlay,
      });
      return state;
    },
  };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view" data-task-count={String(tasks.length)} />
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import './index';

const ROWS = [
  { id: '1', subject: 'Ada onboarding', visible_from: '2099-09-01', due_date: '2099-09-03' },
  { id: '2', subject: 'Grace onboarding', visible_from: '2099-10-01', due_date: '2099-10-02' },
];

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'duly_task',
      fields: {
        id: { name: 'id', type: 'text' },
        subject: { name: 'subject', type: 'text' },
        visible_from: { name: 'visible_from', type: 'date' },
        due_date: { name: 'due_date', type: 'date' },
      },
    })),
  }) as any;

const BASE: Record<string, any> = {
  type: 'object-gantt',
  objectName: 'duly_task',
  gantt: {
    titleField: 'subject',
    startDateField: 'visible_from',
    endDateField: 'due_date',
  },
};

/**
 * Mount the real `ObjectGantt` through the registry on `schema` and return the
 * navigation config it resolved, alongside the mode the hook dispatched on.
 */
async function resolveNav(schema: Record<string, any>) {
  // Unmount whatever a previous call in this test mounted: `getByTestId` throws
  // on a second match, so an accumulating DOM would fail the loop case below
  // for a reason that has nothing to do with navigation modes.
  cleanup();
  captured.calls = [];
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
  await waitFor(() => expect(captured.calls.length).toBeGreaterThan(0));
  return captured.calls[captured.calls.length - 1];
}

beforeEach(() => {
  captured.calls = [];
});

describe('ObjectGantt resolves the AUTHORED navigation mode (objectui#7334)', () => {
  it('CONTROL: the spy sees a resolved mode at all', async () => {
    // The positive control comes first, for the same reason the sibling files
    // in this package put theirs first: every assertion below reads a captured
    // value, so a spy that never fires would make all of them vacuous rather
    // than red. `drawer` here is also the pre-repair status quo — the single
    // value this component was ever handed.
    const nav = await resolveNav({ ...BASE });
    expect(captured.calls.length).toBeGreaterThan(0);
    expect(nav.navigation).toBeTruthy();
    expect(typeof nav.mode).toBe('string');
  });

  it('authored `page` resolves to `page`, ⛔ not `drawer`', async () => {
    // ⭐ THE ACCEPTANCE ASSERTION. The authored value, read back off the
    // component's own `navConfig`. Before the ListView forwarding this node
    // never carried `navigation`, so `navConfig.mode` was `drawer` here no
    // matter what the author wrote.
    const nav = await resolveNav({ ...BASE, navigation: { mode: 'page' } });
    expect(nav.navigation?.mode).toBe('page');
    expect(nav.navigation?.mode).not.toBe('drawer');
    // And the classification that follows from it: `page` is not one of the
    // four overlay modes, so the component stops owning the click.
    expect(nav.mode).toBe('page');
    expect(nav.isOverlay).toBe(false);
  });

  it('authored `modal` resolves to `modal` — the repair is not special-cased to one value', async () => {
    // A SECOND non-default value, and deliberately a non-`drawer` OVERLAY one:
    // it lands on the same `isOverlay` side as the fallback, so a repair that
    // merely learned to recognise "page" would pass the case above and fail
    // this one. ⛔ Not assertable from the DOM — `modal` and `drawer` render
    // the identical `RecordDetailDrawer` in this component.
    const nav = await resolveNav({ ...BASE, navigation: { mode: 'modal' } });
    expect(nav.navigation?.mode).toBe('modal');
    expect(nav.mode).toBe('modal');
    expect(nav.isOverlay).toBe(true);
  });

  it('authored `split` resolves to `split` too', async () => {
    const nav = await resolveNav({ ...BASE, navigation: { mode: 'split' } });
    expect(nav.navigation?.mode).toBe('split');
    expect(nav.mode).toBe('split');
    expect(nav.isOverlay).toBe(true);
  });

  it('REGRESSION GUARD: no authored navigation still resolves to `drawer`', async () => {
    // The fallback has to SURVIVE the repair. `ObjectGantt`'s own default is
    // `drawer` and not the hook's `page` — every gantt in the product that
    // authored nothing keeps opening its record drawer.
    const nav = await resolveNav({ ...BASE });
    expect(nav.navigation?.mode).toBe('drawer');
    expect(nav.mode).toBe('drawer');
    expect(nav.isOverlay).toBe(true);
  });

  it('the four overlay modes classified at the read site are exactly the overlay half of the spec enum', async () => {
    // ZONE 3 of the dispatch asked for this to be REPORTED rather than assumed:
    // is the component's mode handling wider or narrower than the four it
    // classifies? Measured — the spec publishes SEVEN modes; the component
    // classifies the four overlay ones and leaves the other three to the hook.
    const overlay = ['drawer', 'modal', 'split', 'popover'];
    const nonOverlay = ['page', 'new_window', 'none'];
    for (const mode of overlay) {
      const nav = await resolveNav({ ...BASE, navigation: { mode } });
      expect(nav.navigation?.mode).toBe(mode);
      expect(nav.isOverlay).toBe(true);
    }
    for (const mode of nonOverlay) {
      const nav = await resolveNav({ ...BASE, navigation: { mode } });
      expect(nav.navigation?.mode).toBe(mode);
      expect(nav.isOverlay).toBe(false);
    }
  });
});
