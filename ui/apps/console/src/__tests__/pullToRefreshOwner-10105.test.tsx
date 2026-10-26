/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10105 — one pull, one indicator, one refetch, on the real views.
 *
 * `usePullToRefresh` (`@object-ui/mobile`) is used by `ListView` and by the
 * views `ListView` renders inside itself. A touch on the inner view's host
 * bubbles to `ListView`'s host, so both hooks receive the same gesture. The
 * hook now gives that gesture to the OUTERMOST armed host: `ListView` shows
 * the one indicator and runs the one refetch, which reloads the rows it hands
 * the inner view. The hook's own pin covers the rule on a minimal consumer.
 * This file pins it on the real compositions.
 *
 * Without this rule, one pull drew two indicators. The per-view counts from
 * before and after are a historical reading recorded on objectui#10105; this
 * file does not re-derive them. It asserts only the rule.
 *
 * ## Both halves, so a rule that disarms everything cannot pass
 *
 * - NESTED: `ListView` over calendar, grid and timeline. Before pulling, the
 *   case requires TWO armed hosts, one inside the other. Without that, "one
 *   indicator" would also be what a dead inner listener produces.
 * - STANDALONE: grid and timeline fetching their own rows, with no pull host
 *   above them. Each must still arm and refetch. The standalone calendar is
 *   pinned in `plugin-calendar` (`ObjectCalendar.pullToRefresh-10105.test.tsx`).
 *
 * ## Why this file lives in `apps/console`
 *
 * It renders `ListView` together with the calendar, grid and timeline plugins,
 * so it must live in a package that declares all four (the objectui#4409
 * dependency-direction method). `plugin-list` declares none of the other three,
 * and `app-shell` declares every one except `plugin-timeline`. This app declares
 * all four, and `timelineAxisRefusalReach-7070.test.tsx` beside this file already
 * renders `ListView` over the real timeline for the same reason.
 *
 * ## How it reads the DOM
 *
 * - Armed hosts are found by the attribute the hook sets while it is bound
 *   (`data-pull-to-refresh-host`). That attribute is how one hook instance
 *   sees another, so reading it here tests the same fact the rule relies on.
 * - An indicator is a `div` whose inline height is the pull distance, 100px
 *   here. Every consumer draws its indicator that way, and each case checks
 *   that nothing on screen is 100px tall before the pull.
 * - The gesture is the hook's own `touchstart` → `touchmove` → `touchend`,
 *   with `touches` attached by hand because happy-dom builds no `TouchList`.
 *   Effects are flushed first because the hook binds in a passive effect.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import '@object-ui/plugin-calendar';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { ObjectTimeline } from '@object-ui/plugin-timeline';
import { ListView } from '@object-ui/plugin-list';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

afterEach(() => {
  cleanup();
});

const ARMED_HOST = '[data-pull-to-refresh-host]';

const today = new Date();
const START = new Date(today.getFullYear(), today.getMonth(), 10, 9, 0, 0, 0).toISOString();
const ROWS = [{ id: 'r-0', name: 'Task 0', subject: 'Task 0', start_date: START }];

const makeDataSource = () => ({
  find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({
    name: 'duly_task',
    fields: {
      id: { name: 'id', type: 'text' },
      name: { name: 'name', type: 'text' },
      subject: { name: 'subject', type: 'text' },
      start_date: { name: 'start_date', type: 'datetime' },
    },
  })),
});

const touch = (type: string, clientY: number) => {
  const event = new Event(type, { bubbles: true });
  (event as unknown as { touches: Array<{ clientY: number }> }).touches = [{ clientY }];
  return event;
};

const indicators = () =>
  [...document.querySelectorAll<HTMLElement>('div')].filter((d) => d.style.height === '100px');

/**
 * Pull 100px on `el`, wait for the indicators to settle, hand them to
 * `inspect` WHILE they are still on screen, then release. The release clears
 * the indicator synchronously (`fireEvent` runs inside `act`), so anything
 * that reads where an indicator sits has to run before it.
 */
async function pull(el: HTMLElement, inspect: (shown: HTMLElement[]) => void): Promise<void> {
  await act(async () => {});
  expect(indicators(), 'control: nothing on screen is 100px tall before the pull').toHaveLength(0);
  fireEvent(el, touch('touchstart', 10));
  fireEvent(el, touch('touchmove', 110));
  await waitFor(() => expect(indicators().length).toBeGreaterThan(0));
  await act(async () => {});
  inspect(indicators());
  fireEvent(el, touch('touchend', 110));
}

/** The release refetches exactly once, and nothing fetches again after it. */
async function expectOneRefetch(find: { mock: { calls: unknown[] } }, before: number) {
  await waitFor(() => expect(find.mock.calls.length).toBe(before + 1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(find.mock.calls.length, 'one pull must refetch exactly once').toBe(before + 1);
}

async function renderInListView(schema: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const { container } = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: 'duly_task', ...schema } as never}
        dataSource={dataSource as never}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.getAllByText('Task 0').length).toBeGreaterThan(0));
  await act(async () => {});
  return { container, dataSource };
}

async function expectListViewOwnsThePull(schema: Record<string, unknown>) {
  const { container, dataSource } = await renderInListView(schema);
  const hosts = [...container.querySelectorAll<HTMLElement>(ARMED_HOST)];
  // ListView's host and the inner view's host, both armed, one inside the
  // other. querySelectorAll returns document order, so the outer comes first.
  expect(hosts, 'expected ListView and its inner view both armed').toHaveLength(2);
  const [outer, inner] = hosts;
  expect(outer.contains(inner)).toBe(true);

  const before = dataSource.find.mock.calls.length;
  await pull(inner, (shown) => {
    expect(shown, 'one pull on a nested view must draw exactly one indicator').toHaveLength(1);
    expect(outer.contains(shown[0]), 'the indicator must be inside ListView\'s host').toBe(true);
    expect(inner.contains(shown[0]), 'the indicator must be the OUTER host\'s').toBe(false);
  });
  await expectOneRefetch(dataSource.find, before);
}

describe('objectui#10105 — a pull inside ListView belongs to ListView: one indicator, one refetch', () => {
  it('ListView over ObjectCalendar', async () => {
    await expectListViewOwnsThePull({
      viewType: 'calendar',
      columns: ['name'],
      calendar: { startDateField: 'start_date', titleField: 'name' },
    });
  });

  it('ListView over ObjectGrid', async () => {
    await expectListViewOwnsThePull({ viewType: 'grid', columns: ['subject'] });
  });

  it('ListView over ObjectTimeline', async () => {
    await expectListViewOwnsThePull({
      viewType: 'timeline',
      columns: ['subject'],
      timeline: { startDateField: 'start_date', titleField: 'subject' },
    });
  });
});

describe('objectui#10105 — a view with no pull host above it still owns its own pull', () => {
  async function expectStandaloneArmsAndRefetches(
    container: HTMLElement,
    find: { mock: { calls: unknown[] } },
  ) {
    await waitFor(() => expect(screen.getAllByText('Task 0').length).toBeGreaterThan(0));
    await act(async () => {});
    const hosts = [...container.querySelectorAll<HTMLElement>(ARMED_HOST)];
    expect(hosts, 'expected exactly one armed host').toHaveLength(1);
    const before = find.mock.calls.length;
    await pull(hosts[0], (shown) => {
      expect(shown).toHaveLength(1);
      expect(hosts[0].contains(shown[0])).toBe(true);
    });
    await expectOneRefetch(find, before);
  }

  it('ObjectGrid fetching its own rows', async () => {
    const dataSource = makeDataSource();
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: 'duly_task', columns: ['subject'] } as never}
          dataSource={dataSource as never}
        />
      </ActionProvider>,
    );
    await expectStandaloneArmsAndRefetches(container, dataSource.find);
  });

  it('ObjectTimeline fetching its own rows', async () => {
    const dataSource = makeDataSource();
    const { container } = render(
      <ObjectTimeline
        schema={
          {
            type: 'timeline',
            objectName: 'duly_task',
            titleField: 'subject',
            startDateField: 'start_date',
          } as never
        }
        dataSource={dataSource as never}
      />,
    );
    await expectStandaloneArmsAndRefetches(container, dataSource.find);
  });
});
