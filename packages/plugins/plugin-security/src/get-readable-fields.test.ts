// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * getReadableFields query surface (#3547) — the authoritative column
 * projection for a read-derived export (`export ⊆ list`, #3391). It must
 * return exactly the fields the read middleware's FieldMasker would NOT delete
 * for the caller, computed from the object SCHEMA + context (never from data
 * rows) so it is immune to null values / empty result sets.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';

/**
 * Minimal plugin harness: a metadata `list()` that surfaces the permission
 * sets, `get()`/`ql.getSchema()` that surface the object schema. Mirrors the
 * shape used by security-plugin.test.ts so the plugin boots identically.
 */
function bootPlugin(permissionSets: PermissionSet[], objectFields: string[], fallback = 'restricted') {
  const fields: Record<string, any> = {};
  for (const f of objectFields) fields[f] = { name: f };
  const schema: any = { name: 'deal', label: 'Deal', systemFields: false, fields };
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: (name: string) => (name === 'deal' ? schema : null),
    findOne: async () => null,
  };
  const metadata: any = {
    get: async (_type: string, name: string) => (name === 'deal' ? schema : null),
    list: async () => permissionSets,
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: fallback });
  return { plugin, ctx };
}

// A permission set that reads `deal` but masks the `secret` field.
const RESTRICTED: PermissionSet = {
  name: 'restricted',
  label: 'Restricted',
  objects: { deal: { allowRead: true } },
  fields: { 'deal.secret': { readable: false, editable: false } },
} as any;

// A permission set with no field-level rules → every field readable.
const OPEN: PermissionSet = {
  name: 'open',
  label: 'Open',
  objects: { deal: { allowRead: true } },
} as any;

describe('SecurityPlugin.getReadableFields (#3547)', () => {
  it('returns all schema fields MINUS those masked non-readable — the FieldMasker complement', async () => {
    const { plugin, ctx } = bootPlugin([RESTRICTED], ['id', 'name', 'secret']);
    await plugin.init(ctx);
    await plugin.start(ctx);

    const readable = await plugin.getReadableFields('deal', { userId: 'u1', permissions: ['restricted'] });
    expect(readable).toBeDefined();
    expect(readable).toContain('id');
    expect(readable).toContain('name');
    // `secret` is masked (readable:false) → excluded, exactly as maskResults deletes it.
    expect(readable).not.toContain('secret');
  });

  it('a field with no permission entry passes through (allow-list only enumerates named fields)', async () => {
    // `open` names no fields → nothing is masked → all schema fields readable.
    const { plugin, ctx } = bootPlugin([OPEN], ['id', 'name', 'secret'], 'open');
    await plugin.init(ctx);
    await plugin.start(ctx);

    const readable = await plugin.getReadableFields('deal', { userId: 'u1', permissions: ['open'] });
    expect(new Set(readable)).toEqual(new Set(['id', 'name', 'secret']));
  });

  it('a system context bypasses FLS → the full field set (mirrors the middleware isSystem skip)', async () => {
    const { plugin, ctx } = bootPlugin([RESTRICTED], ['id', 'name', 'secret']);
    await plugin.init(ctx);
    await plugin.start(ctx);

    const readable = await plugin.getReadableFields('deal', { isSystem: true });
    expect(new Set(readable)).toEqual(new Set(['id', 'name', 'secret']));
  });

  it('returns undefined when the object schema cannot be resolved (caller falls back)', async () => {
    const { plugin, ctx } = bootPlugin([RESTRICTED], ['id', 'name', 'secret']);
    await plugin.init(ctx);
    await plugin.start(ctx);

    const readable = await plugin.getReadableFields('unknown_object', { userId: 'u1', permissions: ['restricted'] });
    expect(readable).toBeUndefined();
  });

  it('is computed from the schema, not from data rows — immune to null/empty result sets', async () => {
    // No data rows exist in this harness at all (ql.findOne → null); the
    // readable set is still complete, proving it is derived from schema+context.
    const { plugin, ctx } = bootPlugin([RESTRICTED], ['id', 'name', 'secret', 'amount']);
    await plugin.init(ctx);
    await plugin.start(ctx);

    const readable = await plugin.getReadableFields('deal', { userId: 'u1', permissions: ['restricted'] });
    // `amount` is readable and would be entirely absent from an empty result —
    // it survives here because the projection never consults rows.
    expect(readable).toContain('amount');
    expect(readable).not.toContain('secret');
  });
});
