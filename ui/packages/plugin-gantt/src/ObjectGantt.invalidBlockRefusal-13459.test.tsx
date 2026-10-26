/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13459 — a `gantt` block that fails `GanttConfigSchema` is REFUSED,
 * never drawn.
 *
 * Before this card the block's `safeParse` failure was a `console.warn`, and the
 * unvalidated block was returned and rendered anyway: a misspelt key or a
 * missing date field still drew a plausible chart, so the author never learnt
 * the block was wrong. The refusal names each parse issue by its path inside
 * the block.
 *
 * The CONTROL case pins the other direction: a valid block still renders, so a
 * fix that refused every block would not pass this file.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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

const ROWS = [
  { id: 'r1', name: 'Ada onboarding', start_date: '2024-01-01', end_date: '2024-01-05' },
];

const inline = (gantt: Record<string, unknown>) =>
  ({
    type: 'object-gantt',
    objectName: 'crm_leave_request',
    gantt,
    data: { provider: 'value', items: ROWS },
  }) as any;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  cleanup();
});

describe('ObjectGantt — an invalid `gantt` block is refused (objectui#13459)', () => {
  it('REFUSES a block carrying a key the spec does not declare, and names it', async () => {
    render(
      <ObjectGantt
        schema={inline({
          startDateField: 'start_date',
          endDateField: 'end_date',
          titleField: 'name',
          startField: 'start_date',
        })}
      />,
    );
    const refusal = await screen.findByTestId('gantt-invalid-config');
    expect(refusal.getAttribute('role')).toBe('alert');
    expect(refusal.textContent).toContain('Invalid gantt configuration');
    expect(refusal.textContent).toContain('startField');
    expect(screen.queryByTestId('gantt-view')).toBeNull();
    expect(screen.queryByTestId('gantt-task')).toBeNull();
  });

  it('REFUSES a block missing a required field, naming its path in the block', async () => {
    render(<ObjectGantt schema={inline({ startDateField: 'start_date', titleField: 'name' })} />);
    const refusal = await screen.findByTestId('gantt-invalid-config');
    expect(refusal.textContent).toContain('gantt.endDateField');
    expect(screen.queryByTestId('gantt-view')).toBeNull();
  });

  it('keeps the console diagnostic beside the refusal', async () => {
    render(<ObjectGantt schema={inline({ startDateField: 'start_date', titleField: 'name' })} />);
    await screen.findByTestId('gantt-invalid-config');
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('Invalid gantt configuration'))).toBe(true);
  });

  it('CONTROL: a valid block still renders its tasks, with no refusal', async () => {
    render(
      <ObjectGantt
        schema={inline({ startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(screen.getByText('Ada onboarding')).toBeTruthy();
    expect(screen.queryByTestId('gantt-invalid-config')).toBeNull();
  });
});
