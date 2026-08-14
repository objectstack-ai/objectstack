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
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
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

  // [#4346 follow-up] `listLinks` asked for "the 200 most recent links" with a
  // `sort` key. The ENGINE folds only `where`/`filter` and `limit`/`top`
  // (`RPC_QUERY_ALIAS_SLOTS`); `sort`→`orderBy` is folded at the RPC/wire layer,
  // which a direct `engine.find()` never crosses. So `sort` rode onto the AST
  // untouched, every driver's `Array.isArray(query.orderBy)` guard declined to
  // emit an ORDER BY, and the "most recent 200" was an ARBITRARY 200 — with a
  // perfectly ordinary-looking result over it (the #4226 failure mode, one
  // layer below the normalizer #4226 fixed).
  //
  // Asserted on the OPTION BAG rather than on row order, because the failure is
  // that the key never becomes `orderBy` — a fake engine that sorts by either
  // spelling would pass while the real one drops it.
  it('listLinks asks the engine for its ordering under the canonical key', async () => {
    const seen: any[] = [];
    const recording = {
      ...engine,
      async find(object: string, options?: any) { seen.push(options); return engine.find(object, options); },
    };
    const svc = new ShareLinkService({ engine: recording as any });
    await svc.listLinks({}, { isSystem: true });

    expect(seen).toHaveLength(1);
    expect(seen[0].orderBy, 'a `sort` key here is silently dropped by every driver')
      .toEqual([{ field: 'created_at', order: 'desc' }]);
    expect('sort' in seen[0], 'the deprecated spelling must not ride along').toBe(false);
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

  // ── [#5190] the record-existence gate ─────────────────────────────────────
  //
  // A share link is an identity-less CAPABILITY token: holding the URL IS the
  // authorisation. `resolveToken` checked the token, `revoked_at`, `expires_at`,
  // the audience and the password — and never whether the record it points at
  // still existed. Delete the record and the link kept resolving; reuse the
  // record id and the link starts authorising a brand-new record for whoever
  // kept the URL.
  //
  // This suite pins the FAIL-CLOSED half, which holds whether or not the delete
  // cascade (record-share-cascade.test.ts) ever ran.
  describe('a deleted record kills the link (#5190)', () => {
    /** Mint a link on the live `c1`, then make `c1` disappear. */
    async function mintThenDeleteRecord(): Promise<string> {
      const link = await service.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'u1' },
      );
      engine._tables.ai_conversations = [];
      return link.token;
    }

    it('THE REPRO — refuses to resolve once the shared record is deleted', async () => {
      const token = await mintThenDeleteRecord();
      expect(await service.resolveToken(token)).toBeNull();
    });

    /**
     * The response must not tell an unauthorised holder WHICH failure they hit:
     * "that record was deleted" is itself information they have no claim to,
     * and a distinct status would turn every leaked token into an existence
     * oracle over the object. Same branch, same `null`, no throw — a mutation
     * that raises a dedicated error (or returns a marker object) fails here even
     * though the link stops resolving.
     */
    it('is indistinguishable from revoked / expired / unknown — one `null`, never a throw', async () => {
      const attempt = async (token: string) => {
        try {
          return { threw: false, value: await service.resolveToken(token) };
        } catch (err) {
          return { threw: true, value: err };
        }
      };

      // The dead-record link points at `c2`, so removing it leaves `c1` alive
      // for the other three cases — every outcome below differs ONLY in why it
      // failed.
      engine._tables.ai_conversations.push({ id: 'c2', title: 'Second' });
      const deadRecord = await service.createLink(
        { object: 'ai_conversations', recordId: 'c2', audience: 'link_only', permission: 'view' },
        { userId: 'u1' },
      );
      engine._tables.ai_conversations = engine._tables.ai_conversations.filter((r) => r.id !== 'c2');
      const revoked = await service.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'u1' },
      );
      await service.revokeLink(revoked.id, { userId: 'u1' });
      engine._tables.sys_share_link.push({
        id: 'shl_expired',
        token: 'expired-token-xyz-123',
        object_name: 'ai_conversations',
        record_id: 'c1',
        permission: 'view',
        audience: 'link_only',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        revoked_at: null,
      });

      const outcomes = await Promise.all([
        attempt(deadRecord.token),
        attempt(revoked.token),
        attempt('expired-token-xyz-123'),
        attempt('nope-not-a-real-token-xyz'),
      ]);

      expect(outcomes).toEqual([
        { threw: false, value: null },
        { threw: false, value: null },
        { threw: false, value: null },
        { threw: false, value: null },
      ]);
    });

    /**
     * Follows from the gate sitting BEFORE the usage stamp, and pinned
     * separately because the ordering is what makes it true: a dead record must
     * not keep ticking `use_count` / `last_used_at`, which is both noise in the
     * Setup grid and a bad signal for anyone auditing a leaked link.
     */
    it('does not stamp use_count / last_used_at for a dead-record link', async () => {
      const token = await mintThenDeleteRecord();
      const row = () => engine._tables.sys_share_link[0];

      await service.resolveToken(token);

      expect(row().use_count).toBe(0);
      expect(row().last_used_at).toBeNull();

      // Control: the same link on a LIVE record still stamps, so the assertion
      // above is about the record's death, not about stamping being broken.
      engine._tables.ai_conversations = [{ id: 'c1', title: 'Demo' }];
      await service.resolveToken(token);
      expect(row().use_count).toBe(1);
      expect(row().last_used_at).not.toBeNull();
    });

    /**
     * "Could not ask" must not authorise. The orphan SWEEP fails the other way
     * (a failed probe deletes nothing) — both refuse to act on an unanswered
     * question; only the safe direction differs, because one grants access and
     * the other destroys rows.
     */
    it('fails CLOSED when the existence probe throws', async () => {
      const token = await mintThenDeleteRecord();
      engine._tables.ai_conversations = [{ id: 'c1', title: 'Demo' }];
      const broken = {
        ...engine,
        async find(object: string, options?: any) {
          if (object === 'ai_conversations') throw new Error('driver down');
          return engine.find(object, options);
        },
      };
      const svc = new ShareLinkService({ engine: broken as any });

      expect(await svc.resolveToken(token)).toBeNull();
    });

    it('a link on a record that never existed is refused even when nothing else objects', async () => {
      // Minted by a SYSTEM caller (which may mint on any object), then the row
      // outlives its record — the path no `publicSharing` opt-in guards.
      engine._tables.sys_share_link = [{
        id: 'shl_ghost',
        token: 'ghost-token-abcdefgh',
        object_name: 'ai_conversations',
        record_id: 'never_existed',
        permission: 'view',
        audience: 'link_only',
        expires_at: null,
        revoked_at: null,
        use_count: 0,
        last_used_at: null,
      }];

      expect(await service.resolveToken('ghost-token-abcdefgh')).toBeNull();
    });

    it('costs no existence query on a link the cheap gates already rejected', async () => {
      const probed: string[] = [];
      const recording = {
        ...engine,
        async find(object: string, options?: any) { probed.push(object); return engine.find(object, options); },
      };
      const svc = new ShareLinkService({ engine: recording as any });
      const link = await svc.createLink(
        { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
        { userId: 'u1' },
      );
      await svc.revokeLink(link.id, { userId: 'u1' });
      probed.length = 0;

      expect(await svc.resolveToken(link.token)).toBeNull();

      // Only the token lookup — a revoked link never pays for the record probe.
      expect(probed).toEqual(['sys_share_link']);
    });
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
