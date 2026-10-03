// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21454] The stored-metadata reader seam, against a scoped-API double: which
 * reads it serves, through which derived contexts, and that it serves each one
 * exactly once. The composed contexts are pinned end to end, against the data
 * door, in `stored-metadata-reader-contexts.pin.test.ts`; this file holds the
 * routes a body or handler can take around the seam that the composition does
 * not exercise one by one.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ephemeralStoredHashDigest } from '@objectstack/metadata-protocol';
import { serveStoredMetadataRead, serveStoredMetadataReadsThrough } from './stored-metadata-reader-seam.js';

const SENTINEL = 'seam-unit-sentinel-41d7';
const STORED_HASH = `sha256:${'a1'.repeat(32)}`;

function storedRow(): Record<string, unknown> {
  return {
    id: 'row_1',
    type: 'datasource',
    name: 'unit_ds',
    metadata: JSON.stringify({
      name: 'unit_ds',
      driver: 'turso',
      config: { url: 'libsql://unit.example.invalid', encryptionKey: SENTINEL },
    }),
    checksum: STORED_HASH,
  };
}

/** A keyed-digest provider whose output names what it keyed. */
const provider = async (plain: string) => `keyed:${plain.length}`;
const engineWithProvider = { getKeyedDigest: () => provider };

/** A double of the engine's scoped API: every derived context reads the same store. */
function scopedApi(seen: { fields: unknown[] } = { fields: [] }): any {
  const repo = (name: string) => ({
    async find(query?: any) {
      seen.fields.push(query?.fields);
      return name.startsWith('sys_metadata') ? [storedRow()] : [{ id: 'n1', metadata: 'ordinary', checksum: STORED_HASH }];
    },
    async findOne(query?: any) {
      assertEngineFindOnePredicate(name, query);
      return name.startsWith('sys_metadata') ? storedRow() : null;
    },
    async count() { return 1; },
    async aggregate() { return [{ type: 'datasource', metadata: storedRow().metadata, checksum: STORED_HASH, count: 1 }]; },
  });
  return {
    object: repo,
    sudo: () => scopedApi(seen),
    withRunAs: () => scopedApi(seen),
    async transaction(callback: (trx: any, info: unknown) => Promise<unknown>) {
      return callback(scopedApi(seen), { owned: true });
    },
    async beginTransaction() { return { ctx: scopedApi(seen), handle: 'trx_1', owned: true }; },
  };
}

function expectServed(row: any, hash = 'keyed:71'): void {
  expect(String(row.metadata)).not.toContain(SENTINEL);
  expect(String(row.metadata)).toContain('unit.example.invalid');
  expect(row.checksum).toBe(hash);
}

describe('[#21454] serveStoredMetadataReadsThrough — the reads it serves', () => {
  it('find, findOne and aggregate on a family object answer the projected body and the keyed hash', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    for (const object of ['sys_metadata', 'sys_metadata_history']) {
      expectServed((await api.object(object).find({ where: {} }))[0]);
      expectServed(await api.object(object).findOne({ where: { id: 'row_1' } }));
      expectServed((await api.object(object).aggregate({ groupBy: ['type', 'metadata', 'checksum'] }))[0]);
      expect(await api.object(object).count({})).toBe(1);
    }
  });

  it('an object outside the family is answered as read, by reference', async () => {
    const raw = scopedApi();
    const api = serveStoredMetadataReadsThrough(raw, engineWithProvider);
    const rows = await api.object('pin_note').find({});
    expect(rows[0]).toEqual({ id: 'n1', metadata: 'ordinary', checksum: STORED_HASH });
  });

  it('every derived context is served too: sudo, withRunAs, transaction(fn), beginTransaction', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    expectServed((await api.sudo().object('sys_metadata').find({}))[0]);
    expectServed((await api.withRunAs('system', {}).object('sys_metadata').find({}))[0]);
    await api.transaction(async (trx: any) => {
      expectServed((await trx.object('sys_metadata').find({}))[0]);
    });
    const begun = await api.beginTransaction();
    expect(begun.handle).toBe('trx_1');
    expect(begun.owned).toBe(true);
    expectServed((await begun.ctx.object('sys_metadata').find({}))[0]);
  });

  it('serves once: an API already served through the seam is returned as is', async () => {
    const once = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    const twice = serveStoredMetadataReadsThrough(once, engineWithProvider);
    expect(twice).toBe(once);
    expectServed((await twice.object('sys_metadata').find({}))[0]);
  });

  it('a projection naming the body alone reads the type beside it and serves exactly the columns named', async () => {
    const seen = { fields: [] as unknown[] };
    const api = serveStoredMetadataReadsThrough(scopedApi(seen), engineWithProvider);
    const [row] = await api.object('sys_metadata').find({ fields: ['metadata'] });
    expect(seen.fields).toEqual([['metadata', 'type']]);
    expect('type' in row).toBe(false);
    expect(String(row.metadata)).not.toContain(SENTINEL);
  });

  it('with no crypto provider, the hash is keyed under the data door\'s own process key', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), {});
    const [row] = await api.object('sys_metadata').find({});
    expect(row.checksum).toBe(await ephemeralStoredHashDigest(STORED_HASH));
    expect(row.checksum).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
  });
});

describe('[#21454] serveStoredMetadataRead — one read, served in the shape it arrived in', () => {
  it('a row list, one row, and null', async () => {
    const [listed] = await serveStoredMetadataRead('sys_metadata', {}, engineWithProvider, async () => [storedRow()]);
    expectServed(listed);
    expectServed(await serveStoredMetadataRead('sys_metadata', {}, engineWithProvider, async () => storedRow()));
    expect(await serveStoredMetadataRead('sys_metadata', {}, engineWithProvider, async () => null)).toBeNull();
  });

  it('an object outside the family runs the caller\'s query untouched and returns the answer by reference', async () => {
    const query = { fields: ['metadata'] };
    const answer = [storedRow()];
    let received: unknown;
    const out = await serveStoredMetadataRead('pin_note', query, engineWithProvider, async (q) => {
      received = q;
      return answer;
    });
    expect(received).toBe(query);
    expect(out).toBe(answer);
  });
});
