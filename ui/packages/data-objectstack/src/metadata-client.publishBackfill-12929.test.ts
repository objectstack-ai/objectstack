/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12929 — the batch publish door carries the protocol's opt-in
 * `backfill` (objectstack#24253), and only when the caller names one.
 *
 * Two directions, both on the bytes the door sends:
 *
 * - With no options the body is `{}`, exactly what every caller sent before:
 *   a caller that names nothing asks for no write into existing rows.
 * - With `backfill`, the body carries it as given, and the receipt the server
 *   returns (`backfillApplied`) comes back on the result. The fixture parses
 *   against the INSTALLED spec's `PublishPackageDraftsResponseSchema`, so this
 *   pin cannot outlive the receipt shape it claims.
 */

import { describe, it, expect, vi } from 'vitest';
import { PublishPackageDraftsResponseSchema } from '@objectstack/spec/api';
import { MetadataClient } from './metadata-client';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A client whose every request is recorded, answering `body` to each. */
function recordingClient(body: unknown) {
  const sent: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: init?.body });
    return json(body);
  });
  const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
  return { client, sent };
}

/** The batch door's answer as the dispatcher sends it: the protocol result inside `{ success, data }`. */
function batch(data: Record<string, unknown>) {
  return {
    success: true,
    data: {
      success: true,
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: [{ type: 'object', name: 'st_ticket', version: 'sha256:1' }],
      failed: [],
      ...data,
    },
  };
}

describe('MetadataClient.publishPackageDrafts — the opt-in backfill (objectui#12929)', () => {
  it('sends `{}` when the caller names no backfill — the request every caller sent before', async () => {
    const { client, sent } = recordingClient(batch({}));

    await client.publishPackageDrafts('com.x');
    await client.publishPackageDrafts('com.x', {});
    await client.publishPackageDrafts('com.x', undefined);

    expect(sent).toHaveLength(3);
    for (const request of sent) {
      expect(request.url).toBe('http://test.local/api/v1/packages/com.x/publish-drafts');
      expect(request.body).toBe('{}');
    }
  });

  it('sends the named fields as the body’s `backfill`, in the order given', async () => {
    const { client, sent } = recordingClient(batch({}));
    const backfill = [
      { object: 'st_ticket', field: 'done' },
      { object: 'st_ticket', field: 'priority' },
    ];

    await client.publishPackageDrafts('com.x', { backfill });

    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.body))).toEqual({ backfill });
  });

  it('returns the receipt the server sent, per field, unexamined', async () => {
    const receipt = {
      success: false,
      fields: [
        { object: 'st_ticket', field: 'done', updated: 12 },
        { object: 'st_ticket', field: 'priority', updated: 3, error: 'record st_ticket/r4: refused', code: 'FORBIDDEN' },
      ],
    };
    const answer = batch({ backfillApplied: receipt });
    // The fixture is the contract, read off the spec this package installs.
    expect(PublishPackageDraftsResponseSchema.safeParse(answer.data).success).toBe(true);
    const { client } = recordingClient(answer);

    const result = await client.publishPackageDrafts('com.x', {
      backfill: [
        { object: 'st_ticket', field: 'done' },
        { object: 'st_ticket', field: 'priority' },
      ],
    });

    expect(result.backfillApplied).toEqual(receipt);
  });
});
