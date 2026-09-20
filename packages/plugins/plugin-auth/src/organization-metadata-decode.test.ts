// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18728] Producer half of maintainer ruling C: `sys_organization.metadata`
 * reaches the wire DECODED on every route that reads the row back.
 *
 * Two layers, and the second is the one that pins the wire rather than the
 * helper:
 *
 *  1. the helper's own branches — unset, decodable, undecodable, not-a-record;
 *  2. ⭐ the same behaviour observed THROUGH better-auth's real adapter factory
 *     with the organization plugin mounted, which is what the four read routes
 *     go through. `findOne` serves `set-active`, `delete` and
 *     `get-full-organization`; `findMany` serves the member page, and the
 *     organization inside `GET /organization/list` arrives through the
 *     factory's fallback join — itself another `findOne` on this model.
 *
 * ⛔ And the asymmetry, pinned in both directions: `create` / `update` must
 * still hand better-auth the stored STRING, because the vendor's own
 * organization adapter decodes those two echoes itself and discriminates on
 * the value still being a string (`typeof organization.metadata === 'string'`
 * on create, `parseJSON` on update). Decoding there would fold the create
 * echo's `metadata` to `undefined` — a regression that reads as "unset".
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataEngine } from '@objectstack/core';
import { SystemObjectName } from '@objectstack/spec/system';
import { organization } from 'better-auth/plugins/organization';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { decodeOrganizationMetadataOnRead } from './organization-metadata-decode.js';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';
import { buildOrganizationPluginSchema } from './auth-schema-config.js';

describe('decodeOrganizationMetadataOnRead', () => {
  it('decodes the stored JSON text into an object', () => {
    const row: Record<string, unknown> = { id: 'o', metadata: '{"plan":"pro"}' };
    decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, row);
    expect(row.metadata).toEqual({ plan: 'pro' });
  });

  it('OMITS the key for an unset column — absent, never null', () => {
    for (const unset of [null, undefined, '']) {
      const row: Record<string, unknown> = { id: 'o', metadata: unset };
      decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, row);
      expect('metadata' in row).toBe(false);
    }
    // `JSON.parse('null')` is a legal parse of an unset-looking value.
    const stored: Record<string, unknown> = { id: 'o', metadata: 'null' };
    decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, stored);
    expect('metadata' in stored).toBe(false);
  });

  it('leaves undecodable text EXACTLY as it is — never invents, never throws', () => {
    const row: Record<string, unknown> = { id: 'o', metadata: 'not json at all' };
    expect(() => decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, row)).not.toThrow();
    // Passing the value through is what makes the consumer's spec parse refuse
    // the body and name the field, instead of the read reporting "no metadata".
    expect(row.metadata).toBe('not json at all');
  });

  it('does not launder a JSON scalar or array into the declared record shape', () => {
    for (const text of ['42', '"pro"', 'true', '[1,2]']) {
      const row: Record<string, unknown> = { id: 'o', metadata: text };
      decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, row);
      expect(row.metadata).toBe(text);
    }
  });

  it('is a no-op for an already-decoded value, a missing key, and every other object', () => {
    const decoded: Record<string, unknown> = { id: 'o', metadata: { plan: 'pro' } };
    decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, decoded);
    expect(decoded.metadata).toEqual({ plan: 'pro' });

    const noKey: Record<string, unknown> = { id: 'o' };
    decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, noKey);
    expect(noKey).toEqual({ id: 'o' });

    // Another object's `metadata` column is not ours to reinterpret.
    const other: Record<string, unknown> = { id: 'x', metadata: '{"plan":"pro"}' };
    decodeOrganizationMetadataOnRead(SystemObjectName.USER, other);
    expect(other.metadata).toBe('{"plan":"pro"}');

    expect(() => decodeOrganizationMetadataOnRead(SystemObjectName.ORGANIZATION, null)).not.toThrow();
  });
});

describe('⭐ the four read routes serve the decoded object, through the real adapter factory', () => {
  const STORED_ROW = {
    id: 'org_01HQ',
    name: 'Acme',
    slug: 'acme',
    logo: null,
    created_at: '2026-09-07T09:27:01.545Z',
    updated_at: '2026-09-07T10:00:00.000Z',
    metadata: '{"plan":"pro"}',
  };

  const makeAdapter = (row: Record<string, unknown> | null = { ...STORED_ROW }) => {
    const engine = {
      insert: vi.fn().mockImplementation((_m: string, d: any) => Promise.resolve({ ...STORED_ROW, ...d })),
      findOne: vi.fn().mockResolvedValue(row ? { ...row } : null),
      find: vi.fn().mockResolvedValue(row ? [{ ...row }] : []),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockImplementation((_m: string, d: any, options?: any) => {
        // The real engine's three-way dispatch — a double looser than this is
        // no double at all (`check:engine-double-contract`).
        assertEngineUpdateDispatch(d, options);
        return Promise.resolve({ ...STORED_ROW, ...d });
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as IDataEngine;
    // The plugin must be mounted: better-auth's factory validates the model
    // against the merged schema before delegating, and `sys_organization` is
    // only a known model once the organization plugin's schema is in.
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({
      plugins: [organization({ schema: buildOrganizationPluginSchema() })],
    } as any);
    return { engine, adapter };
  };

  it('findOne (set-active · delete · get-full-organization) answers metadata as an object', async () => {
    const { engine, adapter } = makeAdapter();
    const found = await adapter.findOne({
      model: 'organization',
      where: [{ field: 'id', value: 'org_01HQ', operator: 'eq', connector: 'AND' }],
    });
    expect(engine.findOne).toHaveBeenCalledWith(SystemObjectName.ORGANIZATION, expect.anything());
    expect(found.metadata).toEqual({ plan: 'pro' });
  });

  it('findMany (the list join) answers metadata as an object on every row', async () => {
    const { adapter } = makeAdapter();
    const rows = await adapter.findMany({ model: 'organization', limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ plan: 'pro' });
  });

  it('⚠️ the vendor transform still drops updated_at — which is why the spec declares updatedAt optional', async () => {
    // Ruling C's fallback A, observed rather than recalled: the column IS in
    // the stored row above, and better-auth's `transformOutput` walks its own
    // declared fields only, so it never reaches the caller. Nothing in this
    // repo can put it on this wire without declaring it to the vendor.
    const { adapter } = makeAdapter();
    const found = await adapter.findOne({
      model: 'organization',
      where: [{ field: 'id', value: 'org_01HQ', operator: 'eq', connector: 'AND' }],
    });
    expect('updatedAt' in found).toBe(false);
    expect('updated_at' in found).toBe(false);
  });

  it('omits metadata entirely when the stored column is null', async () => {
    const { adapter } = makeAdapter({ ...STORED_ROW, metadata: null });
    const found = await adapter.findOne({
      model: 'organization',
      where: [{ field: 'id', value: 'org_01HQ', operator: 'eq', connector: 'AND' }],
    });
    expect(found.metadata).toBeUndefined();
  });

  it('⛔ leaves the create echo as the stored STRING — the vendor decodes that one itself', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create({
      model: 'organization',
      data: { name: 'Acme', slug: 'acme', metadata: '{"plan":"pro"}' },
    });
    // better-auth's `createOrganization` reads this back with
    // `typeof organization.metadata === 'string' ? JSON.parse(...) : void 0`.
    // Hand it an object and the echo's metadata becomes `undefined`.
    expect(created.metadata).toBe('{"plan":"pro"}');
  });

  it('⛔ leaves the update echo as the stored STRING — same reason (parseJSON)', async () => {
    const { adapter } = makeAdapter();
    const updated = await adapter.update({
      model: 'organization',
      where: [{ field: 'id', value: 'org_01HQ', operator: 'eq', connector: 'AND' }],
      update: { metadata: '{"plan":"enterprise"}' },
    });
    expect(updated.metadata).toBe('{"plan":"enterprise"}');
  });
});
