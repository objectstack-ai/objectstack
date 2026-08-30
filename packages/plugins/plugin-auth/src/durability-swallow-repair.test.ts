// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12981 batch 5] The ten `plugin-auth` tier-1 DARK durability swallows, pinned.
 *
 * ## What these tests are for, and why the obvious test is the wrong one
 *
 * Every site below was a `catch` that reported NOTHING over a write that had
 * been refused. The repair is not a behaviour change: control flow is identical
 * — the sign-in still succeeds, the password change still stands, the import
 * still answers 200. The ONLY observable difference is that an operator now
 * gets a line. So a test that asserts the surrounding operation still succeeds
 * pins nothing at all: it passed before the repair and it passes after.
 *
 * These assert the LINE. Each case drives the real method with an engine whose
 * write is refused, and fails if the durability channel stays quiet. Delete any
 * repair and its case goes red — which is the property the census cannot check,
 * because the census reads syntax and cannot tell a reachable reporter from an
 * unreachable one.
 *
 * ## Why each case also asserts what the message SAYS
 *
 * Not decoration, and not a spelling test. #12981's whole subject is a failure
 * that leaves nothing looking broken, so the line is the operator's only
 * evidence; a report naming neither the object that did not land nor what is
 * now unenforced is a report they cannot act on. Each assertion pins the one
 * fact that makes its line actionable (the object, and the control that
 * silently stopped enforcing), never the prose around it — so the wording stays
 * free to improve.
 *
 * ## Level
 *
 * `warn` for the `AuthManager` seams and `error` for the two `AuthPlugin`
 * seams, and the split is deliberate: `AuthManagerOptions.logger` is re-exported
 * from the package `index.ts` and declares no `error`, so #12981's ruling routes
 * that LEVEL question to #13398 and leaves the SILENCE here. `AuthPlugin` logs
 * through the kernel `Logger`, whose `error` is required, so those two get the
 * level AGENTS.md → "Degradation log levels" actually calls for. The assertions
 * below pin each site to the channel it ships on, so a later level change is a
 * deliberate edit here rather than a silent drift.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long';

/** The refusal every case simulates: the driver said no, loudly, to the caller. */
const REFUSAL = new Error('write refused: readonly transaction');

type Capture = { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

const createLogger = (): Capture => ({ warn: vi.fn(), info: vi.fn() });

/** Every `warn` message this logger received, joined for substring assertions. */
const warnText = (logger: Capture): string =>
  logger.warn.mock.calls.map((c) => String(c[0])).join('\n---\n');

/**
 * The `meta` object of the first `warn`.
 *
 * The cause travels HERE, not in the message: `AuthManagerOptions.logger`
 * declares `warn(msg, meta?)`, so `logDurabilityDegradation` puts the driver's
 * own text under `meta.error`. Pinning it separately is the point — a repair
 * that reported the consequence but dropped the cause would leave an operator
 * with a paragraph about lockout and nothing to grep for in the driver log.
 */
const warnMeta = (logger: Capture): Record<string, unknown> =>
  (logger.warn.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;

/**
 * A deliberately minimal engine double.
 *
 * `update` is pinned to ObjectQL's own dispatch predicate
 * ({@link assertEngineUpdateDispatch}) and `findOne` to
 * {@link assertEngineFindOnePredicate}, in both cases BEFORE the double decides
 * whether to refuse — so a case cannot pass by handing the engine a call the
 * real engine would have thrown on, which is `check:engine-double-contract`'s
 * whole subject. Ordering matters: pinning after the refusal branch would leave
 * every refusal case unchecked, and those are most of this file.
 *
 * The refusal is then simulated per object name, because two sites here need
 * one object's write to land and another's to fail in the same call.
 */
const createEngine = (opts: {
  refuseUpdateOn?: string[];
  refuseInsertOn?: string[];
  findOne?: (object: string) => unknown;
  find?: (object: string) => unknown[];
  count?: number;
  throwOnFindOne?: boolean;
  throwOnFind?: boolean;
}) => ({
  findOne: vi.fn(async (object: string, query: unknown = {}) => {
    assertEngineFindOnePredicate(object, query as never);
    if (opts.throwOnFindOne) throw REFUSAL;
    return opts.findOne?.(object) ?? null;
  }),
  find: vi.fn(async (object: string) => {
    if (opts.throwOnFind) throw REFUSAL;
    return opts.find?.(object) ?? [];
  }),
  count: vi.fn(async () => opts.count ?? 0),
  insert: vi.fn(async (object: string) => {
    if (opts.refuseInsertOn?.includes(object)) throw REFUSAL;
    return { id: 'inserted' };
  }),
  update: vi.fn(async (object: string, doc: Record<string, unknown>, options?: unknown) => {
    assertEngineUpdateDispatch(doc, options as never);
    if (opts.refuseUpdateOn?.includes(object)) throw REFUSAL;
    return { id: String(doc.id ?? 'updated') };
  }),
});

const createManager = (
  engine: ReturnType<typeof createEngine>,
  logger: Capture,
  config: Record<string, unknown> = {},
) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine as never,
    logger,
    ...config,
  } as never);

describe('#12981 batch 5 — plugin-auth durability swallows report instead of vanishing', () => {
  describe('AuthManager (8 seams, `warn` — level deferred to #13398)', () => {
    it('stampIdentitySource: a lost provenance stamp names the gate it leaves open', async () => {
      const logger = createLogger();
      const engine = createEngine({ refuseUpdateOn: ['sys_user'], count: 0 });
      const manager = createManager(engine, logger);

      await expect(
        (manager as never as { stampIdentitySource(a: unknown): Promise<void> })
          .stampIdentitySource({ providerId: 'oidc', userId: 'u1' }),
      ).resolves.toBeUndefined();

      expect(engine.update).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('sys_user.source');
      // The consequence, not just the failure: a managed identity that still
      // reads env_native is offered the local-password actions.
      expect(warnText(logger)).toContain('env_native');
      // The driver's own text survives, so the line is greppable against the
      // datasource log rather than being prose about a failure nobody can find.
      expect(warnMeta(logger)).toMatchObject({
        object: 'sys_user',
        error: 'write refused: readonly transaction',
      });
    });

    it('stampPasswordChangedAt: a lost stamp names the force-change flag left set', async () => {
      const logger = createLogger();
      const engine = createEngine({ refuseUpdateOn: ['sys_user'] });
      const manager = createManager(engine, logger);

      await (manager as never as { stampPasswordChangedAt(u: string): Promise<void> })
        .stampPasswordChangedAt('u1');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('password_changed_at');
      expect(warnText(logger)).toContain('must_change_password');
    });

    it('recordPasswordHistory: a lost ring write names the reuse rule that stops enforcing', async () => {
      const logger = createLogger();
      const engine = createEngine({
        refuseUpdateOn: ['sys_account'],
        // `previous_password_hashes` is PRESENT (as null), so the internal-field
        // readback short-circuits and this case exercises only the ring write.
        findOne: () => ({ id: 'acc1', previous_password_hashes: null }),
      });
      const manager = createManager(engine, logger, { passwordHistoryCount: 3 });

      await (manager as never as { recordPasswordHistory(u: string, h: string): Promise<void> })
        .recordPasswordHistory('u1', 'old-hash');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('sys_account');
      expect(warnText(logger)).toContain('passwordHistoryCount');
    });

    it('recordSignInOutcome: a lost lockout counter names the brute-force limit that is off', async () => {
      const logger = createLogger();
      const engine = createEngine({
        refuseUpdateOn: ['sys_user'],
        findOne: () => ({ id: 'u1', failed_login_count: 0, locked_until: null }),
      });
      const manager = createManager(engine, logger, { lockoutThreshold: 3 });

      await (manager as never as { recordSignInOutcome(e: string, s: boolean): Promise<void> })
        .recordSignInOutcome('a@b.com', false);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('lockoutThreshold');
      expect(warnText(logger)).toContain('failed_login_count');
    });

    it('stampLastLogin: a lost stamp names the compliance trail that keeps no row', async () => {
      const logger = createLogger();
      const engine = createEngine({ refuseUpdateOn: ['sys_user'] });
      const manager = createManager(engine, logger);

      await (manager as never as { stampLastLogin(u: string, ip?: string): Promise<void> })
        .stampLastLogin('u1', '203.0.113.7');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('last_login_at');
      expect(warnText(logger)).toContain('last_login_ip');
    });

    it('unlockUser: still answers true, and now SAYS the second factor stayed locked', async () => {
      const logger = createLogger();
      const engine = createEngine({
        // The password-stage write lands; only the 2FA half is refused. That
        // asymmetry IS the defect: the admin is told the unlock worked.
        refuseUpdateOn: ['sys_two_factor'],
        findOne: () => ({ id: 'u1' }),
        find: () => [{ id: 'tf1' }],
      });
      const manager = createManager(engine, logger);

      const result = await (manager as never as { unlockUser(u: string): Promise<boolean> })
        .unlockUser('u1');

      // Unchanged behaviour — the password stage really is cleared.
      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('sys_two_factor');
      expect(warnText(logger)).toContain('SUCCESS');
    });

    it('enforceSessionControls: a refused REVOCATION says the over-limit session stayed live', async () => {
      const logger = createLogger();
      const engine = createEngine({
        refuseUpdateOn: ['sys_session'],
        findOne: () => ({
          id: 's1',
          created_at: new Date(Date.now() - 5 * 3_600_000),
          last_activity_at: new Date(),
          revoked_at: null,
        }),
      });
      const manager = createManager(engine, logger, { sessionAbsoluteMaxHours: 1 });

      await (manager as never as {
        enforceSessionControls(s: string, c: unknown): Promise<void>;
      }).enforceSessionControls('s1', undefined);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('NOT revoked');
      expect(warnText(logger)).toContain('sys_session');
    });

    it('enforceSessionControls: a refused HEARTBEAT says the idle clock now runs early', async () => {
      const logger = createLogger();
      const engine = createEngine({
        refuseUpdateOn: ['sys_session'],
        findOne: () => ({
          id: 's1',
          created_at: new Date(),
          // Older than the 60s throttle, far younger than the idle window.
          last_activity_at: new Date(Date.now() - 5 * 60_000),
          revoked_at: null,
        }),
      });
      const manager = createManager(engine, logger, { sessionIdleTimeoutMinutes: 60 });

      await (manager as never as {
        enforceSessionControls(s: string, c: unknown): Promise<void>;
      }).enforceSessionControls('s1', undefined);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('last_activity_at');
    });

    it('enforceSessionControls: a refused LOOKUP says the controls did not run', async () => {
      const logger = createLogger();
      const engine = createEngine({ throwOnFindOne: true });
      const manager = createManager(engine, logger, { sessionIdleTimeoutMinutes: 60 });

      await (manager as never as {
        enforceSessionControls(s: string, c: unknown): Promise<void>;
      }).enforceSessionControls('s1', undefined);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('did not run to completion');
    });

    it('enforceConcurrentCap: a refused revocation says the cap is not enforced', async () => {
      const logger = createLogger();
      const future = new Date(Date.now() + 3_600_000);
      const engine = createEngine({
        refuseUpdateOn: ['sys_session'],
        find: () => [
          { id: 'newest', created_at: new Date(), expires_at: future, revoked_at: null },
          { id: 'oldest', created_at: new Date(Date.now() - 60_000), expires_at: future, revoked_at: null },
        ],
      });
      const manager = createManager(engine, logger, { maxConcurrentSessions: 1 });

      await (manager as never as { enforceConcurrentCap(u: string): Promise<void> })
        .enforceConcurrentCap('u1');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('maxConcurrentSessions');
      // The row that stayed live is named — the newest is the one kept.
      expect(warnText(logger)).toContain('NOT revoked');
    });

    it('enforceConcurrentCap: a refused LOOKUP says the sweep did not run', async () => {
      const logger = createLogger();
      const engine = createEngine({ throwOnFind: true });
      const manager = createManager(engine, logger, { maxConcurrentSessions: 1 });

      await (manager as never as { enforceConcurrentCap(u: string): Promise<void> })
        .enforceConcurrentCap('u1');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(warnText(logger)).toContain('did not run');
    });

    it('the repaired seams stay QUIET on the happy path — a report is evidence, not noise', async () => {
      const logger = createLogger();
      const engine = createEngine({
        findOne: () => ({ id: 'u1', failed_login_count: 0, locked_until: null }),
      });
      const manager = createManager(engine, logger, { lockoutThreshold: 3 });

      await (manager as never as { stampLastLogin(u: string, ip?: string): Promise<void> })
        .stampLastLogin('u1', '203.0.113.7');
      await (manager as never as { recordSignInOutcome(e: string, s: boolean): Promise<void> })
        .recordSignInOutcome('a@b.com', false);
      await (manager as never as { stampPasswordChangedAt(u: string): Promise<void> })
        .stampPasswordChangedAt('u1');

      // Without this direction every assertion above could be satisfied by a
      // seam that warns unconditionally, which would bury the real reports.
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('AuthPlugin (2 seams, `error` — the kernel Logger declares it required)', () => {
    let ctx: PluginContext;
    let hooks: Array<() => Promise<void>>;

    /**
     * Run every registered `kernel:ready` handler, tolerating throws from the
     * ones this file is not about. The plugin registers many; isolating the
     * assertion to the message text keeps a sibling hook's failure from
     * deciding these cases either way.
     */
    const triggerReady = async () => {
      for (const h of hooks) {
        try {
          await h();
        } catch {
          /* not this test's subject */
        }
      }
    };

    const errorText = (): string =>
      (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .join('\n---\n');

    const build = (objectql: unknown): PluginContext => {
      hooks = [];
      return {
        registerService: vi.fn(),
        getService: vi.fn((name: string) => {
          if (name === 'objectql') return objectql;
          if (name === 'manifest') return { register: vi.fn() };
          return undefined;
        }),
        getServices: vi.fn(() => new Map()),
        hook: vi.fn((name: string, handler: () => Promise<void>) => {
          if (name === 'kernel:ready') hooks.push(handler);
        }),
        trigger: vi.fn(),
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        getKernel: vi.fn(),
      } as never as PluginContext;
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('a refused SCIM provenance stamp is reported, and names why nothing retries it', async () => {
      let stamp: ((hookCtx: unknown) => Promise<void>) | undefined;
      const engine = {
        registerHook: vi.fn((event: string, handler: (c: unknown) => Promise<void>) => {
          if (event === 'afterInsert') stamp = handler;
        }),
        count: vi.fn(async () => 0),
        findOne: vi.fn(async () => ({ id: 'u1', source: 'env_native' })),
        update: vi.fn(async () => {
          throw REFUSAL;
        }),
      };
      ctx = build(engine);
      const plugin = new AuthPlugin({ secret: SECRET, baseUrl: 'http://localhost:3000' } as never);
      await plugin.init(ctx);
      await plugin.start(ctx);
      await triggerReady();

      expect(stamp, 'the afterInsert stamp was never registered').toBeTypeOf('function');
      await expect(
        stamp!({ object: 'sys_account', result: { user_id: 'u1', provider_id: 'oidc' } }),
      ).resolves.toBeUndefined();

      expect(engine.update).toHaveBeenCalled();
      expect(errorText()).toContain('SCIM identity-source stamp was NOT written');
      expect(errorText()).toContain('env_native');
      // The cause travels in the Error slot of the kernel Logger signature
      // (message, error, meta) — putting meta there would silently discard it.
      const call = (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
        String(c[0]).includes('NOT written'),
      );
      expect(call?.[1]).toBe(REFUSAL);
    });

    it('a refused hook REGISTRATION is reported — the stamp is un-armed for the whole process', async () => {
      const engine = {
        registerHook: vi.fn(() => {
          throw REFUSAL;
        }),
      };
      ctx = build(engine);
      const plugin = new AuthPlugin({ secret: SECRET, baseUrl: 'http://localhost:3000' } as never);
      await plugin.init(ctx);
      await plugin.start(ctx);
      await triggerReady();

      expect(errorText()).toContain('SCIM identity-source stamp was NOT registered');
      expect(errorText()).toContain('does NOT retry');
    });

    it('a healthy boot registers the stamp and reports nothing on this channel', async () => {
      const engine = {
        registerHook: vi.fn(),
        count: vi.fn(async () => 0),
        findOne: vi.fn(async () => null),
        update: vi.fn(async () => ({ id: 'u1' })),
      };
      ctx = build(engine);
      const plugin = new AuthPlugin({ secret: SECRET, baseUrl: 'http://localhost:3000' } as never);
      await plugin.init(ctx);
      await plugin.start(ctx);
      await triggerReady();

      expect(engine.registerHook).toHaveBeenCalled();
      expect(errorText()).not.toContain('SCIM identity-source stamp');
    });
  });
});
