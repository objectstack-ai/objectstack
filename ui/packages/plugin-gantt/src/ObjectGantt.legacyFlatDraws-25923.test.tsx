/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25923 — the renderer half of the producers' fallback.
 *
 * `ListView` and `ObjectView` now hand the gantt binding on as the node's
 * `gantt` block, and `getGanttConfig` VALIDATES a block against the spec's
 * `GanttConfigSchema` (objectui#13459), where its flat branch never validated
 * anything. So a stored view whose legacy `options.gantt` carries a value the
 * spec refuses would have moved from drawing to the refusal screen. The
 * producers therefore hand exactly that block flat, as they did before; this
 * file pins why that keeps the view drawing: the same values draw flat and are
 * refused nested. The producer halves are pinned in `plugin-list`'s
 * `ListView.gantt-binding-7070` and `plugin-view`'s `ObjectView.ganttBinding-7070`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { GanttConfigSchema } from '@objectstack/spec/ui';
import { ObjectGantt } from './ObjectGantt';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid="gantt-task">{t.title}</div>
      ))}
    </div>
  ),
}));

const ROWS = [{ id: 'r1', name: 'Ada onboarding', start_date: '2024-01-01', end_date: '2024-01-05' }];

/** What a legacy `options.gantt` could carry: the axis, plus a value the spec refuses. */
const LEGACY = { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name', viewMode: 'hour' };

const node = (binding: Record<string, unknown>) =>
  ({ type: 'object-gantt', objectName: 'crm_task', data: { provider: 'value', items: ROWS }, ...binding }) as any;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  cleanup();
});

describe('objectstack#25923 — a binding the spec refuses draws flat and is refused nested', () => {
  it('the fixture really is refused by the spec (non-vacuity)', () => {
    expect(GanttConfigSchema.safeParse(LEGACY).success).toBe(false);
  });

  it('handed FLAT, as the producers hand it, the chart draws', async () => {
    render(<ObjectGantt schema={node(LEGACY)} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(screen.getByText('Ada onboarding')).toBeTruthy();
    expect(screen.queryByTestId('gantt-invalid-config')).toBeNull();
  });

  it('CONTROL: the same values nested in `gantt` reach the refusal screen', async () => {
    render(<ObjectGantt schema={node({ gantt: LEGACY })} />);
    expect(await screen.findByTestId('gantt-invalid-config')).toBeTruthy();
    expect(screen.queryByTestId('gantt-view')).toBeNull();
  });
});
