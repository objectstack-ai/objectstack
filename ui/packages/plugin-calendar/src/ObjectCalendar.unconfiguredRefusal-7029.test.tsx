/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7029 — the refusal screen this component has always carried becomes
 * REACHABLE from the object-page route.
 *
 * Ruled on objectstack#13748 (director batch #19, option A). Nothing in this
 * file's component changed: `getCalendarConfig` already returned null for a
 * schema with no date binding, and the early return already rendered the
 * "Calendar configuration required" screen. What changed is upstream —
 * `ObjectView` and `ListView` stopped fabricating `due_date` / `start_date`
 * bindings — so the props this component actually receives for an unconfigured
 * view now carry no binding at all.
 *
 * These cases are therefore written as the SEAM: the two prop shapes the fixed
 * upstream emits, asserted against the two screens they must produce. They are
 * the layer that proves the deletion upstream reaches a user-visible outcome
 * rather than merely changing an object literal.
 *
 * ⛔ The refusal screen itself is deliberately NOT redesigned by this card —
 * these cases read its existing copy verbatim.
 *
 * ⚠️ objectui#8170 DID later reword that copy, and these cases still hold
 * because they match the clause it deliberately left alone: the `REFUSAL`
 * matcher below is the first clause only. The second clause — which key to
 * specify, and where it lives on each door — is pinned in this directory's
 * `ObjectCalendar.refusalRemedy-8170.test.tsx`, not here.
 *
 * Both directions are pinned, because a fix that refused EVERY view would pass
 * a refusal-only test: the CONTROL case asserts a correctly configured calendar
 * still renders its events, on its own declared field, unchanged.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ObjectCalendar } from './ObjectCalendar';

afterEach(cleanup);

const REFUSAL = /Calendar configuration required/i;

const today = new Date();
const dayInThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0);

const ROWS = [
  { id: 'r1', name: 'Ada out', start_date: dayInThisMonth(10).toISOString() },
  { id: 'r2', name: 'Grace out', start_date: dayInThisMonth(12).toISOString() },
];

const objectDef = {
  name: 'crm_leave_request',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
  },
};

const makeDataSource = () =>
  ({
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue(objectDef),
  }) as any;

describe('ObjectCalendar — an unconfigured view reaches the refusal screen (objectui#7029)', () => {
  it('refuses the props a view with NO calendar block now produces', async () => {
    // Exactly what the fixed `ListView` calendar branch emits for a view that
    // declared nothing: the flat binding props are simply absent. Before this
    // card the same view arrived carrying `startDateField: 'due_date'`, so this
    // early return was unreachable and every record landed on today's cell
    // under a display-name-resolved title — a plausible, fully wrong screen.
    render(
      <ObjectCalendar
        schema={{ type: 'object-calendar', objectName: 'crm_leave_request' } as any}
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
    // …and it is a refusal, not a calendar that merely looks empty.
    expect(screen.queryByText('Ada out')).toBeNull();
    expect(screen.queryByText('Grace out')).toBeNull();
  });

  it('refuses a HALF-declared block — a title with no date axis is not a calendar', async () => {
    // The half-written declaration objectstack#13817 closes in the spec. The
    // runtime is honest about it independently of which spec version the host
    // pins — which is the whole reason this half was ruled worth fixing too.
    render(
      <ObjectCalendar
        schema={{ type: 'object-calendar', objectName: 'crm_leave_request', titleField: 'name' } as any}
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
  });

  it('CONTROL: a correctly configured calendar is completely unaffected', async () => {
    // The declared binding renders its events exactly as before — same fields,
    // same records, no refusal. Without this case a fix that refused
    // EVERYTHING would look identical to the fix that was ruled.
    render(
      <ObjectCalendar
        schema={
          {
            type: 'object-calendar',
            objectName: 'crm_leave_request',
            startDateField: 'start_date',
            titleField: 'name',
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    expect(screen.getByText('Grace out')).toBeTruthy();
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('CONTROL: the nested spec `calendar` block still configures the renderer', async () => {
    render(
      <ObjectCalendar
        schema={
          {
            type: 'object-calendar',
            objectName: 'crm_leave_request',
            calendar: { startDateField: 'start_date', titleField: 'name' },
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});
