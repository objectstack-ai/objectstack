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

  // ── [Finding-2] verified-authz enforcement ────────────────────────────────
  describe('authorization (Finding-2)', () => {
    it('only the creator may revoke a link (a different user is denied)', async () => {
      const link = await service.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'owner' },
      );
      // A different signed-in user cannot revoke someone else's link.
      await expect(service.revokeLink(link.id, { userId: 'attacker' })).rejects.toMatchObject({ status: 403 });
      // The row is untouched.
      expect(engine._tables.sys_share_link[0].revoked_at).toBeNull();
      // The creator can.
      await expect(service.revokeLink(link.id, { userId: 'owner' })).resolves.toBeUndefined();
      expect(engine._tables.sys_share_link[0].revoked_at).not.toBeNull();
    });

    it('a system/internal caller may revoke any link', async () => {
      const link = await service.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'owner' },
      );
      await expect(service.revokeLink(link.id, { isSystem: true })).resolves.toBeUndefined();
      expect(engine._tables.sys_share_link[0].revoked_at).not.toBeNull();
    });

    // [ADR-0111 D8] A record's share-manager (owner / Modify All) may revoke a
    // link someone ELSE minted on their record — the manage probe is consulted
    // when the caller is neither the creator nor system.
    it('a record share-manager may revoke a link another user minted', async () => {
      const seen: Array<[string, string, string]> = [];
      const svc = new ShareLinkService({
        engine: engine as any,
        canManageShares: async (object, recordId, ctx: any) => {
          seen.push([object, recordId, ctx.userId]);
          return ctx.userId === 'manager'; // manager can manage c1; nobody else
        },
      });
      const link = await svc.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'creator' },
      );
      // A bystander who cannot manage the record is still denied.
      await expect(svc.revokeLink(link.id, { userId: 'bystander' })).rejects.toMatchObject({ status: 403 });
      expect(engine._tables.sys_share_link[0].revoked_at).toBeNull();
      // The record's manager can, though they did not create the link.
      await expect(svc.revokeLink(link.id, { userId: 'manager' })).resolves.toBeUndefined();
      expect(engine._tables.sys_share_link[0].revoked_at).not.toBeNull();
      // The probe was asked about the LINK's (object, record), not anything else.
      expect(seen).toContainEqual(['ai_conversations', 'c1', 'manager']);
    });

    it('without a manage probe (pre-D8 / probe-less deployment), only creator and system revoke', async () => {
      // Default service has no canManageShares — a non-creator is denied even
      // if they would be a manager, because the deployment cannot ask.
      const link = await service.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'creator' },
      );
      await expect(service.revokeLink(link.id, { userId: 'someone_else' })).rejects.toMatchObject({ status: 403 });
    });

    it('a throwing manage probe fails CLOSED (denies a non-creator)', async () => {
      const svc = new ShareLinkService({
        engine: engine as any,
        canManageShares: async () => { throw new Error('probe down'); },
      });
      const link = await svc.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'creator' },
      );
      await expect(svc.revokeLink(link.id, { userId: 'bystander' })).rejects.toMatchObject({ status: 403 });
    });

    it('an HTTP caller cannot mint a link for a record it cannot see (403, not 404)', async () => {
      // The record-access re-read runs under the caller context; a record the
      // caller cannot see (here: does not exist) yields a fail-closed 403 for an
      // untrusted caller — never a link, and without leaking existence.
      await expect(
        service.createLink(
          { object: 'ai_conversations', recordId: 'ghost', audience: 'link_only', permission: 'view' },
          { userId: 'u1' },
        ),
      ).rejects.toMatchObject({ status: 403 });
      // A system caller still gets the plain 404.
      await expect(
        service.createLink(
          { object: 'ai_conversations', recordId: 'ghost', audience: 'link_only', permission: 'view' },
          { isSystem: true },
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
