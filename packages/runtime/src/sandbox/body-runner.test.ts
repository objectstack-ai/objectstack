// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { hookBodyRunnerFactory, actionBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

describe('hookBodyRunnerFactory', () => {
  const runner = new QuickJSScriptRunner();

  it('returns undefined when hook has no body', () => {
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'a' });
    expect(factory({ name: 'h', object: 'x', events: [], handler: () => {} } as any)).toBeUndefined();
  });

  it('returns undefined when body shape is invalid', () => {
    const warnings: any[] = [];
    const factory = hookBodyRunnerFactory(runner, {
      ql: {},
      appId: 'a',
      logger: { warn: (msg: string, m: any) => warnings.push({ msg, m }) },
    });
    const fn = factory({
      name: 'bad',
      events: [],
      object: 'x',
      body: { language: 'unknown', source: 'x' },
    } as any);
    expect(fn).toBeUndefined();
    expect(warnings.length).toBe(1);
  });

  it('runs an L2 hook body and merges return value into ctx.input', async () => {
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    const fn = factory({
      name: 'normalize_email',
      object: 'contact',
      events: ['beforeInsert'],
      body: {
        language: 'js',
        source: 'return { email: ctx.input.email.trim().toLowerCase() };',
        capabilities: [],
      },
    } as any);
    expect(typeof fn).toBe('function');
    const engineCtx = { input: { email: '  Foo@Bar.COM  ' } } as any;
    await fn!(engineCtx);
    expect(engineCtx.input.email).toBe('foo@bar.com');
  });

  it('runs an L1 expression body without mutating input when no patch returned', async () => {
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    const fn = factory({
      name: 'guard',
      object: 'opportunity',
      events: ['beforeUpdate'],
      body: {
        language: 'expression',
        source: 'true',
      },
    } as any);
    expect(typeof fn).toBe('function');
    const engineCtx = { input: { x: 1 } } as any;
    await fn!(engineCtx);
    expect(engineCtx.input.x).toBe(1);
  });

  it('proxies ctx.api.object to the host ObjectQL engine', async () => {
    let called = false;
    const ql = {
      object: (n: string) => ({
        count: () => {
          called = true;
          return n === 'opportunity' ? 4 : 0;
        },
      }),
    };
    const factory = hookBodyRunnerFactory(runner, { ql, appId: 'crm' });
    const fn = factory({
      name: 'count_op',
      object: 'account',
      events: ['afterInsert'],
      body: {
        language: 'js',
        source: 'return { opportunity_count: await ctx.api.object("opportunity").count() };',
        capabilities: ['api.read'],
      },
    } as any);
    const engineCtx = { input: {} } as any;
    await fn!(engineCtx);
    expect(called).toBe(true);
    expect(engineCtx.input.opportunity_count).toBe(4);
  });

  it('writes back direct ctx.input.x mutations made inside the sandbox (no return)', async () => {
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    const fn = factory({
      name: 'normalize_account_number',
      object: 'account',
      events: ['beforeInsert'],
      body: {
        language: 'js',
        source: "if (ctx.input.account_number) ctx.input.account_number = String(ctx.input.account_number).toUpperCase();",
        capabilities: [],
      },
    } as any);
    const engineCtx = { input: { account_number: 'abc-9' } } as any;
    await fn!(engineCtx);
    expect(engineCtx.input.account_number).toBe('ABC-9');
  });

  it('awaits async ctx.api calls (real ObjectQL count is a Promise)', async () => {
    const ql = {
      object: () => ({
        count: async () => 17,
      }),
    };
    const factory = hookBodyRunnerFactory(runner, { ql, appId: 'crm' });
    const fn = factory({
      name: 'op_count_async',
      object: 'account',
      events: ['afterInsert'],
      body: {
        language: 'js',
        source: 'ctx.input.opportunity_count = await ctx.api.object("opportunity").count({});',
        capabilities: ['api.read'],
      },
    } as any);
    const engineCtx = { input: {} } as any;
    await fn!(engineCtx);
    expect(engineCtx.input.opportunity_count).toBe(17);
  });

  it('writes back through a Proxy-wrapped ctx.input (flat-record proxy from wrapDeclarativeHook)', async () => {
    const backing: Record<string, unknown> = { website: 'https://acme.com' };
    const proxy = new Proxy(backing, {
      get: (t, k) => (t as any)[k as string],
      set: (t, k, v) => {
        (t as any)[k as string] = v;
        return true;
      },
      ownKeys: (t) => Reflect.ownKeys(t),
      getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(t, k),
    });
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    const fn = factory({
      name: 'lower_website',
      object: 'account',
      events: ['beforeInsert'],
      body: {
        language: 'js',
        source: "ctx.input.website = String(ctx.input.website).toLowerCase();",
        capabilities: [],
      },
    } as any);
    const engineCtx = { input: proxy } as any;
    await fn!(engineCtx);
    expect(backing.website).toBe('https://acme.com');
  });

  // [#5906] `input` and `previous` are the engine's own spellings, and the only
  // ones: `HookContextSchema` declares no top-level `doc`/`previousDoc`, and
  // objectql's `engine.ts` — the sole producer of a HookContext — builds neither.
  // Alias limbs for both used to sit in `buildSandboxContext`; these two pin that
  // the sandbox now seeds from the truth keys and from nothing else. The NEGATIVE
  // one carries the weight: the truth keys sit FIRST in both reads, so the
  // positive case would stay green if either alias limb were put back.
  describe('seeds ctx.input / ctx.previous from the engine keys only', () => {
    /** A `ql` whose single write records what the body observed. */
    const probingQl = (seen: Array<Record<string, unknown>>) => ({
      object: () => ({ insert: async (data: any) => { seen.push(data); return data; } }),
    });

    const probeHook = (seen: Array<Record<string, unknown>>) =>
      hookBodyRunnerFactory(runner, { ql: probingQl(seen), appId: 'crm' })({
        name: 'probe',
        object: 'contact',
        events: ['beforeUpdate'],
        body: {
          language: 'js',
          source:
            "await ctx.api.object('probe').insert({"
            + ' input: JSON.stringify(ctx.input),'
            + ' previous: JSON.stringify(ctx.previous ?? null) });',
          capabilities: ['api.write'],
        },
      } as any);

    it('reads `input` and `previous`', async () => {
      const seen: Array<Record<string, unknown>> = [];
      await probeHook(seen)!({ input: { email: 'new@x.io' }, previous: { email: 'old@x.io' } } as any);
      expect(seen[0]).toEqual({
        input: '{"email":"new@x.io"}',
        previous: '{"email":"old@x.io"}',
      });
    });

    it('does NOT read a `doc` / `previousDoc` alias — no engine path produces either', async () => {
      const seen: Array<Record<string, unknown>> = [];
      // The spellings the deleted limbs defended, and nothing else on the context:
      // with them unread the body sees an empty input and no previous at all.
      await probeHook(seen)!({ doc: { email: 'new@x.io' }, previousDoc: { email: 'old@x.io' } } as any);
      expect(seen[0]).toEqual({ input: '{}', previous: 'null' });
    });
  });

  // [#6316] `ctx.user` is seeded from `engineCtx.user` and from nothing else.
  // `buildSandboxContext` used to spell `engineCtx?.user ?? engineCtx?.session?.user`;
  // the second limb was unreachable, because `HookContext['session']` declares
  // no `user` key and its sole producer — `buildSession()` in objectql, called
  // by every HookContext assembly site in the engine — writes none.
  //
  // ⚠️ Read these two cases for what they each pin. The POSITIVE one is not a
  // regression guard for this change: the truth key sat FIRST in the old chain,
  // so it was green before the deletion and is green after — deleting an
  // unreachable limb cannot move it, by construction. The NEGATIVE one carries
  // all the weight, and it is the one that goes RED if the limb is restored.
  // Its context is deliberately SYNTHETIC — no producer can build a session
  // carrying `user`, which is the whole finding — so it pins the RULE
  // ("`session.user` is not a data source") rather than any behaviour a real
  // path exhibits. That is the point: the rule is what a future edit would
  // break, and types cannot catch it here (both writers take `any`).
  describe('seeds ctx.user from the engine key only', () => {
    const probeUser = (engineCtx: Record<string, unknown>) => {
      const fn = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' })({
        name: 'probe_user',
        object: 'contact',
        events: ['beforeInsert'],
        body: {
          language: 'js',
          source: 'return { seen: JSON.stringify(ctx.user ?? null) };',
          capabilities: [],
        },
      } as any);
      const ctx = { input: {} as Record<string, unknown>, ...engineCtx } as any;
      return fn!(ctx).then(() => ctx.input.seen as string);
    };

    it('reads `user` — the key `buildUser()` produces on every hook dispatch', async () => {
      expect(await probeUser({ user: { id: 'u_1', name: 'Ada' } })).toBe(
        '{"id":"u_1","name":"Ada"}',
      );
    });

    it('does NOT fall back to `session.user` — no producer writes that key', async () => {
      // A session shape no producer can build, planted so the removed limb
      // would have something to find. With the limb gone the body sees no user
      // at all; `session.userId` is the spelling that carries the caller here.
      expect(
        await probeUser({ session: { userId: 'u_1', user: { id: 'u_1', name: 'Ada' } } }),
      ).toBe('null');
    });

    it('leaves ctx.user undefined when the context carries neither key', async () => {
      // ObjectQL's `ScopedRepo.execute()` is the real shape of this case on the
      // action face; on the hook face it is a context-less programmatic call.
      expect(await probeUser({})).toBe('null');
    });
  });
});

describe('actionBodyRunnerFactory', () => {
  const runner = new QuickJSScriptRunner();

  it('returns undefined when action has no body', () => {
    const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    expect(factory({ name: 'noop' })).toBeUndefined();
  });

  // ─── [#4352] the `type` gate ──────────────────────────────────────────────
  // `ActionSchema.body` always said "Only used when type is `script`"; the
  // runtime never read `type`, so a `type: 'url'` action carrying a leftover
  // body still bound a handler and still executed. These pin the enforcement.
  describe('binds a body only for `type: "script"` (#4352)', () => {
    const body = { language: 'js', source: 'return { ran: true };', capabilities: [] } as const;

    for (const type of ['url', 'modal', 'flow', 'api', 'form'] as const) {
      it(`binds no handler for type: '${type}' and says why`, () => {
        const warnings: string[] = [];
        const factory = actionBodyRunnerFactory(runner, {
          ql: {},
          appId: 'crm',
          logger: { warn: (msg: string) => warnings.push(msg) },
        });
        expect(factory({ name: 'leftover', object: 'lead', type, body })).toBeUndefined();
        // Refusing silently would only relocate the invisibility the issue is about.
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("type: '" + type + "'");
        expect(warnings[0]).toContain('#4352');
      });
    }

    it("binds for an explicit type: 'script'", async () => {
      const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
      const fn = factory({ name: 'ok', object: 'lead', type: 'script', body });
      expect(typeof fn).toBe('function');
      await expect(fn!({ params: {} })).resolves.toEqual({ ran: true });
    });

    it('binds when `type` is omitted — the spec default is `script`', async () => {
      // The collectors walk RAW bundle objects; a `strict: false` defineStack or
      // a legacy `manifest.actions[]` never passed through `ActionType.default`,
      // so an omitted type must still mean `script` here.
      const warnings: string[] = [];
      const factory = actionBodyRunnerFactory(runner, {
        ql: {},
        appId: 'crm',
        logger: { warn: (msg: string) => warnings.push(msg) },
      });
      const fn = factory({ name: 'ok', object: 'lead', body });
      expect(typeof fn).toBe('function');
      await expect(fn!({ params: {} })).resolves.toEqual({ ran: true });
      expect(warnings).toEqual([]);
    });

    it('stays silent for a non-script action with no body — nothing is contradictory', () => {
      const warnings: string[] = [];
      const factory = actionBodyRunnerFactory(runner, {
        ql: {},
        appId: 'crm',
        logger: { warn: (msg: string) => warnings.push(msg) },
      });
      expect(factory({ name: 'open_docs', type: 'url' })).toBeUndefined();
      expect(warnings).toEqual([]);
    });
  });

  it('runs an L2 action body and returns its value', async () => {
    const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    const fn = factory({
      name: 'double',
      object: 'quote',
      body: {
        language: 'js',
        source: 'return { doubled: input.n * 2 };',
        capabilities: [],
      },
    });
    expect(typeof fn).toBe('function');
    const out = await fn!({ params: { n: 21 } });
    expect(out).toEqual({ doubled: 42 });
  });

  it('proxies ctx.api in actions', async () => {
    const ql = {
      object: () => ({
        find: async () => [{ id: '1' }, { id: '2' }, { id: '3' }],
      }),
    };
    const factory = actionBodyRunnerFactory(runner, { ql, appId: 'crm' });
    const fn = factory({
      name: 'list',
      object: 'lead',
      body: {
        language: 'js',
        source: 'const rows = await ctx.api.object("lead").find({}); return { count: rows.length };',
        capabilities: ['api.read'],
      },
    });
    const out = await fn!({ params: {} });
    expect(out).toEqual({ count: 3 });
  });

  // The hook path writes `ctx.input` back; the action path has no `ctx.record`
  // counterpart, so a body that assigns to `ctx.record` gets a green action and
  // an unchanged record. That stays true — an action's write channel is
  // `ctx.api` — but it is no longer silent (#4345).
  describe('discarded ctx.record writes are reported (#4345)', () => {
    const warnsFor = async (source: string, record?: Record<string, unknown>) => {
      const warns: Array<{ msg: string; meta: any }> = [];
      const factory = actionBodyRunnerFactory(runner, {
        ql: {},
        appId: 'crm',
        logger: { warn: (msg: string, meta: any) => warns.push({ msg, meta }) },
      });
      const fn = factory({
        name: 'close_deal',
        object: 'crm_deal',
        body: { language: 'js', source, capabilities: [] },
      });
      const value = await fn!({ record, recordId: record?.id });
      return { warns, value };
    };

    it('warns naming the discarded fields and the ctx.api remedy', async () => {
      const { warns, value } = await warnsFor("ctx.record.stage = 'won'; return { ok: true };", {
        id: 'deal_1',
        stage: 'negotiation',
      });
      // The action still reports success — the warning is the only signal the
      // author's intended write did not happen.
      expect(value).toEqual({ ok: true });
      expect(warns).toHaveLength(1);
      expect(warns[0].msg).toContain('read-only');
      expect(warns[0].msg).toContain("ctx.api.object('crm_deal').update(");
      expect(warns[0].meta.fields).toEqual(['stage']);
      expect(warns[0].meta.action).toBe('close_deal');
    });

    it('warns for a DECLARED field exactly as for an unknown one — the whole point of #4345', async () => {
      // The runner never consults the object's fields: `stage` (declared on the
      // object in the issue's repro) and `stgae` (a typo) are dropped alike, so
      // both must warn. A rule that fired only on the unknown one would imply
      // the declared one landed.
      const declared = await warnsFor("ctx.record.stage = 'won'; return null;", { id: 'd', stage: 'x' });
      const typo = await warnsFor("ctx.record.stgae = 'won'; return null;", { id: 'd', stage: 'x' });
      expect(declared.warns).toHaveLength(1);
      expect(typo.warns).toHaveLength(1);
    });

    it('stays quiet when the body only reads the record', async () => {
      const { warns, value } = await warnsFor('return { stage: ctx.record.stage };', {
        id: 'deal_1',
        stage: 'negotiation',
      });
      expect(value).toEqual({ stage: 'negotiation' });
      expect(warns).toEqual([]);
    });

    it('stays quiet for an action with no pre-fetched record', async () => {
      const { warns } = await warnsFor('return { ok: true };');
      expect(warns).toEqual([]);
    });

    it('stays quiet when the body persists correctly through ctx.api', async () => {
      const updates: unknown[] = [];
      const factory = actionBodyRunnerFactory(runner, {
        ql: { object: () => ({ update: async (d: unknown) => { updates.push(d); return d; } }) },
        appId: 'crm',
        logger: { warn: () => { throw new Error('the documented remedy must not warn'); } },
      });
      const fn = factory({
        name: 'close_deal',
        object: 'crm_deal',
        body: {
          language: 'js',
          source:
            "await ctx.api.object('crm_deal').update({ id: ctx.recordId, stage: 'won' }); return { ok: true };",
          capabilities: ['api.write'],
        },
      });
      expect(await fn!({ record: { id: 'deal_1' }, recordId: 'deal_1' })).toEqual({ ok: true });
      expect(updates).toEqual([{ id: 'deal_1', stage: 'won' }]);
    });
  });

  // [#6316] The action face of the same removal. `ActionSession` declares
  // `userId` / `organizationId` / `positions` / `roles` and no `user`, and its
  // sole producer `buildActionSession()` writes exactly those four — for both
  // action ctx assembly sites (MCP `run_action` in `action-execution.ts`, REST
  // `/actions` in `domains/actions.ts`). As on the hook face above, the
  // negative case is the one that goes red if `?? actionCtx?.session?.user` is
  // restored; the positive case cannot move either way.
  describe('seeds ctx.user from the action-context key only', () => {
    const probeUser = (actionCtx: Record<string, unknown>) =>
      actionBodyRunnerFactory(runner, { ql: {}, appId: 'crm' })({
        name: 'whoami',
        object: 'crm_deal',
        body: {
          language: 'js',
          source: 'return JSON.stringify(ctx.user ?? null);',
          capabilities: [],
        },
      })!(actionCtx);

    it('reads `user` — the ActorUser every dispatch site builds', async () => {
      expect(await probeUser({ user: { id: 'u_1', displayName: 'Ada' } })).toBe(
        '{"id":"u_1","displayName":"Ada"}',
      );
    });

    it('does NOT fall back to `session.user` — ActionSession has no such key', async () => {
      // The four keys `buildActionSession()` really writes, plus a planted
      // `user` the removed limb would have read. Only the planted one is
      // ignored; a body that needs the caller reads `ctx.session.userId`.
      expect(
        await probeUser({
          session: {
            userId: 'u_1',
            organizationId: 'org_1',
            positions: ['sales'],
            roles: ['sales'],
            user: { id: 'u_1', displayName: 'Ada' },
          },
        }),
      ).toBe('null');
    });

    it("leaves ctx.user undefined on ObjectQL's `ScopedRepo.execute()` shape", async () => {
      // The engine's `repo.execute(name, params)` reaches `executeAction` with
      // `{ ...params, userId, tenantId, roles }` — neither `user` nor `session`.
      // Both limbs missed it before this change and the surviving one misses it
      // now: `ctx.user` is `undefined` either way, which is the correct
      // semantics (that path carries no caller identity).
      expect(await probeUser({ userId: 'u_1', tenantId: 'org_1', roles: ['sales'] })).toBe('null');
    });
  });
});
