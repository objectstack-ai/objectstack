/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:history` names the user behind a row that carries `actor_id` and no
 * `actor_name` (objectui#12067).
 *
 * On `@objectstack/*` 17.7.0 the audit writer fills `sys_activity.actor_id` (a
 * lookup to `sys_user`) and never `actor_name` (objectstack#22510 fixes the
 * writer from then on). The self-fetch mapped the entry's user from
 * `actor_name` alone, so every such row read "Unknown user".
 *
 * The data source below answers the way objectql does: rows store the bare
 * user id, and a read that passes `$expand: ['actor_id']` gets each user's
 * record in place of the id, or keeps the bare id for a user the viewer may
 * not read. A read without the expand gets bare ids only, so the name pins go
 * red when the renderer stops asking for it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordHistoryRenderer } from '../record-history';

const UNKNOWN_USER = 'Unknown user';

/** The `sys_user` rows this viewer may read. */
const USERS: Record<string, { id: string; name: string }> = {
  'u-ada': { id: 'u-ada', name: 'Ada Lovelace' },
  'u-grace': { id: 'u-grace', name: 'Grace Hopper' },
};

type Row = Record<string, unknown>;

const row = (id: string, extra: Row): Row => ({
  id,
  type: 'updated',
  summary: `summary of ${id}`,
  timestamp: '2026-01-02T00:00:00.000Z',
  ...extra,
});

/** One `find()` that expands `actor_id` the way the engine does, or does not. */
function makeDataSource(rows: Row[]) {
  return {
    find: vi.fn(async (_object: string, params: { $expand?: string[] } = {}) => {
      const expand = params.$expand?.includes('actor_id') ?? false;
      return {
        data: rows.map((r) => {
          const id = r.actor_id;
          if (!expand || typeof id !== 'string') return { ...r };
          return { ...r, actor_id: USERS[id] ?? id };
        }),
      };
    }),
  } as any;
}

function mount(rows: Row[], schema: Record<string, unknown> = {}) {
  const dataSource = makeDataSource(rows);
  render(
    <RecordContextProvider
      objectName="crm_lead"
      recordId="rec-1"
      data={{ id: 'rec-1', name: 'Lead 1' }}
      dataSource={dataSource}
    >
      <RecordHistoryRenderer schema={schema as any} />
    </RecordContextProvider>,
  );
  return dataSource;
}

beforeEach(() => {
  cleanup();
});

describe('record:history names the actor of a row with only `actor_id` (objectui#12067)', () => {
  it("a row with only `actor_id` renders that user's name", async () => {
    mount([row('h-1', { actor_id: 'u-ada' })]);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByText(UNKNOWN_USER)).toBeNull();
  });

  it('a row with both renders `actor_name`, the snapshot taken at the time of the action', async () => {
    mount([row('h-1', { actor_id: 'u-ada', actor_name: 'Ada (at the time)' })]);
    expect(await screen.findByText('Ada (at the time)')).toBeTruthy();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  // objectui#12527 changed what the no-actor row says: it was this fallback,
  // it is now "System". The unreadable id keeps the fallback.
  it('a row with neither reads "System"; an id the viewer may not read keeps the fallback', async () => {
    mount(
      [
        row('h-1', {}),
        // The engine keeps the bare id when the user cannot be read.
        row('h-2', { actor_id: 'u-not-readable' }),
      ],
      { unknownUserText: 'Someone' },
    );
    await screen.findByText('summary of h-1');
    expect(screen.getAllByText('System')).toHaveLength(1);
    expect(screen.getAllByTestId('history-system-actor-glyph')).toHaveLength(1);
    expect(screen.getAllByText('Someone')).toHaveLength(1);
    // A raw id is never shown as the actor's name.
    expect(screen.queryByText('u-not-readable')).toBeNull();
  });

  it('a page of N id-only rows issues one read, not one per row', async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`h-${i}`, { actor_id: i % 2 === 0 ? 'u-ada' : 'u-grace' }),
    );
    const dataSource = mount(rows);

    expect(await screen.findAllByText('Ada Lovelace')).toHaveLength(3);
    expect(screen.getAllByText('Grace Hopper')).toHaveLength(3);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    // The names arrive on the page's own read: one `sys_activity` find that
    // expands `actor_id`, and no `sys_user` read at all.
    const objects = dataSource.find.mock.calls.map((c: unknown[]) => c[0]);
    expect(objects).toEqual(['sys_activity']);
    expect(dataSource.find.mock.calls[0][1].$expand).toEqual(['actor_id']);
  });
});
