// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7611 — a position's holders on the Setup catalog's position page.
 * Holding a position is an assignment row of the caller's organization that
 * names the position BY NAME (`sys_user_position.position`); the section reads
 * and writes exactly that, and shows the server's own words when it refuses.
 */
import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

let pickRecords: ((records: any[]) => void) | null = null;
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: (props: { onSelectRecords: (records: any[]) => void }) => {
    pickRecords = props.onSelectRecords;
    return null;
  },
}));

const assignments = [
  { id: 'up_1', user_id: 'u_1', position: 'auditor' },
  { id: 'up_2', user_id: 'u_2', position: 'auditor' },
];
const users = [
  { id: 'u_1', name: 'Ada Auditor', email: 'ada@example.com' },
  { id: 'u_2', name: 'Bob Builder', email: 'bob@example.com' },
  { id: 'u_3', name: 'Cy Clerk', email: 'cy@example.com' },
];

const adapter = {
  find: vi.fn(async (object: string, query: any) => {
    if (object === 'sys_user_position') {
      return { data: assignments.filter((a) => a.position === query?.$filter?.position) };
    }
    if (object === 'sys_user') {
      const ids: string[] = query?.$filter?.id?.$in ?? [];
      return { data: users.filter((u) => ids.includes(u.id)) };
    }
    return { data: [] };
  }),
  create: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
}));

import { PositionHoldersSection } from './PositionHoldersSection';

beforeEach(() => {
  adapter.find.mockClear();
  adapter.create.mockReset();
  adapter.create.mockResolvedValue({});
  adapter.delete.mockClear();
  pickRecords = null;
});

describe('PositionHoldersSection (objectui#7611)', () => {
  it('lists the people whose assignment names the position', async () => {
    render(<PositionHoldersSection name="auditor" />);
    await waitFor(() => expect(screen.getByText('Ada Auditor')).toBeTruthy());
    expect(screen.getByText('Bob Builder')).toBeTruthy();
    expect(adapter.find).toHaveBeenCalledWith('sys_user_position', { $filter: { position: 'auditor' }, $top: 1000 });
    // No catalog row is read: the position is known by its name alone.
    expect(adapter.find.mock.calls.map(([o]) => o)).not.toContain('sys_position');
  });

  it('assigns BY NAME and skips someone who already holds it', async () => {
    render(<PositionHoldersSection name="auditor" />);
    await waitFor(() => expect(screen.getByText('Ada Auditor')).toBeTruthy());
    pickRecords!([{ id: 'u_1' }, { id: 'u_3' }]);
    await waitFor(() => expect(adapter.create).toHaveBeenCalledTimes(1));
    expect(adapter.create).toHaveBeenCalledWith('sys_user_position', { user_id: 'u_3', position: 'auditor' });
  });

  it('removes the assignment row once the confirm is accepted (objectui#13337)', async () => {
    render(<PositionHoldersSection name="auditor" />);
    await waitFor(() => expect(screen.getByText('Ada Auditor')).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText('Remove')[0]);
    fireEvent.click(await screen.findByTestId('position-holder-remove-confirm'));
    await waitFor(() => expect(adapter.delete).toHaveBeenCalledWith('sys_user_position', 'up_1'));
  });

  it("shows the server's refusal in its own words", async () => {
    const sentence = "Position: no position is named 'auditor'.";
    adapter.create.mockRejectedValueOnce(new Error(sentence));
    render(<PositionHoldersSection name="auditor" />);
    await waitFor(() => expect(screen.getByText('Ada Auditor')).toBeTruthy());
    pickRecords!([{ id: 'u_3' }]);
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence);
  });
});
