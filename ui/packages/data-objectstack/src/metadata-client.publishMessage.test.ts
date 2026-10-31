/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0146 D1 — the batch publish door carries the author's change note as the
 * body's `message`, and only when the caller passes one. The server records it
 * on the package commit and on every item history row the publish writes.
 *
 * Pinned on the bytes the door sends: no note ⇒ no `message` key (the body a
 * caller with no options always sent, `{}`); a note ⇒ `message` as given,
 * beside `backfill` when both are named.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

function recordingClient() {
  const sent: unknown[] = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(init?.body);
    return new Response(
      JSON.stringify({ success: true, data: { success: true, outcome: 'published', published: [], failed: [] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
  return { client, sent };
}

describe('MetadataClient.publishPackageDrafts — the change note (ADR-0146 D1)', () => {
  it('sends no `message` key when the caller passes no note', async () => {
    const { client, sent } = recordingClient();

    await client.publishPackageDrafts('com.x');
    await client.publishPackageDrafts('com.x', { backfill: [{ object: 'st_ticket', field: 'done' }] });

    expect(sent).toEqual(['{}', JSON.stringify({ backfill: [{ object: 'st_ticket', field: 'done' }] })]);
  });

  it('sends the note as the body’s `message`, as given, beside `backfill` when both are named', async () => {
    const { client, sent } = recordingClient();

    await client.publishPackageDrafts('com.x', { message: 'Add the escalation queue' });
    await client.publishPackageDrafts('com.x', {
      backfill: [{ object: 'st_ticket', field: 'done' }],
      message: 'Backfill done flags',
    });

    expect(sent.map((b) => JSON.parse(String(b)))).toEqual([
      { message: 'Add the escalation queue' },
      { backfill: [{ object: 'st_ticket', field: 'done' }], message: 'Backfill done flags' },
    ]);
  });
});
