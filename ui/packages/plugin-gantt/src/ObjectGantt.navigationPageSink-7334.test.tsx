/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7334, second leg — an authored non-overlay `navigation` mode on a
 * gantt has to actually GO somewhere.
 *
 * The first leg forwarded the authored `navigation` down the gantt view-schema
 * path (`ListView.ganttNavigationForward-7334`) and the component's resolution
 * of it is pinned next door (`ObjectGantt.navigationModeResolution-7334`).
 * Those two together made `mode: 'page'` REACHABLE for the first time — and
 * reaching it exposed that this component had no sink for it:
 *
 *   - `useNavigationOverlay`'s `page` branch calls `onNavigate` and then
 *     RETURNS WITH NO FALLBACK when there is none;
 *   - `ObjectGantt` supplied no `onNavigate`;
 *   - and `ObjectGanttRenderer` hands it no host `onRowClick` either
 *     (objectui#7210 / objectui#7222 — this card's own premise).
 *
 * Both carriers empty at once, so an authored `page` went from "a drawer opens,
 * which is the wrong thing" to "the click does nothing at all". A silent dead
 * click is worse than a loud wrong one, which is why the sink lands on this
 * card rather than on the follow-up that first recorded it.
 *
 * ⭐ WHY THE ASSERTIONS NAME A URL. "Something happened" is exactly the shape
 * of assertion this whole card exists to reject. Each case below reads the
 * ARGUMENTS of the navigation call — the concrete record-page href, app prefix
 * and all — so a sink that fired at the wrong destination fails as loudly as no
 * sink at all. The prefix is real: the harness parks the document on
 * `/console/duly_task/views/all` first, and `deriveRecordPageHref` is NOT
 * mocked, so `/console` in the expected string can only come from a genuine
 * derivation.
 *
 * REVERSE VERIFICATION — direction predicted before running: delete
 * `onNavigate: navigateToRecord` from the `useNavigationOverlay` call and the
 * `page` case plus the "hands the hook a sink" case go red, while every OVERLAY
 * case stays green (the four overlay modes never consult `onNavigate`) and the
 * `none` case stays green (it returns before the sink is reached). The
 * `new_window` case also goes red on its ARGUMENTS rather than on the call: the
 * hook's own `window.open` fallback still fires, but it builds the UNPREFIXED
 * `/duly_task/record/1` because it has no app prefix to work from.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captured = vi.hoisted(() => ({ options: [] as any[] }));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    // Pass-through: the real hook still runs, so every click below travels the
    // real routing code. The spy only records what the component handed in.
    useNavigationOverlay: (options: any) => {
      captured.options.push(options);
      return actual.useNavigationOverlay(options);
    },
  };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onTaskClick }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <button key={t.id} data-testid={`task-${t.id}`} onClick={() => onTaskClick?.(t)}>
          {t.title}
        </button>
      ))}
    </div>
  ),
}));

// `deriveRecordPageHref` is deliberately NOT mocked — it is the thing under
// test on the argument side. Only the drawer is stubbed, so the overlay
// control cases have something observable to assert.
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  // objectui#9299: the overlay payload is `RecordDetailPanel` now.
  RecordDetailPanel: () => <div data-testid="record-drawer" />,
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
    findOne: vi.fn(async () => ROWS[0]),
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

/** The href a real derivation must produce from the parked location below. */
const EXPECTED_HREF = '/console/duly_task/record/1';

let pushSpy: ReturnType<typeof vi.spyOn>;
let openSpy: ReturnType<typeof vi.spyOn>;
let popstates: number;
const countPopstate = () => { popstates += 1; };

beforeEach(() => {
  captured.options = [];
  popstates = 0;
  // Park the document somewhere with a real app prefix BEFORE the spy is
  // installed, so the setup navigation is not counted as a click.
  window.history.replaceState({}, '', '/console/duly_task/views/all');
  pushSpy = vi.spyOn(window.history, 'pushState');
  openSpy = vi.spyOn(window, 'open').mockReturnValue(null as any);
  window.addEventListener('popstate', countPopstate);
});

afterEach(() => {
  window.removeEventListener('popstate', countPopstate);
  vi.restoreAllMocks();
  cleanup();
});

/** Mount the real component through the registry and click the first task. */
async function clickFirstTask(schema: Record<string, any>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('task-1')).toBeTruthy());
  fireEvent.click(screen.getByTestId('task-1'));
}

describe('an authored non-overlay navigation mode on a gantt reaches a real destination (objectui#7334)', () => {
  it('hands the hook a real `onNavigate` sink', async () => {
    // The structural half, and the reason the behavioural cases below can pass
    // at all. Before this leg the component passed no `onNavigate`, so the
    // hook's `page` branch had nothing to call.
    await clickFirstTask({ ...BASE, navigation: { mode: 'page' } });
    const opts = captured.options[captured.options.length - 1];
    expect(typeof opts.onNavigate).toBe('function');
  });

  it('⭐ authored `page`: a task click NAVIGATES to the record page, and the URL is the derived one', async () => {
    // ⭐ THE ACCEPTANCE CASE for this leg. The arguments are the assertion —
    // `/console` can only be here because `deriveRecordPageHref` really ran
    // against the parked location, and `/record/1` because the clicked ROW was
    // resolved rather than an id being pasted into a template.
    await clickFirstTask({ ...BASE, navigation: { mode: 'page' } });

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    expect(pushSpy).toHaveBeenCalledWith({}, '', EXPECTED_HREF);
    // The SPA half: a pushState nobody is told about leaves the router on the
    // old screen, so the event is part of "navigates", not decoration.
    expect(popstates).toBe(1);
    expect(window.location.pathname).toBe(EXPECTED_HREF);
    // ⛔ And no overlay: `page` is not an overlay mode.
    expect(screen.queryByTestId('record-drawer')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('authored `new_window`: opens the PREFIXED record page in a new tab', async () => {
    // The hook has its own `window.open` fallback for this mode, so the call
    // itself is not what this pins — the ARGUMENT is. The fallback builds
    // `/duly_task/record/1` from the bare object name and has no app prefix to
    // work from; routing through the component's sink gives the same href the
    // drawer's own full-page link uses.
    await clickFirstTask({ ...BASE, navigation: { mode: 'new_window' } });

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(EXPECTED_HREF, '_blank');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('record-drawer')).toBeNull();
  });

  it('CONTROL: authored `drawer` still opens the overlay and navigates nowhere', async () => {
    // The overlay half must be untouched by the sink. This is also the case
    // that separates "the sink fires for non-overlay modes" from "the sink
    // fires for every click".
    await clickFirstTask({ ...BASE, navigation: { mode: 'drawer' } });

    await waitFor(() => expect(screen.getByTestId('record-drawer')).toBeTruthy());
    expect(pushSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: authored `modal` — another overlay mode, same answer', async () => {
    await clickFirstTask({ ...BASE, navigation: { mode: 'modal' } });

    await waitFor(() => expect(screen.getByTestId('record-drawer')).toBeTruthy());
    expect(pushSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('REGRESSION GUARD: a gantt authoring NO navigation still opens its drawer', async () => {
    // The `?? { mode: 'drawer' }` fallback is what every gantt in the product
    // runs on today, and adding a sink must not move it.
    await clickFirstTask({ ...BASE });

    await waitFor(() => expect(screen.getByTestId('record-drawer')).toBeTruthy());
    expect(pushSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('authored `none` stays inert — the sink does not resurrect a suppressed click', async () => {
    // `none` returns inside the hook BEFORE `onNavigate` is reachable. Pinned
    // because "give the component a navigation sink" is exactly the change that
    // could turn an author's explicit "do nothing" into something.
    await clickFirstTask({ ...BASE, navigation: { mode: 'none' } });

    // Settle one turn so a late effect would have been seen.
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(pushSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('record-drawer')).toBeNull();
    expect(window.location.pathname).toBe('/console/duly_task/views/all');
  });
});
