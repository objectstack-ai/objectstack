/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7070 — the refusal screen this component has always carried becomes
 * REACHABLE from the object-page route.
 *
 * The sibling of objectui#7029's `ObjectCalendar.unconfiguredRefusal-7029`, and
 * written for the same reason: #7029's mechanic (delete the fabricated literal
 * upstream, let the renderer's own refusal answer) is only correct where a
 * refusal path EXISTS. #7070 was filed precisely because that premise had never
 * been measured for the gantt renderer — "deleting these literals blind, on the
 * strength of #7062's success, is the specific mistake this card is written to
 * prevent". This file is that measurement, kept as the regression.
 *
 * MEASURED (before any upstream edit, on `2c3cd1b75`): `getGanttConfig` returns
 * `null` for a schema carrying neither a `gantt` block nor BOTH flat date props,
 * and the early return at `ObjectGantt.tsx` renders "Gantt configuration
 * required. Please specify startDateField, endDateField, and titleField." So the
 * answer is REFUSE — not render-empty, not throw. Nothing in this component
 * changed for #7070; what changed is upstream (`app-shell/ObjectView`,
 * `plugin-list/ListView`, `plugin-view/ObjectView` stopped fabricating
 * `'start_date'` / `'end_date'`), so the props an unconfigured view now delivers
 * carry no binding at all and this screen is what the author sees.
 *
 * ⛔ The refusal screen itself is deliberately NOT redesigned by this card —
 * these cases read its existing copy verbatim.
 *
 * Both directions are pinned, because a fix that refused EVERY view would also
 * pass a refusal-only test: the CONTROL cases assert a declared gantt still
 * renders its tasks, on its own declared fields, unchanged.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ObjectGantt } from './ObjectGantt';

// Stand-in for the timeline canvas: the point of every case here is WHICH of
// the two screens is reached, so the chart only has to be identifiable and to
// name the tasks it was handed.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid="gantt-task">{t.title}</div>
      ))}
    </div>
  ),
}));

afterEach(cleanup);

const REFUSAL = /Gantt configuration required/i;

const ROWS = [
  { id: 'r1', name: 'Ada onboarding', start_date: '2024-01-01', end_date: '2024-01-05' },
  { id: 'r2', name: 'Grace onboarding', start_date: '2024-01-06', end_date: '2024-01-10' },
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
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(objectDef),
  }) as any;

describe('ObjectGantt — an unconfigured view reaches the refusal screen (objectui#7070)', () => {
  it('REFUSES the props a view with NO gantt block now produces', async () => {
    // Exactly what the fixed faces emit for a view that declared nothing: the
    // flat binding props are simply absent. Before this card the same view
    // arrived carrying `startDateField: 'start_date'` / `endDateField:
    // 'end_date'`, so this early return was unreachable from all three routes.
    render(
      <ObjectGantt
        schema={{ type: 'object-gantt', objectName: 'crm_leave_request' } as any}
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
    // …and it is a REFUSAL, not a chart that merely looks empty. This is the
    // distinction #7070 asked to be measured before deleting anything.
    expect(screen.queryByTestId('gantt-view')).toBeNull();
    expect(screen.queryByTestId('gantt-task')).toBeNull();
  });

  it('REFUSES a HALF-declared axis — one date field is not a gantt', async () => {
    // `getGanttConfig`'s flat branch is taken only when BOTH date fields are
    // present; a partial spelling falls through to `null`. Pinned because the
    // fixed faces now emit exactly this shape for a view that declared one rung.
    render(
      <ObjectGantt
        schema={
          { type: 'object-gantt', objectName: 'crm_leave_request', startDateField: 'start_date' } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
    expect(screen.queryByTestId('gantt-view')).toBeNull();
  });

  it('refuses even when the out-of-scope `progress`/`dependencies` floors are still handed in', async () => {
    // ⛔ objectui#7070 deliberately leaves `progressField: … || 'progress'` and
    // `dependenciesField: … || 'dependencies'` in place on the two plugin faces
    // (a different flavour — not date axes, different absent-value semantics).
    // This case is the measurement that leaving them does NOT keep the refusal
    // unreachable: `getGanttConfig` gates on the two DATE fields only, so the
    // surviving pair cannot resurrect a config on its own.
    render(
      <ObjectGantt
        schema={
          {
            type: 'object-gantt',
            objectName: 'crm_leave_request',
            progressField: 'progress',
            dependenciesField: 'dependencies',
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
    expect(screen.queryByTestId('gantt-view')).toBeNull();
  });

  it('CONTROL: a declared flat binding renders its tasks, unaffected', async () => {
    // Without this case a fix that refused EVERYTHING would look identical to
    // the fix that was ruled.
    render(
      <ObjectGantt
        schema={
          {
            type: 'object-gantt',
            objectName: 'crm_leave_request',
            startDateField: 'start_date',
            endDateField: 'end_date',
            titleField: 'name',
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(screen.getByText('Ada onboarding')).toBeTruthy();
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('CONTROL: the nested spec `gantt` block still configures the renderer', async () => {
    render(
      <ObjectGantt
        schema={
          {
            type: 'object-gantt',
            objectName: 'crm_leave_request',
            gantt: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(screen.getByText('Grace onboarding')).toBeTruthy();
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});
