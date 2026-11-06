// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29793 — `MetadataClient.layered()` forwards the `draft` layer the
 * server serves (`GetMetaItemLayeredResponseSchema.draft`): the pending draft
 * row as stored, `null` when none is pending, and ABSENT when the server did not
 * serve the layer to this caller. The object editors build their buffer from it
 * (`draft ?? overlay ?? code`), so the client rebuilding its result field by
 * field and dropping the key left them nothing author-owned to edit.
 *
 * Both return branches are pinned: the conforming envelope and the degraded
 * one (a body the producer's schema refuses, forwarded field by field).
 */
import { describe, expect, it } from 'vitest';
import { GetMetaItemLayeredResponseSchema } from '@objectstack/spec/api';
import { MetadataClient } from './metadata-client';

function clientAnswering(body: unknown) {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

const STORED_DRAFT = { name: 'ticket', label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } };

const CONFORMING = {
  type: 'object',
  name: 'ticket',
  code: null,
  overlay: { name: 'ticket', label: 'Ticket', fields: {} },
  overlayScope: 'env',
  effective: { name: 'ticket', label: 'Ticket', fields: { owner_id: { type: 'lookup', label: 'Owner' } } },
  lock: 'none',
  editable: true,
  deletable: true,
  resettable: false,
} as const;

/** No lock verdicts: an older server, which lands on the degraded branch. */
const DEGRADED = {
  code: null,
  overlay: { name: 'ticket', label: 'Ticket', fields: {} },
  overlayScope: 'env',
  effective: { name: 'ticket', label: 'Ticket', fields: {} },
};

describe('MetadataClient.layered() forwards the stored draft layer (objectstack#29793)', () => {
  it('the conforming fixture parses, so the first cases exercise the conforming branch', () => {
    expect(GetMetaItemLayeredResponseSchema.safeParse({ ...CONFORMING, draft: STORED_DRAFT }).success).toBe(true);
    expect(GetMetaItemLayeredResponseSchema.safeParse({ ...DEGRADED, draft: STORED_DRAFT }).success).toBe(false);
  });

  for (const [branch, body] of [['conforming', CONFORMING], ['degraded', DEGRADED]] as const) {
    it(`${branch}: a pending draft arrives as stored`, async () => {
      const layered = await clientAnswering({ ...body, draft: STORED_DRAFT }).layered('object', 'ticket');
      expect(layered.draft).toStrictEqual(STORED_DRAFT);
    });

    it(`${branch}: no pending draft arrives as null`, async () => {
      const layered = await clientAnswering({ ...body, draft: null }).layered('object', 'ticket');
      expect('draft' in layered).toBe(true);
      expect(layered.draft).toBeNull();
    });

    it(`${branch}: a layer the server did not serve stays absent, never null`, async () => {
      const layered = await clientAnswering(body).layered('object', 'ticket');
      expect('draft' in layered).toBe(false);
    });
  }
});
