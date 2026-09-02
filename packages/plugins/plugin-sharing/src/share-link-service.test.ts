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

// ── [#13856] declared `redactFields` survive the object opting OUT ──────────
//
// `getPolicy()` used to collapse to an EMPTY policy whenever
// `publicSharing.enabled !== true` — `redactFields: []` included. So a link
// minted while the object was opted IN, redeemed after it was opted OUT, kept
// resolving and started serving MORE fields than it did while the feature was
// on: turning the switch OFF widened what the anonymous endpoint serves.
// Fail-open, and wrong under either answer to the standing-policy question:
// the declared redaction set is now read from the declared block regardless
// of `enabled`, so opting out can never widen what an existing token serves.
//
// ## [#14033] REVERSAL REGISTER — the resolve-side readings below moved
//
// This block was written while the standing-policy question was pending, and
// said so: it took "the link still resolves with the switch off" as a GIVEN
// and pinned only the redaction set served when it did. That question has
// since been ruled. Maintainer ruling of 2026-09-01, recorded on #14033 by the
// director seat (「其他同意」 on the four-point recommendation), verbatim and
// untranslated:
//
// > 1. **A**:`publicSharing.enabled` 为持续策略,`resolveToken()` 每次兑付重查;关掉 ⇒ 存量链接停止兑付。
// > 2. **追溯即时生效**(沿 #13608 先例):部署一落地,禁用块上的所有既有 token 即停止解析。changeset 必须标注 breaking runtime change,与 #13857 同型。
// > 3. **系统/宽容旁路铸造的链接同样受管**:兑付是匿名动作,不因铸造方式豁免 —— `enabled` 关则一律拒付(含 system-context.mdx ledger row 37 的旁路铸造路径)。
// > 4. **兄弟键统一律入册**:`enabled` 关 ⇒ 整块不生效 ⇒ 拒付(子键求值 moot);`enabled` 开 ⇒ 块内各策略键按持续策略在兑付期求值(`eligibility` 已然,`redactFields` 由 #13856 修复)。后续兄弟键⛔ 不再单独立卡。
//
// So every pin here that asserted "resolves with the switch off" is REVERSED
// in place — kept, renamed, its docblock naming what it pinned and which
// ruling point moved it — never deleted. The block's own guarantee (opting
// out never WIDENS what an existing token serves) still holds, now trivially:
// with the switch off nothing is served at all (point 4: 子键求值 moot). The
// `redactFields` read in `getPolicy`'s disabled branch is deliberately left as
// #13856 landed it (not this card's to redo); the `enabled: true` control and
// the mint-time gate are untouched and stay pinned exactly as before.

/**
 * An opt-in object whose schema object is LOCAL to the test, so `enabled` can
 * be flipped. Shared by the #13856 block and the #14033 block below — the
 * second is the ruling the first deferred to.
 */
function makeOptOutHarness() {
  const schemas: Record<string, any> = {
    sys_share_link: { name: 'sys_share_link', fields: {} },
    articles: {
      name: 'articles',
      publicSharing: { enabled: true, redactFields: ['owner_id', 'cost'] },
      fields: { id: {}, title: {}, body: {}, owner_id: {}, cost: {} },
    },
    // Reverse control: never declared a publicSharing block at all.
    plain_notes: { name: 'plain_notes', fields: { id: {}, text: {}, secret: {} } },
  };
  const engine = makeFakeEngine(schemas);
  engine._tables.articles = [{ id: 'a1', title: 'T', body: 'B', owner_id: 'u9', cost: 42 }];
  engine._tables.plain_notes = [{ id: 'n1', text: 'hi', secret: 's3' }];
  const service = new ShareLinkService({ engine: engine as any });
  return { schemas, engine, service };
}

/** Seed a pre-existing link directly (mint refuses for these paths — that gate is pinned below). */
function seedLink(engine: any, row: Record<string, any>) {
  engine._tables.sys_share_link = [{
    id: 'shl_seeded',
    permission: 'view',
    audience: 'link_only',
    expires_at: null,
    email_allowlist: null,
    password_hash: null,
    redact_fields: null,
    revoked_at: null,
    use_count: 0,
    ...row,
  }];
}

describe('[#13856] declared redactFields survive publicSharing opt-out', () => {
  /**
   * REVERSED by #14033 (ruling points 1 and 4, quoted in the register above).
   *
   * What it pinned: with the switch turned OFF the same token still resolved,
   * the declared redactions were still applied, and the field set served OFF
   * was a subset of the set served ON. What reversed it: `enabled` is a
   * standing policy — with the switch off the link does not resolve at all,
   * so there is no served set to compare and the redaction reading is moot.
   * The ON half of the original reading is kept: it is the control that the
   * switch, not the harness, is what changed the answer.
   */
  it('REVERSED by #14033 — opting out no longer serves the link at all (it used to, redactions applied)', async () => {
    const { schemas, service } = makeOptOutHarness();
    const link = await service.createLink(
      { object: 'articles', recordId: 'a1', audience: 'link_only', permission: 'view', redactFields: ['body'] },
      { userId: 'u1' },
    );

    const on = await service.resolveToken(link.token);
    expect(on).not.toBeNull();
    expect(on!.redactFields).toContain('owner_id');
    expect(on!.redactFields).toContain('cost');

    schemas.articles.publicSharing.enabled = false;

    // Formerly `expect(off).not.toBeNull()` — "today's behaviour, under ruling
    // in #14033 — a given here, not a pin". The ruling landed: point 1.
    const off = await service.resolveToken(link.token);
    expect(off).toBeNull();

    // The block's guarantee, restated under the ruling: the set served with
    // the switch OFF (nothing) is a subset of the set served with it ON.
    const allFields = Object.keys(schemas.articles.fields);
    const servedOn = allFields.filter((f) => !on!.redactFields.includes(f));
    const servedOff: string[] = off === null ? [] : allFields.filter((f) => !off.redactFields.includes(f));
    expect(
      servedOff.filter((f) => !servedOn.includes(f)),
      'fields served ONLY after opting out — must be none',
    ).toEqual([]);
  });

  /**
   * REVERSED by #14033 (ruling point 4, quoted in the register above).
   *
   * What it pinned: with the switch OFF the resolved link carried exactly
   * declared ∪ per-link redactions. What reversed it: with the switch off
   * nothing inside the block is evaluated and nothing is served — there is no
   * resolved link to carry a union. The union itself is still pinned on the
   * `enabled: true` path by the control directly below.
   */
  it('REVERSED by #14033 — boundary: with the switch off there is no resolved link to carry the union', async () => {
    const { schemas, service } = makeOptOutHarness();
    const link = await service.createLink(
      { object: 'articles', recordId: 'a1', audience: 'link_only', permission: 'view', redactFields: ['body'] },
      { userId: 'u1' },
    );
    schemas.articles.publicSharing.enabled = false;

    // Formerly: `expect(off).not.toBeNull()` and a union of ['owner_id', 'cost', 'body'].
    expect(await service.resolveToken(link.token)).toBeNull();
  });

  it('control — the enabled:true path serves exactly declared ∪ per-link, as before', async () => {
    const { service } = makeOptOutHarness();
    const link = await service.createLink(
      { object: 'articles', recordId: 'a1', audience: 'link_only', permission: 'view', redactFields: ['body'] },
      { userId: 'u1' },
    );
    const on = await service.resolveToken(link.token);
    expect(on).not.toBeNull();
    expect(new Set(on!.redactFields)).toEqual(new Set(['owner_id', 'cost', 'body']));
  });

  /**
   * REVERSED by #14033 (ruling point 3, quoted in the register above).
   *
   * What it pinned: a seeded link on an object with NO `publicSharing` block
   * resolved, and sprouted no redaction set. What reversed it: a block that
   * was never declared is `enabled !== true` — the same switch, at its
   * default — and a link on such an object can only have been minted through
   * the system / `permissive` bypass, which point 3 puts under the switch like
   * every other link. It no longer resolves, so it serves no set to inspect.
   */
  it('REVERSED by #14033 — reverse control: a block-less object is switched off, its seeded link refuses', async () => {
    const { engine, service } = makeOptOutHarness();
    seedLink(engine, {
      token: 'noblock-token-1234567890',
      object_name: 'plain_notes',
      record_id: 'n1',
    });
    // Formerly: resolved, with `redactFields` equal to `[]`.
    expect(await service.resolveToken('noblock-token-1234567890')).toBeNull();
  });

  /**
   * REVERSED by #14033 (ruling point 3, quoted in the register above).
   *
   * What it pinned: on a block-less object the per-link `redact_fields` were
   * served alone. What reversed it: the same as the pin above — the object is
   * switched off, the link refuses, and the per-link set is never reached.
   */
  it('REVERSED by #14033 — reverse control: per-link redactions on a block-less object are never reached', async () => {
    const { engine, service } = makeOptOutHarness();
    seedLink(engine, {
      token: 'noblock-token-0987654321',
      object_name: 'plain_notes',
      record_id: 'n1',
      redact_fields: ['secret'],
    });
    // Formerly: resolved, with `redactFields` equal to `['secret']`.
    expect(await service.resolveToken('noblock-token-0987654321')).toBeNull();
  });

  // The rejection assertion, per the ADR-0112 envelope: `code` AND `status` —
  // a bare `.toThrow()` could pass on a refusal for the wrong reason entirely.
  it('the mint-time opt-in gate is untouched — enabled:false still refuses SHARING_NOT_ENABLED', async () => {
    const { schemas, service } = makeOptOutHarness();
    schemas.articles.publicSharing.enabled = false;
    let caught: any;
    try {
      await service.createLink(
        { object: 'articles', recordId: 'a1', audience: 'link_only', permission: 'view' },
        { userId: 'u1' },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught, 'expected a refusal, but the mint resolved').toBeDefined();
    expect(caught.status).toBe(422);
    expect(caught.code).toBe('SHARING_NOT_ENABLED');
  });
});

// ── [#14033] `publicSharing.enabled` is a STANDING policy, held again at REDEMPTION ──
//
// ## The defect
//
// `getPolicy()` returned an empty policy (`enabled: false`) when the object's
// `publicSharing` block was absent or `enabled !== true`, and nothing in
// `resolveToken()` read `policy.enabled` — the opt-in was checked at MINT only
// (`createLink` → 422 `SHARING_NOT_ENABLED`). So the platform held this shape:
// the predicate INSIDE the block (`eligibility`, #13608) was re-evaluated on
// every redemption, while turning the WHOLE block off did not stop a single
// link already handed out. An author who wanted anonymous serving to stop had
// to narrow the predicate rather than switch the feature off. Measured before
// it was changed (the card's own instruction): the first pin below was red
// against the unmodified service — the token kept serving.
//
// ## The ruling
//
// Quoted verbatim in the reversal register above. In one line each: (1) the
// switch is a standing policy, re-read at every redemption; (2) retroactive on
// deploy, as #13608 was; (3) how a link was minted — system context, the
// `permissive` bypass, ledger row 37 — buys it nothing at redemption; (4)
// switch OFF ⇒ nothing inside the block is evaluated; switch ON ⇒ the sibling
// keys keep their redemption-time behaviour.
//
// ## What is measured, not assumed
//
// "Refused" is measured three ways on the same call: the answer is the
// undifferentiated `null` a revoked / expired / unknown token gets; the only
// read the service issued was the token lookup (no record probe — read off a
// recording engine); and the usage counters did not move. The HTTP-seam
// shape, the server-side log line and the real-driver readings live beside
// the #13608 pins in `share-link-eligibility.test.ts`.
describe('[#14033] publicSharing.enabled is a standing policy — held again at redemption', () => {
  /** Every `find` the service issues, so "no record read" is a measurement rather than an assumption. */
  function recordingService(engine: any, opts: Record<string, unknown> = {}) {
    const findCalls: Array<{ object: string; query: any }> = [];
    const recording = {
      ...engine,
      async find(object: string, query?: any) {
        findCalls.push({ object, query });
        return engine.find(object, query);
      },
    };
    const service = new ShareLinkService({ engine: recording as any, ...opts });
    return { service, findCalls };
  }

  /** The row as the table holds it now — usage counters included. */
  function linkRow(engine: any, id: string): any {
    return engine._tables.sys_share_link.find((r: any) => r.id === id);
  }

  const MINT = { object: 'articles', recordId: 'a1', audience: 'link_only', permission: 'view' } as const;

  it('THE REPRO — minted while enabled, the SAME token stops resolving the moment the block is turned off', async () => {
    const { schemas, engine } = makeOptOutHarness();
    const { service, findCalls } = recordingService(engine);
    const link = await service.createLink({ ...MINT }, { userId: 'u1' });

    // Control: serving while the switch is on.
    expect(await service.resolveToken(link.token)).not.toBeNull();
    const before = { ...linkRow(engine, link.id) };

    schemas.articles.publicSharing.enabled = false;
    findCalls.length = 0;

    // Pre-ruling this served the record in full to an anonymous caller.
    expect(await service.resolveToken(link.token)).toBeNull();

    // Refused BEFORE the record probe: the only read was the token lookup.
    expect(findCalls.map((c) => c.object)).toEqual(['sys_share_link']);
    // …and BEFORE the usage stamp: the counters are exactly what they were.
    const after = linkRow(engine, link.id);
    expect(after.use_count).toBe(before.use_count);
    expect(after.last_used_at).toBe(before.last_used_at);
  });

  it('a standing policy, not a revocation — turning the block back ON restores the SAME token', async () => {
    const { schemas, engine } = makeOptOutHarness();
    const { service } = recordingService(engine);
    const link = await service.createLink({ ...MINT }, { userId: 'u1' });

    schemas.articles.publicSharing.enabled = false;
    expect(await service.resolveToken(link.token)).toBeNull();

    schemas.articles.publicSharing.enabled = true;
    const restored = await service.resolveToken(link.token);
    expect(restored).not.toBeNull();
    expect(restored!.link.id).toBe(link.id);
    // The block is in force again, so its sibling keys are too (point 4).
    expect(restored!.redactFields).toEqual(expect.arrayContaining(['owner_id', 'cost']));
    // Exactly one successful resolution was stamped — the refused one was not.
    expect(linkRow(engine, link.id).use_count).toBe(1);
  });

  it('the refusal is the identical `null` a revoked / unknown token gets — never a code an anonymous caller could read', async () => {
    const { schemas, engine } = makeOptOutHarness();
    const { service } = recordingService(engine);
    const live = await service.createLink({ ...MINT }, { userId: 'u1' });
    const revoked = await service.createLink({ ...MINT }, { userId: 'u1' });
    await service.revokeLink(revoked.id, { userId: 'u1' });

    schemas.articles.publicSharing.enabled = false;

    // `resolves` — the switched-off arm RETURNS; a thrown `SHARING_NOT_ENABLED`
    // here would hand the route a 422 naming the policy to an anonymous caller.
    await expect(service.resolveToken(live.token)).resolves.toBeNull();

    const answers = {
      switchedOff: await service.resolveToken(live.token),
      revoked: await service.resolveToken(revoked.token),
      unknown: await service.resolveToken('zzzzzzzzzzzzzzzzzzzzzz'),
    };
    for (const [name, answer] of Object.entries(answers)) {
      expect(answer, `${name} must answer with the shared refusal`).toBeNull();
    }
    expect(Object.values(answers).every((a) => a === answers.revoked)).toBe(true);
  });

  describe('ruling point 3 — how a link was MINTED buys it nothing at redemption', () => {
    it('minted through the `permissive` bypass on a block that is OFF: refused, no record read, no usage stamp', async () => {
      const { schemas, engine } = makeOptOutHarness();
      schemas.articles.publicSharing.enabled = false;
      const { service, findCalls } = recordingService(engine, { permissive: true });

      // The bypass MINTS — ledger row 37's path, and the ruling leaves it so …
      const link = await service.createLink({ ...MINT }, { userId: 'u1' });
      expect(link.token).toBeTruthy();
      findCalls.length = 0;

      // … and redemption refuses the result exactly like an orphaned link.
      expect(await service.resolveToken(link.token)).toBeNull();
      expect(findCalls.map((c) => c.object)).toEqual(['sys_share_link']);
      const row = linkRow(engine, link.id);
      expect(row.use_count).toBe(0);
      expect(row.last_used_at).toBeNull();
    });

    it('minted under a SYSTEM context on a block that is OFF: refused all the same', async () => {
      const { schemas, engine } = makeOptOutHarness();
      schemas.articles.publicSharing.enabled = false;
      const { service } = recordingService(engine);

      const link = await service.createLink(
        { ...MINT },
        { isSystem: true, positions: [], permissions: [] } as any,
      );
      expect(link.token).toBeTruthy();

      expect(await service.resolveToken(link.token)).toBeNull();
    });

    it('a block that was never declared is `enabled !== true` too — a seeded link on it refuses without a record read', async () => {
      const { engine } = makeOptOutHarness();
      seedLink(engine, { token: 'noblock-token-1234567890', object_name: 'plain_notes', record_id: 'n1' });
      const { service, findCalls } = recordingService(engine);

      expect(await service.resolveToken('noblock-token-1234567890')).toBeNull();
      expect(findCalls.map((c) => c.object)).toEqual(['sys_share_link']);
    });
  });
});

// [#12981, batch 9] The `use_count` / `last_used_at` stamp at the end of
// `resolveToken` used to be swallowed by an empty `catch` ("usage telemetry is
// a nice-to-have"). It is a durability site: `sys_share_link` DECLARES both
// counters as written by `resolveToken`, and the shipped `active_links` grid
// asserts them — so a refused stamp left an admin grid asserting a number the
// system's own declaration defines, wrongly, with no signal. The repair reports
// the refusal through the service's existing `{ info?, warn, error? }` sink at
// `error` (falling back to the guaranteed `warn`), ONCE per instance, and
// leaves the resolution itself untouched.
describe('[#12981] a refused usage stamp is reported ONCE as a durability degradation', () => {
  /** A sink that records every call, per level, so counts are exact. */
  function makeSink() {
    const calls = { error: [] as any[][], warn: [] as any[][], info: [] as any[][] };
    return {
      calls,
      logger: {
        info: (...a: any[]) => { calls.info.push(a); },
        warn: (...a: any[]) => { calls.warn.push(a); },
        error: (...a: any[]) => { calls.error.push(a); },
      },
    };
  }

  /**
   * An engine whose `sys_share_link` UPDATE is refused with `err` for as long
   * as `refusing.on` is true — every other operation (find / insert / the
   * record probe) is the plain fake, so the ONLY thing that fails is the stamp.
   */
  function makeRefusingEngine(err: unknown) {
    const base = makeFakeEngine(SCHEMAS);
    base._tables.ai_conversations = [{ id: 'c1', title: 'Demo' }];
    const refusing = { on: true };
    const engine = {
      ...base,
      async update(object: string, idOrData: any, dataOrOptions?: any) {
        if (refusing.on && object === 'sys_share_link') throw err;
        return base.update(object, idOrData, dataOrOptions);
      },
    };
    return { base, engine, refusing };
  }

  async function mint(service: ShareLinkService) {
    return service.createLink(
      { object: 'ai_conversations', recordId: 'c1', audience: 'link_only', permission: 'view' },
      { userId: 'u1' },
    );
  }

  const REFUSAL = Object.assign(new Error('SQLITE_READONLY: attempt to write a readonly database'), {
    code: 'STORAGE_REFUSED',
  });

  it('positive — the link still resolves, and the refusal is reported at error naming both counters', async () => {
    const { engine, base } = makeRefusingEngine(REFUSAL);
    const sink = makeSink();
    const service = new ShareLinkService({ engine: engine as any, logger: sink.logger });
    const link = await mint(service);

    const resolved = await service.resolveToken(link.token);

    // The resolution is UNCHANGED by the refusal: the holder is served.
    expect(resolved).not.toBeNull();
    expect(resolved!.link.id).toBe(link.id);
    expect(resolved!.redactFields).toEqual(['metadata']);
    // ...and the counters genuinely did not move — the thing being reported.
    expect(base._tables.sys_share_link[0].use_count).toBe(0);
    expect(base._tables.sys_share_link[0].last_used_at).toBeNull();

    // The report: exactly one, at `error`, not degraded to `warn` while
    // `error` is available. Consequence and fix in the one line, plus the
    // cause, per AGENTS.md → "Degradation log levels".
    expect(sink.calls.error).toHaveLength(1);
    expect(sink.calls.warn).toHaveLength(0);
    expect(sink.calls.info).toHaveLength(0);
    const [message, meta] = sink.calls.error[0];
    expect(message).toContain('use_count');
    expect(message).toContain('last_used_at');
    expect(message).toContain('sys_share_link');
    expect(message).toContain('active_links');
    expect(message).toContain('Fix:');
    expect(message).toContain('SQLITE_READONLY: attempt to write a readonly database');
    expect(meta).toMatchObject({
      link: link.id,
      object: 'ai_conversations',
      record: 'c1',
      reason: 'STORAGE_REFUSED',
    });
  });

  // ⭐ The "say it ONCE" pin. `resolveToken` runs on every public request, so a
  // line per refused stamp is the flood the rule forbids. N = 5 ≥ 3.
  it('say it ONCE — five consecutive refused stamps produce exactly one report', async () => {
    const { engine } = makeRefusingEngine(REFUSAL);
    const sink = makeSink();
    const service = new ShareLinkService({ engine: engine as any, logger: sink.logger });
    const link = await mint(service);

    for (let i = 0; i < 5; i++) {
      // Every resolution still serves — the degradation never leaks to the holder.
      expect(await service.resolveToken(link.token), `resolution #${i + 1}`).not.toBeNull();
    }

    expect(sink.calls.error).toHaveLength(1);
    expect(sink.calls.warn).toHaveLength(0);
    expect(sink.calls.error[0][0]).toContain('Reported ONCE');
  });

  // Reverse control. Without it, "once" and "never" are indistinguishable: a
  // reporter that never fires also passes the pin above only through the
  // positive test, so the control pins the OTHER direction — a stamp that
  // lands produces nothing at any level.
  it('reverse control — five stamps that LAND produce zero output at every level', async () => {
    const { engine, refusing, base } = makeRefusingEngine(REFUSAL);
    refusing.on = false;
    const sink = makeSink();
    const service = new ShareLinkService({ engine: engine as any, logger: sink.logger });
    const link = await mint(service);

    for (let i = 0; i < 5; i++) {
      expect(await service.resolveToken(link.token)).not.toBeNull();
    }

    expect(sink.calls.error).toHaveLength(0);
    expect(sink.calls.warn).toHaveLength(0);
    expect(sink.calls.info).toHaveLength(0);
    // Invariance of the success path: the declared semantics hold verbatim —
    // `use_count` "incremented on every successful resolution", `last_used_at` stamped.
    expect(base._tables.sys_share_link[0].use_count).toBe(5);
    expect(typeof base._tables.sys_share_link[0].last_used_at).toBe('string');
    expect(Number.isNaN(Date.parse(base._tables.sys_share_link[0].last_used_at))).toBe(false);
  });

  // "At the FIRST degradation" is not "on the first call": storage that starts
  // refusing after a healthy run is reported at the moment it turns, once.
  it('the first degradation after healthy stamps is reported, once, and later refusals stay silent', async () => {
    const { engine, refusing, base } = makeRefusingEngine(REFUSAL);
    refusing.on = false;
    const sink = makeSink();
    const service = new ShareLinkService({ engine: engine as any, logger: sink.logger });
    const link = await mint(service);

    await service.resolveToken(link.token);
    await service.resolveToken(link.token);
    expect(sink.calls.error).toHaveLength(0);
    expect(base._tables.sys_share_link[0].use_count).toBe(2);

    refusing.on = true;
    for (let i = 0; i < 3; i++) expect(await service.resolveToken(link.token)).not.toBeNull();

    expect(sink.calls.error).toHaveLength(1);
    expect(sink.calls.warn).toHaveLength(0);
    // The counters froze at the last landed value — exactly the drift the line reports.
    expect(base._tables.sys_share_link[0].use_count).toBe(2);
  });

  // The sink's `error` is optional by contract (#9754: hosts inject reduced
  // sinks); `warn` is the guaranteed channel. A `{ warn }`-only host must still
  // hear the report — a conditional `error?.(…)` call would have emitted nothing.
  it('falls back to the guaranteed warn channel when the host sink declares no error', async () => {
    const { engine } = makeRefusingEngine(REFUSAL);
    const warns: any[][] = [];
    const service = new ShareLinkService({
      engine: engine as any,
      logger: { warn: (...a: any[]) => { warns.push(a); } },
    });
    const link = await mint(service);

    for (let i = 0; i < 3; i++) expect(await service.resolveToken(link.token)).not.toBeNull();

    expect(warns).toHaveLength(1);
    expect(warns[0][0]).toContain('use_count');
    expect(warns[0][1]).toMatchObject({ link: link.id, reason: 'STORAGE_REFUSED' });
  });

  it('a host with no logger at all is served exactly as before — the resolution never throws', async () => {
    const { engine } = makeRefusingEngine(REFUSAL);
    const service = new ShareLinkService({ engine: engine as any });
    const link = await mint(service);
    await expect(service.resolveToken(link.token)).resolves.not.toBeNull();
  });
});
