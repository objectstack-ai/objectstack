/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The activity feed names the user behind a row that carries `actor_id` and no
 * `actor_name` (objectui#12067), instead of calling that user "System".
 *
 * Measured on this tree before the fix: `activityRowToFeedItem` mapped
 * `actor: row.actor_name ?? systemActorLabel`, so the 17.7.0 row (`actor_id`
 * set, no `actor_name`, objectstack#22510) read "System", the label for a
 * change no person made. The `record:activity` block's self-fetch and the
 * console record page's merged feed both build their items with it.
 *
 * The rule is `activityActorName`, the one `record:history` uses: the
 * `actor_name` snapshot, else the expanded `actor_id`'s `name`, else the
 * existing fallback.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { activityRowToFeedItem } from '../recordActivityFeed';
import { RecordActivityRenderer } from '../record-activity';

const ADA = { id: 'u-ada', name: 'Ada Lovelace' };

const base = { id: 'a-1', type: 'updated', summary: 'Stage changed' };

beforeEach(() => {
  cleanup();
});

describe('activityRowToFeedItem — who acted (objectui#12067)', () => {
  it("a row with only an expanded `actor_id` names that user", () => {
    expect(activityRowToFeedItem({ ...base, actor_id: ADA }, 'System')?.actor).toBe('Ada Lovelace');
  });

  it('a row with both keeps `actor_name`, the snapshot taken at the time of the action', () => {
    expect(
      activityRowToFeedItem({ ...base, actor_name: 'Ada (at the time)', actor_id: ADA }, 'System')?.actor,
    ).toBe('Ada (at the time)');
  });

  it('a row with neither, or with an id the engine could not expand, keeps the existing fallback', () => {
    expect(activityRowToFeedItem({ ...base }, 'System')?.actor).toBe('System');
    expect(activityRowToFeedItem({ ...base, actor_name: '  ' }, 'System')?.actor).toBe('System');
    // A bare id is what the engine leaves when the viewer may not read the user.
    expect(activityRowToFeedItem({ ...base, actor_id: 'u-hidden' }, 'System')?.actor).toBe('System');
  });
});

describe('record:activity self-fetch expands `actor_id` (objectui#12067)', () => {
  it('names the actor of id-only rows from the page read, with no read per row', async () => {
    const rows = [
      { ...base, id: 'a-1', timestamp: '2026-01-02T00:00:00.000Z', actor_id: 'u-ada' },
      { ...base, id: 'a-2', timestamp: '2026-01-03T00:00:00.000Z', actor_id: 'u-ada' },
    ];
    const dataSource = {
      find: vi.fn(async (_object: string, params: { $expand?: string[] } = {}) => ({
        data: rows.map((r) =>
          params.$expand?.includes('actor_id') ? { ...r, actor_id: ADA } : { ...r },
        ),
      })),
    } as any;

    render(
      <RecordContextProvider
        objectName="crm_lead"
        recordId="rec-1"
        data={{ id: 'rec-1', name: 'Lead 1' }}
        dataSource={dataSource}
      >
        <RecordActivityRenderer schema={{} as any} />
      </RecordContextProvider>,
    );

    expect(await screen.findAllByText('Ada Lovelace')).toHaveLength(2);
    expect(screen.queryByText('System')).toBeNull();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls.map((c: unknown[]) => c[0])).toEqual(['sys_activity']);
    expect(dataSource.find.mock.calls[0][1].$expand).toEqual(['actor_id']);
  });
});
