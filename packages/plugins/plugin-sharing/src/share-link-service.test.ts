// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ShareLinkService } from './share-link-service.js';

interface FakeRow { [k: string]: any }

function makeFakeEngine(schemas: Record<string, any>) {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (name: string) => (tables[name] ??= []);

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (row[k] !== v) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    getSchema(name: string) { return schemas[name]; },
    async find(object: string, options?: any) {
      const filter = options?.filter ?? options?.where;
      return ensure(object).filter(r => matches(r, filter));
    },
    async insert(object: string, data: any) {
      const row = { ...data };
      ensure(object).push(row);
      return row;
    },
    async update(object: string, idOrData: any, dataOrOptions?: any) {
      const data = typeof idOrData === 'object' ? idOrData : dataOrOptions;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete() { return { id: null }; },
  };
}

const SCHEMAS = {
  sys_share_link: { name: 'sys_share_link', fields: {} },
  // The opt-in target.
  ai_conversations: {
    name: 'ai_conversations',
    publicSharing: {
      enabled: true,
      allowedAudiences: ['link_only', 'signed_in'],
      allowedPermissions: ['view'],
      redactFields: ['metadata'],
      maxExpiryDays: 30,
    },
    fields: { id: {}, title: {}, metadata: {} },
  },
  // Sharing not enabled.
  sys_user: {
    name: 'sys_user',
    fields: { id: {}, email: {} },
  },
};

describe('ShareLinkService', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let service: ShareLinkService;

  beforeEach(() => {
    engine = makeFakeEngine(SCHEMAS);
    // Seed a real conversation row so existence checks pass.
    engine._tables.ai_conversations = [{ id: 'c1', title: 'Demo' }];
    service = new ShareLinkService({ engine: engine as any });
  });

  it('mints a link for an opt-in object', async () => {
    const link = await service.createLink(
      {
        object: 'ai_conversations',
        recordId: 'c1',
        audience: 'link_only',
        permission: 'view',
      },
      { userId: 'u1' },
    );
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(link.permission).toBe('view');
    expect(link.audience).toBe('link_only');
    expect(engine._tables.sys_share_link).toHaveLength(1);
  });

  it('rejects objects that did not opt in', async () => {
    await expect(
      service.createLink(
        { object: 'sys_user', recordId: 'u1', audience: 'link_only', permission: 'view' },
        { userId: 'u1' },
      ),
    ).rejects.toThrow(/sharing/i);
  });

  it('rejects a permission outside the allow-list', async () => {
    await expect(
      service.createLink(
        {
          object: 'ai_conversations',
          recordId: 'c1',
          audience: 'link_only',
          permission: 'edit',
        },
        { userId: 'u1' },
      ),
    ).rejects.toThrow(/permission/i);
  });

  it('resolves a freshly minted token', async () => {
    const link = await service.createLink(
      {
        object: 'ai_conversations',
        recordId: 'c1',
        audience: 'link_only',
        permission: 'view',
      },
      { userId: 'u1' },
    );
    const resolved = await service.resolveToken(link.token);
    expect(resolved).not.toBeNull();
    expect(resolved!.link.record_id).toBe('c1');
    expect(resolved!.redactFields).toContain('metadata');
  });

  it('returns null for an unknown token', async () => {
    expect(await service.resolveToken('nope-not-a-real-token-xyz')).toBeNull();
  });

  it('refuses to resolve a revoked token', async () => {
    const link = await service.createLink(
      {
        object: 'ai_conversations',
        recordId: 'c1',
        audience: 'link_only',
        permission: 'view',
      },
      { userId: 'u1' },
    );
    await service.revokeLink(link.id, { userId: 'u1' });
    expect(await service.resolveToken(link.token)).toBeNull();
  });

  it('refuses to resolve an expired token', async () => {
    // Bypass createLink (it refuses past dates) by inserting directly.
    const past = new Date(Date.now() - 60_000).toISOString();
    engine._tables.sys_share_link = [
      {
        id: 'shl_expired',
        token: 'expired-token-xyz-123',
        object_name: 'ai_conversations',
        record_id: 'c1',
        permission: 'view',
        audience: 'link_only',
        expires_at: past,
        revoked_at: null,
      },
    ];
    expect(await service.resolveToken('expired-token-xyz-123')).toBeNull();
  });
});
