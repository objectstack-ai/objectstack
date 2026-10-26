import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

/**
 * #2436 第 5 项 — the record drawer must honor row-level locks.
 *
 * A row locked via `lockField` (or a globally read-only gantt) already
 * refuses drag/resize on the timeline, but the click-through drawer used to
 * receive `onFieldSave` / `onDelete` unconditionally — so users could edit
 * or delete a locked 排班计划 through the side door. ObjectGantt must omit
 * both handlers for locked records; RecordDetailDrawer then renders
 * strictly read-only (capability = handler presence, covered by
 * plugin-detail's RecordDetailDrawer.capability tests).
 *
 * The drawer is mocked to a probe that reports which handlers it received.
 */

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onTaskClick }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <button key={t.id} data-testid={`gv-view-${t.id}`} onClick={() => onTaskClick?.(t)}>
          {t.title}
        </button>
      ))}
    </div>
  ),
}));

// objectui#9299: the capability props now land on `RecordDetailPanel`, the
// shell-free payload `ObjectGantt` mounts through `NavigationOverlay`.
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailPanel: (props: any) => (
    <div
      data-testid="drawer-probe"
      data-has-field-save={String(!!props.onFieldSave)}
      data-has-delete={String(!!props.onDelete)}
    />
  ),
  deriveRecordPageHref: () => null,
}));

const DATA = [
  { id: '1', name: 'Free task', start_date: '2024-01-01', end_date: '2024-01-05', locked: false },
  { id: '2', name: 'Locked task', start_date: '2024-01-06', end_date: '2024-01-10', locked: true },
];

function makeSchema(extra: Record<string, any> = {}) {
  return {
    type: 'gantt',
    objectName: 'tasks',
    gantt: {
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
      lockField: 'locked',
    },
    data: { provider: 'value', items: DATA },
    ...extra,
  } as any;
}

async function openDrawerFor(taskId: string, schema: any) {
  render(<ObjectGantt schema={schema} />);
  await waitFor(() => expect(screen.getByTestId(`gv-view-${taskId}`)).toBeDefined());
  fireEvent.click(screen.getByTestId(`gv-view-${taskId}`));
  return waitFor(() => screen.getByTestId('drawer-probe'));
}

describe('ObjectGantt drawer vs row-level lock (lockField)', () => {
  it('passes save/delete handlers for an unlocked record', async () => {
    const probe = await openDrawerFor('1', makeSchema());
    expect(probe.getAttribute('data-has-field-save')).toBe('true');
    expect(probe.getAttribute('data-has-delete')).toBe('true');
  });

  it('omits both handlers for a locked record', async () => {
    const probe = await openDrawerFor('2', makeSchema());
    expect(probe.getAttribute('data-has-field-save')).toBe('false');
    expect(probe.getAttribute('data-has-delete')).toBe('false');
  });

  it('omits both handlers for every record when the gantt is globally readOnly', async () => {
    const probe = await openDrawerFor('1', makeSchema({ readOnly: true }));
    expect(probe.getAttribute('data-has-field-save')).toBe('false');
    expect(probe.getAttribute('data-has-delete')).toBe('false');
  });
});
