/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10105 — the pull-to-refresh gesture arms on BOTH of
 * `ObjectCalendar`'s data paths.
 *
 * ## The asymmetry this pins
 *
 * `usePullToRefresh` (`@object-ui/mobile`) hands back an OBJECT ref, so
 * nothing tells the hook when a consumer attaches it. It used to bind its
 * native touch listeners in an effect keyed only on its own handlers and
 * `enabled`, which reads `ref.current` once and then waits for one of those
 * to change. On the internal-fetch path the component's first commit is the
 * loading screen, so that one read found `null`; when the rows arrived the
 * host `div` mounted, but none of the effect's dependencies had changed, so it
 * never ran again and the gesture was dead. With pre-fetched `data` the first
 * commit already contains the host, so the same gesture worked. That is why
 * this file has two arms and not one.
 *
 * ## Why two arms and not one
 *
 * - The INTERNAL-FETCH arm is the one that went red on the defect.
 * - The PRE-FETCHED arm is the lit control. It was green before the repair and
 *   must stay green after it, so a repair that disarms the gesture everywhere
 *   cannot pass as a fix.
 *
 * ## The gesture is the hook's own event sequence, not a scripted scroll
 *
 * `touchstart` → `touchmove` → `touchend` on the host, which is where the
 * hook binds. A scripted `scrollTop` or a direct call to the refresh callback
 * would skip the listeners, and the listeners are the part that was missing.
 * happy-dom does not build a `TouchList` from a plain init object, so the
 * events are built by hand with `touches` attached. The start point is y=10
 * and not y=0 because the move handler ignores a falsy start point.
 *
 * ## What "refreshed" means on the internal-fetch arm
 *
 * A release past the threshold calls `onRefresh`, and on this path that
 * bumps the key the fetch effect depends on. So the check is a second
 * `find` call. That refetch puts the component back on its loading screen,
 * and the loading screen carries no ref, so the ref goes back to `null` until
 * the rows return. The second `find` is held open here so the test can see
 * the loading screen. A second gesture after the rows return then checks that
 * the gesture arms again after that round trip. (React may reuse the same
 * root `div` for both screens, since they share a type and a position, so the
 * pin does not assert on element identity. The hook's own pin covers a truly
 * replaced element.)
 *
 * ## Effects are flushed before each gesture
 *
 * The hook binds in a passive effect. A `waitFor` can resolve on the DOM
 * mutation of a commit before that commit's effects have run. So each gesture
 * starts with `await act(async () => {})`. That makes the timing
 * deterministic, and it cannot rescue the defect: the old binding effect did
 * not re-run however often effects were flushed.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { ObjectCalendar } from './ObjectCalendar';

afterEach(() => {
  cleanup();
});

const today = new Date();
const dayInThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0);

const ROWS = [{ id: 'r1', name: 'Ada out', start_date: dayInThisMonth(10).toISOString() }];

const objectDef = {
  name: 'crm_leave_request',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    start_date: { type: 'date' },
  },
};

// Both doubles implement only the two members this component calls, so they
// are handed over `as never` at the call site rather than typed as a full
// `DataSource`.
const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: ROWS }),
  getObjectSchema: vi.fn().mockResolvedValue(objectDef),
});

/** `find` answers at once, except the SECOND call, which waits for `releaseSecond`. */
function makeHeldSecondFetchDataSource() {
  let releaseSecond: () => void = () => {
    throw new Error('the second find call has not been made yet');
  };
  const find = vi
    .fn()
    .mockResolvedValueOnce({ data: ROWS })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSecond = () => resolve({ data: ROWS });
        }),
    )
    .mockResolvedValue({ data: ROWS });
  const dataSource = { find, getObjectSchema: vi.fn().mockResolvedValue(objectDef) };
  return { dataSource, releaseSecond: () => releaseSecond() };
}

const CONFIGURED = {
  type: 'object-calendar',
  objectName: 'crm_leave_request',
  calendar: { startDateField: 'start_date' },
} as const;

/**
 * A class on the component's `className` prop marks the host. The loading
 * screen uses the same `className`, so the lookup also requires that the
 * element holds the calendar's region. Only the rendered calendar matches.
 */
const HOST_CLASS = 'pull-host-10105';

function calendarHost(container: HTMLElement): HTMLElement {
  const host = container.querySelector(`.${HOST_CLASS}`) as HTMLElement | null;
  expect(host, 'no element carries the host class').not.toBeNull();
  expect(
    host!.contains(screen.getByRole('region')),
    'the host-class element is not the calendar host (loading screen?)',
  ).toBe(true);
  return host!;
}

const touch = (type: string, clientY: number) => {
  const event = new Event(type, { bubbles: true });
  (event as unknown as { touches: Array<{ clientY: number }> }).touches = [{ clientY }];
  return event;
};

/** Pull 100px (past the hook's default 80px threshold) and wait for the indicator. */
async function pullPastThreshold(host: HTMLElement) {
  await act(async () => {});
  fireEvent(host, touch('touchstart', 10));
  fireEvent(host, touch('touchmove', 110));
  await waitFor(() => expect(screen.getByText('Pull to refresh')).toBeTruthy());
}

function release(host: HTMLElement) {
  fireEvent(host, touch('touchend', 110));
}

describe('objectui#10105 — ObjectCalendar pull-to-refresh arms on both data paths', () => {
  it('internal-fetch path: the gesture arms, refreshes, and arms again after the loading screen', async () => {
    const { dataSource, releaseSecond } = makeHeldSecondFetchDataSource();
    const { container } = render(
      <ObjectCalendar schema={CONFIGURED as never} dataSource={dataSource as never} className={HOST_CLASS} />,
    );
    // The first commit on this path is the loading screen. This is the step
    // the defect depended on.
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    expect(dataSource.find).toHaveBeenCalledTimes(1);

    const firstHost = calendarHost(container);
    await pullPastThreshold(firstHost);
    release(firstHost);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledTimes(2));

    // The refetch is held open, so the loading screen is on screen and the
    // calendar region is gone. At this point the ref is `null`.
    await waitFor(() => expect(screen.getByText('Loading calendar…')).toBeTruthy());
    expect(screen.queryByRole('region')).toBeNull();
    releaseSecond();
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());

    const secondHost = calendarHost(container);
    await pullPastThreshold(secondHost);
    release(secondHost);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledTimes(3));
  });

  it('pre-fetched path (the lit control): the gesture arms', async () => {
    const { container } = render(
      <ObjectCalendar
        schema={CONFIGURED as never}
        dataSource={makeDataSource() as never}
        data={ROWS}
        className={HOST_CLASS}
      />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    const host = calendarHost(container);
    await pullPastThreshold(host);
    // Releasing clears the indicator. This checks that `touchend` reached the
    // hook too, not only `touchstart` and `touchmove`.
    release(host);
    await waitFor(() => expect(screen.queryByText('Pull to refresh')).toBeNull());
  });
});
