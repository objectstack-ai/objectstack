import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';
import { DataSource } from '@object-ui/types';

/**
 * #2436 第 6/7 项 — write-readback + manual refresh.
 *
 * The optimistic patch after a drag/inline write only knows what the client
 * sent; server-computed fields (parent rollups, alert colors, recalculated
 * durations) stay stale until the data source is re-read. ObjectGantt must
 * silently re-fetch after every successful write, and expose a manual
 * refresh hook (toolbar button in GanttView) for object-provider charts.
 *
 * GanttView is mocked to a probe that reports whether onRefresh was wired
 * and lets tests drive onTaskUpdate / onRefresh directly.
 */

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onTaskUpdate, onRefresh }: any) => (
    <div data-testid="gantt-view" data-has-refresh={String(!!onRefresh)}>
      {tasks.map((t: any) => (
        <div key={t.id} data-testid="gantt-task">{t.title}</div>
      ))}
      <button
        data-testid="gv-update-first"
        onClick={() => onTaskUpdate?.(tasks[0], {
          start: new Date('2024-02-01T00:00:00.000Z'),
          end: new Date('2024-02-05T00:00:00.000Z'),
        })}
      >
        update
      </button>
      <button data-testid="gv-refresh" onClick={() => onRefresh?.()}>refresh</button>
    </div>
  ),
}));

const V1 = [
  { id: '1', name: 'Task 1', start_date: '2024-01-01', end_date: '2024-01-05' },
];
// What the server hands back AFTER recomputing derived fields.
const V2 = [
  { id: '1', name: 'Task 1 (server)', start_date: '2024-02-01', end_date: '2024-02-05' },
];

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
  },
};

function makeDataSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: V1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    ...overrides,
  } as DataSource;
}

const SCHEMA: any = {
  type: 'gantt',
  gantt: {
    titleField: 'name',
    startDateField: 'start_date',
    endDateField: 'end_date',
  },
  data: { provider: 'object', object: 'tasks' },
};

/** Render and wait until the initial loads (data + objectSchema refire) settle. */
async function renderSettled(ds: DataSource) {
  render(<ObjectGantt schema={SCHEMA} dataSource={ds} />);
  await waitFor(() => expect(screen.getByText('Task 1')).toBeDefined());
  // The objectSchema fetch re-arms the loader once; wait for call volume to
  // go quiet so later assertions on find-call deltas are meaningful.
  let calls = (ds.find as any).mock.calls.length;
  await waitFor(async () => {
    const now = (ds.find as any).mock.calls.length;
    if (now !== calls) {
      calls = now;
      throw new Error('still loading');
    }
  });
  return () => (ds.find as any).mock.calls.length;
}

describe('ObjectGantt write-readback (写后回读)', () => {
  it('re-reads the data source after a successful drag update', async () => {
    const ds = makeDataSource();
    const findCalls = await renderSettled(ds);
    const before = findCalls();

    // From now on the server returns recomputed data.
    (ds.find as any).mockResolvedValue({ data: V2 });
    fireEvent.click(screen.getByTestId('gv-update-first'));

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(findCalls()).toBeGreaterThan(before));
    // Server-computed state replaced the optimistic patch.
    await waitFor(() => expect(screen.getByText('Task 1 (server)')).toBeDefined());
  });

  it('does not re-read when the write fails (optimistic state reverts)', async () => {
    const ds = makeDataSource({
      update: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const findCalls = await renderSettled(ds);
    const before = findCalls();

    fireEvent.click(screen.getByTestId('gv-update-first'));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));

    // Reverted title still on screen, no readback issued.
    await waitFor(() => expect(screen.getByText('Task 1')).toBeDefined());
    expect(findCalls()).toBe(before);
    errSpy.mockRestore();
  });
});

describe('ObjectGantt manual refresh (手动刷新)', () => {
  it('wires onRefresh for object-provider charts and re-reads on demand', async () => {
    const ds = makeDataSource();
    const findCalls = await renderSettled(ds);
    expect(screen.getByTestId('gantt-view').getAttribute('data-has-refresh')).toBe('true');

    const before = findCalls();
    (ds.find as any).mockResolvedValue({ data: V2 });
    fireEvent.click(screen.getByTestId('gv-refresh'));

    await waitFor(() => expect(findCalls()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByText('Task 1 (server)')).toBeDefined());
  });

  it('offers no refresh for inline value data (nothing to re-read)', async () => {
    const schema: any = {
      ...SCHEMA,
      data: { provider: 'value', items: V1 },
    };
    render(<ObjectGantt schema={schema} />);
    await waitFor(() => expect(screen.getByText('Task 1')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-has-refresh')).toBe('false');
  });
});
