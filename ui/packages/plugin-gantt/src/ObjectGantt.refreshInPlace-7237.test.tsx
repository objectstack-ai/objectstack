/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7237, ruling A′ — once the chart has painted, a REAL change to the
 * query (sort, filter, permissions) refreshes the rows IN PLACE: the chart
 * stays mounted with its scroll, collapsed groups and in-flight edits, a
 * visible refreshing state sits on the chart while the query runs, and the rows
 * are replaced when it returns. It never tears down to the loading
 * placeholder. The initial load keeps the placeholder.
 *
 * `GanttView` is a stand-in that takes an instance id from a `useState`
 * initializer, which runs once per mount. A changed id means `GanttView` was
 * unmounted, and the only thing on this path that unmounts it is the loading
 * placeholder a non-silent reload swaps in. Every `find` is held open by hand,
 * so each assertion about the in-flight state is made while the query really
 * is in flight.
 *
 * ⛔ This file does not pin "2 → 1 filter identities at the gantt node". That
 * reading cannot fail on today's main (ListView's filter hold already gives 1),
 * so it is no evidence for the behaviour this ruling asks for.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nProvider } from '@object-ui/i18n';
import { PermissionProvider } from '@object-ui/permissions';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from './ObjectGantt';
import { GANTT_DEFAULT_TRANSLATIONS } from './useGanttTranslation';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let instanceSeq = 0;

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => {
    const [id] = React.useState(() => ++instanceSeq);
    return (
      <div data-testid="gantt-view" data-instance={id}>
        {tasks.map((t: any) => (
          <div key={t.id} data-testid="gantt-task">{t.title}</div>
        ))}
      </div>
    );
  },
}));

const PLACEHOLDER = 'Loading Gantt chart...';

const FIRST_ROWS = [
  { id: '1', name: 'From the first query', start_date: '2024-01-01', end_date: '2024-01-05' },
];
const NEXT_ROWS = [
  { id: '2', name: 'From the changed query', start_date: '2024-02-01', end_date: '2024-02-05' },
];

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
  },
};

function schemaWith(extra: Record<string, unknown> = {}): any {
  return {
    type: 'object-gantt',
    gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
    data: { provider: 'object', object: 'tasks' },
    ...extra,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Every `find` returns a promise the test settles by hand. */
function makeDeferredDataSource() {
  const finds: Deferred<any>[] = [];
  const dataSource = {
    find: vi.fn(() => {
      const d = deferred<any>();
      finds.push(d);
      return d.promise;
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as unknown as DataSource;
  return { dataSource, finds, find: dataSource.find as unknown as ReturnType<typeof vi.fn> };
}

async function answer(d: Deferred<any>, rows: unknown[]) {
  await act(async () => {
    d.resolve({ data: rows });
    await Promise.resolve();
  });
}

const view = () => screen.getByTestId('gantt-view');
const indicator = () => screen.queryByTestId('refresh-indicator');

/**
 * The three real changes the ruling names. Each builds the element for the
 * first render and for the changed one. The permissions case goes through a
 * real `PermissionProvider`: a different role set publishes a new context
 * value, which is how a permission change reaches the gantt's query.
 */
const CHANGES: Array<[string, (ds: DataSource) => [React.ReactElement, React.ReactElement]]> = [
  [
    'sort',
    (ds) => [
      <ObjectGantt schema={schemaWith({ sort: [{ field: 'start_date', order: 'asc' }] })} dataSource={ds} />,
      <ObjectGantt schema={schemaWith({ sort: [{ field: 'start_date', order: 'desc' }] })} dataSource={ds} />,
    ],
  ],
  [
    'filter',
    (ds) => [
      <ObjectGantt schema={schemaWith({ filter: ['status', '=', 'open'] })} dataSource={ds} />,
      <ObjectGantt schema={schemaWith({ filter: ['status', '=', 'closed'] })} dataSource={ds} />,
    ],
  ],
  [
    'permissions',
    (ds) => {
      const schema = schemaWith();
      const withRoles = (userRoles: string[]) => (
        <PermissionProvider roles={[]} permissions={[]} userRoles={userRoles}>
          <ObjectGantt schema={schema} dataSource={ds} />
        </PermissionProvider>
      );
      return [withRoles(['planner']), withRoles(['viewer'])];
    },
  ],
];

beforeEach(() => {
  instanceSeq = 0;
  // The I18nProvider persists the last language; keep the zh case from leaking.
  window.localStorage.clear();
});

describe('ObjectGantt refreshes in place on a real query change (objectui#7237, ruling A′)', () => {
  it.each(CHANGES)('a real %s change keeps the chart mounted, shows the refreshing state, then replaces the rows', async (_name, build) => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const [first, changed] = build(dataSource);

    const { rerender } = render(first);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());
    const mountedAs = view().dataset.instance;
    expect(indicator(), 'no refreshing state while nothing is in flight').toBeNull();

    rerender(changed);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));

    // The changed query is in flight. Soft assertions, so each of the three
    // readings reports on its own rather than the first one hiding the rest.
    expect.soft(
      screen.queryByTestId('gantt-view')?.dataset.instance ?? 'unmounted',
      '(a) GanttView was unmounted by the re-query, which loses its scroll, collapsed groups and in-flight edits',
    ).toBe(mountedAs);
    expect.soft(
      indicator() ? 'present' : 'absent',
      '(b) no visible refreshing state on the chart while the changed query is in flight',
    ).toBe('present');
    expect.soft(indicator()?.getAttribute('aria-label'), 'the refreshing state has no localized name').toBe('Refreshing…');
    expect.soft(
      screen.queryByText(PLACEHOLDER)?.textContent ?? 'no placeholder',
      'the re-query tore the chart down to the loading placeholder',
    ).toBe('no placeholder');
    // The rows on screen until then are the previous answer, marked as refreshing.
    expect.soft(screen.queryByText('From the first query')?.textContent ?? 'absent').toBe('From the first query');

    await answer(finds[1], NEXT_ROWS);

    await waitFor(() =>
      expect(
        screen.queryByText('From the changed query'),
        '(c) the answer to the changed query never replaced the rows',
      ).not.toBeNull(),
    );
    expect(screen.queryByText('From the first query')).toBeNull();
    expect(indicator(), 'the refreshing state outlived the query').toBeNull();
    expect(view().dataset.instance, '(a) after the answer: not the GanttView that painted the first rows').toBe(mountedAs);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('the re-query really carries the changed query', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const [first, changed] = CHANGES[0][1](dataSource);

    const { rerender } = render(first);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    rerender(changed);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));

    expect(find.mock.calls[0][1].$orderby).toEqual({ start_date: 'asc' });
    expect(find.mock.calls[1][1].$orderby).toEqual({ start_date: 'desc' });
  });

  it('(d) control: the initial load still shows the placeholder, and no refreshing state', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();

    render(<ObjectGantt schema={schemaWith()} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByTestId('gantt-view')).toBeNull();
    expect(indicator()).toBeNull();

    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it('a failed re-query reports the error instead of leaving the previous query\'s rows on screen', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const [first, changed] = CHANGES[0][1](dataSource);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(first);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());

    rerender(changed);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await act(async () => {
      finds[1].reject(new Error('sort field not readable'));
      await Promise.resolve();
    });

    // A background refresh of the SAME query may keep its last good rows; an
    // answer to a DIFFERENT query may not. Those rows do not match the sort the
    // user just chose, and with the refreshing state gone nothing would say so.
    await waitFor(() => expect(screen.getByText('Error: sort field not readable')).toBeTruthy());
    expect(screen.queryByText('From the first query')).toBeNull();
    consoleError.mockRestore();
  });

  it('labels the refreshing state from the locale pack (zh)', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const withLang = (el: React.ReactElement) => (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>{el}</I18nProvider>
    );
    const [first, changed] = CHANGES[0][1](dataSource);

    const { rerender } = render(withLang(first));
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());

    rerender(withLang(changed));
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));

    // `useGanttTranslation` falls back per key to the bundled English, so an
    // English reading here could not tell a pack entry from a missing one.
    await waitFor(() => expect(indicator()?.getAttribute('aria-label')).toBe('刷新中…'));
    expect(indicator()!.getAttribute('aria-label')).not.toBe(GANTT_DEFAULT_TRANSLATIONS['gantt.aria.refreshing']);
    expect(GANTT_DEFAULT_TRANSLATIONS['gantt.aria.refreshing']).toBe('Refreshing…');
  });
});
