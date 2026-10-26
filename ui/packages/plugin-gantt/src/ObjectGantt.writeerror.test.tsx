/**
 * Write-failure surfacing (#2473 第 2 项).
 *
 * A rejected write used to be console.error'd and silently reverted — the
 * server's reason (e.g. a 403 permission message in the response body) never
 * reached the user. ObjectGantt must raise a toast on every failed write,
 * with the server-provided message extracted from the ApiDataSource error
 * string ("ApiDataSource: HTTP 403 Forbidden — {json body}") as description.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectGantt } from './ObjectGantt';
import { DataSource } from '@object-ui/types';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onTaskUpdate }: any) => (
    <div data-testid="gantt-view">
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
    </div>
  ),
}));

const ROWS = [
  { id: '1', name: 'Task 1', start_date: '2024-01-01', end_date: '2024-01-05' },
];

const SCHEMA: any = {
  type: 'gantt',
  gantt: {
    titleField: 'name',
    startDateField: 'start_date',
    endDateField: 'end_date',
  },
  data: { provider: 'object', object: 'tasks' },
};

function makeDataSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ fields: {} }),
    ...overrides,
  } as DataSource;
}

async function renderAndFailUpdate(updateError: Error) {
  const ds = makeDataSource({ update: vi.fn().mockRejectedValue(updateError) });
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<ObjectGantt schema={SCHEMA} dataSource={ds} />);
  await waitFor(() => expect(screen.getByText('Task 1')).toBeDefined());
  fireEvent.click(screen.getByTestId('gv-update-first'));
  await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  errSpy.mockRestore();
  return (toast.error as any).mock.calls[0];
}

describe('ObjectGantt write-failure toast', () => {
  beforeEach(() => {
    (toast.error as any).mockClear();
  });

  it('extracts the server message from an ApiDataSource-style error body', async () => {
    const [title, opts] = await renderAndFailUpdate(new Error(
      'ApiDataSource: HTTP 403 Forbidden — {"error":"not_manager","message":"仅管理责任人可修改该排班计划"}',
    ));
    expect(title).toBe('Save failed — the change was rolled back');
    expect(opts.description).toBe('仅管理责任人可修改该排班计划');
  });

  it('falls back to `error` when the body has no `message`', async () => {
    const [, opts] = await renderAndFailUpdate(new Error(
      'ApiDataSource: HTTP 500 Internal Server Error — {"error":"boom"}',
    ));
    expect(opts.description).toBe('boom');
  });

  it('omits the description for errors without a parseable body', async () => {
    const [title, opts] = await renderAndFailUpdate(new Error('network down'));
    expect(title).toBe('Save failed — the change was rolled back');
    expect(opts.description).toBeUndefined();
  });

  it('does not toast on a successful write', async () => {
    const ds = makeDataSource();
    render(<ObjectGantt schema={SCHEMA} dataSource={ds} />);
    await waitFor(() => expect(screen.getByText('Task 1')).toBeDefined());
    fireEvent.click(screen.getByTestId('gv-update-first'));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
