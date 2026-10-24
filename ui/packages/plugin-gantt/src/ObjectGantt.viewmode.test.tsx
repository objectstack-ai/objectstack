/**
 * objectui#5074: `viewMode` is declared authoring surface (`ObjectGanttSchema`,
 * mirroring the spec's `GanttConfigSchema.viewMode`) and honoured by BOTH
 * renderer branches — the timeline (`GanttView`) and the resource-workload
 * grid (`ResourceWorkload`) — instead of only the latter.
 *
 * GanttView and ResourceWorkload are mocked to thin shells exposing the
 * `viewMode` prop ObjectGantt hands them (the same convention as the other
 * ObjectGantt tests). Absence semantics are load-bearing and asserted as
 * "the prop arrives EXACTLY undefined": GanttView's own seeding order for an
 * absent prop — explicit prop → persisted layout (persistLayoutKey) → 'day' —
 * is pinned separately by `GanttView.layout.test.tsx` ("restores a persisted
 * granularity on mount" / "lets the viewMode prop win over a persisted
 * granularity"). Together the two files close the chain: an omitted `viewMode`
 * keeps letting a persisted layout seed the granularity, and re-introducing a
 * default at the ObjectGantt wiring level (`|| 'day'` / `?? 'day'`) turns the
 * ABSENT pin below red.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, viewMode }: any) => (
    <div
      data-testid="gantt-view"
      data-count={tasks.length}
      data-view-mode={viewMode === undefined ? 'ABSENT' : String(viewMode)}
    />
  ),
}));

vi.mock('./ResourceWorkload', () => ({
  ResourceWorkload: ({ tasks, viewMode }: any) => (
    <div
      data-testid="resource-workload"
      data-count={tasks.length}
      data-view-mode={viewMode === undefined ? 'ABSENT' : String(viewMode)}
    />
  ),
}));

const INLINE = [
  { id: '1', name: 'Alpha', start: '2024-01-01', end: '2024-01-05', owner: 'ada' },
  { id: '2', name: 'Beta', start: '2024-02-01', end: '2024-02-10', owner: 'bob' },
];

/** Flattened ObjectGanttSchema style (top-level gantt fields). */
function schema(extra: Record<string, any> = {}) {
  return {
    type: 'object-gantt',
    startDateField: 'start',
    endDateField: 'end',
    titleField: 'name',
    data: { provider: 'value', items: INLINE },
    ...extra,
  } as any;
}

const modeOf = async (container: HTMLElement, testId: string) => {
  const el = () => container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  await waitFor(() => expect(el()?.getAttribute('data-count')).toBe('2'));
  return el().getAttribute('data-view-mode');
};

describe('ObjectGantt viewMode wiring — timeline branch (objectui#5074)', () => {
  it('honours an authored viewMode on the flattened object-gantt schema', async () => {
    const { container } = render(<ObjectGantt schema={schema({ viewMode: 'month' })} />);
    expect(await modeOf(container, 'gantt-view')).toBe('month');
  });

  it('honours an authored viewMode inside the spec gantt config block', async () => {
    // ObjectGridSchema style: the spec's GanttConfigSchema vocabulary under
    // `gantt` — the block the spec key was published on.
    const s = {
      type: 'object-grid',
      gantt: { startDateField: 'start', endDateField: 'end', titleField: 'name', viewMode: 'quarter' },
      data: { provider: 'value', items: INLINE },
    } as any;
    const { container } = render(<ObjectGantt schema={s} />);
    expect(await modeOf(container, 'gantt-view')).toBe('quarter');
  });

  it('passes NO viewMode when the author omitted it — persisted-layout seeding stays possible', async () => {
    // ⛔ This is the pin that stops someone "simplifying" a default back in:
    // `viewMode={ganttConfig?.viewMode || 'day'}` would arrive downstream as an
    // explicit author choice and defeat the persisted-layout seeding that
    // GanttView.layout.test.tsx pins for an absent prop.
    const { container } = render(<ObjectGantt schema={schema()} />);
    expect(await modeOf(container, 'gantt-view')).toBe('ABSENT');
  });
});

describe('ObjectGantt viewMode wiring — resource-workload branch (objectui#5074)', () => {
  it('still honours an authored viewMode', async () => {
    const s = schema({ viewMode: 'week', resourceView: true, assigneeField: 'owner' });
    const { container } = render(<ObjectGantt schema={s} />);
    expect(await modeOf(container, 'resource-workload')).toBe('week');
  });

  it("keeps the explicit 'day' fallback when omitted (unchanged behaviour)", async () => {
    const s = schema({ resourceView: true, assigneeField: 'owner' });
    const { container } = render(<ObjectGantt schema={s} />);
    expect(await modeOf(container, 'resource-workload')).toBe('day');
  });
});
