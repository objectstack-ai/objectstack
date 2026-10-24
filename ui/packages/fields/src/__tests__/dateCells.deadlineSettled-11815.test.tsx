/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — overdue is declared-only (ruling D).
 *
 * A date or datetime reads overdue only when its field declares
 * `dueLike: true`, and never while the host says the deadline is settled for
 * the row (`deadlineSettled`, the verdict of `isDeadlineSettled` in
 * `@object-ui/core`). Settled reads exactly as a non-deadline: the neutral
 * relative phrase, no red. The field-name guess is retired, so an undeclared
 * `due_date` in the past is neutral too.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DateCellRenderer, DateTimeCellRenderer } from '../index';

afterEach(() => cleanup());

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

const face = (el: HTMLElement) => {
  const span = el.querySelector('span.tabular-nums') as HTMLElement | null;
  return { text: span?.textContent ?? '', red: !!span?.className.includes('text-red-600') };
};

const DUE_DATE = { type: 'date', name: 'due_date', dueLike: true, settledWhen: "record.status == 'done'" } as any;
const DUE_DATETIME = { type: 'datetime', name: 'due_at', dueLike: true, format: 'relative', settledWhen: "record.status == 'done'" } as any;

describe('date cell (objectui#11815)', () => {
  it('a declared deadline in the past reads "Overdue Nd" in red', () => {
    const { container } = render(<DateCellRenderer value={daysFromNow(-6)} field={DUE_DATE} />);
    expect(face(container)).toEqual({ text: 'Overdue 6d', red: true });
  });

  it('the same deadline, settled for the row, reads neutral with no red', () => {
    const { container } = render(<DateCellRenderer value={daysFromNow(-6)} field={DUE_DATE} deadlineSettled />);
    expect(face(container)).toEqual({ text: '6 days ago', red: false });
  });

  it('deadlineSettled={false} changes nothing', () => {
    const { container } = render(<DateCellRenderer value={daysFromNow(-6)} field={DUE_DATE} deadlineSettled={false} />);
    expect(face(container)).toEqual({ text: 'Overdue 6d', red: true });
  });

  it('CONTROL — an undeclared due_date in the past reads neutral', () => {
    const { container } = render(<DateCellRenderer value={daysFromNow(-6)} field={{ type: 'date', name: 'due_date' } as any} />);
    expect(face(container)).toEqual({ text: '6 days ago', red: false });
  });

  it('CONTROL — a declared deadline in the future is unchanged', () => {
    const { container } = render(<DateCellRenderer value={daysFromNow(3)} field={DUE_DATE} />);
    expect(face(container)).toEqual({ text: 'In 3 days', red: false });
  });
});

describe('datetime cell (objectui#11815)', () => {
  it('a declared deadline in the past reads "Overdue Nd" in red', () => {
    const { container } = render(<DateTimeCellRenderer value={daysFromNow(-6)} field={DUE_DATETIME} />);
    expect(face(container)).toEqual({ text: 'Overdue 6d', red: true });
  });

  it('the same deadline, settled for the row, reads neutral with no red', () => {
    const { container } = render(<DateTimeCellRenderer value={daysFromNow(-6)} field={DUE_DATETIME} deadlineSettled />);
    expect(face(container)).toEqual({ text: '6 days ago', red: false });
  });

  it('settled on the compact face, the default, paints no red either', () => {
    const compact = { ...DUE_DATETIME, format: undefined };
    const open = render(<DateTimeCellRenderer value={daysFromNow(-6)} field={compact} />);
    expect(face(open.container).red).toBe(true);
    cleanup();
    const settled = render(<DateTimeCellRenderer value={daysFromNow(-6)} field={compact} deadlineSettled />);
    expect(face(settled.container).red).toBe(false);
  });

  it('CONTROL — an undeclared due_at in the past reads neutral', () => {
    const { container } = render(
      <DateTimeCellRenderer value={daysFromNow(-6)} field={{ type: 'datetime', name: 'due_at', format: 'relative' } as any} />,
    );
    expect(face(container)).toEqual({ text: '6 days ago', red: false });
  });

  it('CONTROL — a declared deadline in the future is unchanged', () => {
    const { container } = render(<DateTimeCellRenderer value={daysFromNow(3)} field={DUE_DATETIME} />);
    expect(face(container)).toEqual({ text: 'In 3 days', red: false });
  });
});
