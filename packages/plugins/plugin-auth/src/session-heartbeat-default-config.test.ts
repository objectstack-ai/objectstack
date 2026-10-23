// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25343] The `sys_session.last_activity_at` heartbeat runs on every
 * deployment — not only where an idle timeout is configured — and, with both
 * session limits off, its read is throttled by a per-process, per-session
 * 60-second memo (ruling 6358844136, letter A).
 *
 * The field promises "the last request on this session", and Setup → Sessions
 * shows it so an administrator can tell two of one user's sessions apart. The
 * heartbeat used to sit under `idleMin > 0`, behind an early return when both
 * limits were off — the default — so the column was empty everywhere a limit
 * was not configured.
 *
 * Driven through `AuthManager#enforceSessionControls` (the per-request call
 * `customSession` makes), against a stateful one-object engine, with only
 * `Date` faked so the minute boundaries are exact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthManager } from './auth-manager.js';
import { SESSION_HEARTBEAT_MEMO_MAX } from './auth-manager-password-session-policy.js';

const SECRET = 'test-secret-at-least-32-chars-long';
const T0 = new Date('2026-10-23T08:00:00.000Z').getTime();
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

type Row = { id: string; created_at: Date; last_activity_at: Date | null; revoked_at: Date | null };

/** A `sys_session` store that remembers what the heartbeat wrote. */
function sessionEngine(rows: Row[], opts: { failFindOnce?: boolean } = {}) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  let failNext = opts.failFindOnce === true;
  return {
    byId,
    findOne: vi.fn(async (_object: string, q: any) => {
      if (failNext) {
        failNext = false;
        throw new Error('driver unavailable');
      }
      const r = byId.get(q?.where?.id);
      return r ? { ...r } : null;
    }),
    update: vi.fn(async (_object: string, patch: any) => {
      const r = byId.get(patch.id);
      if (r) Object.assign(r, patch);
      return {};
    }),
    find: vi.fn(async () => []),
  };
}

function manager(engine: unknown, extra: Record<string, unknown> = {}) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const logger = { warn: vi.fn(), info: vi.fn() };
  const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine as any, logger, ...extra } as any);
  warn.mockRestore();
  const enforce = (sessionId: string) =>
    (m as never as { enforceSessionControls(s: string, c: unknown): Promise<void> })
      .enforceSessionControls(sessionId, undefined);
  return { enforce, logger };
}

const session = (id: string, lastActivity: Date | null): Row => ({
  id, created_at: new Date(T0 - 10 * MINUTE), last_activity_at: lastActivity, revoked_at: null,
});

const heartbeatWrites = (engine: ReturnType<typeof sessionEngine>) =>
  engine.update.mock.calls.filter(([, patch]: any[]) => 'last_activity_at' in patch && !('revoked_at' in patch));

describe('[#25343] the last_activity_at heartbeat under the default config (no idle, no absolute limit)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('heartbeat written under the default config: a never-touched session gets last_activity_at on its first request', async () => {
    const engine = sessionEngine([session('s1', null)]);
    const { enforce } = manager(engine);

    await enforce('s1');

    expect(heartbeatWrites(engine)).toHaveLength(1);
    expect(engine.byId.get('s1')!.last_activity_at!.getTime()).toBe(T0);
  });

  it('heartbeat written under the default config: last_activity_at advances on a request more than 60 s later', async () => {
    const engine = sessionEngine([session('s1', new Date(T0 - 5 * MINUTE))]);
    const { enforce } = manager(engine);

    await enforce('s1');
    expect(engine.byId.get('s1')!.last_activity_at!.getTime()).toBe(T0);

    vi.setSystemTime(T0 + MINUTE + SECOND);
    await enforce('s1');

    expect(heartbeatWrites(engine)).toHaveLength(2);
    expect(engine.byId.get('s1')!.last_activity_at!.getTime()).toBe(T0 + MINUTE + SECOND);
  });

  it('the memo skips the sys_session read (and the write) for 60 s after a read, then reads again', async () => {
    const engine = sessionEngine([session('s1', new Date(T0 - 5 * MINUTE))]);
    const { enforce } = manager(engine);

    await enforce('s1');
    vi.setSystemTime(T0 + 30 * SECOND);
    await enforce('s1');
    vi.setSystemTime(T0 + MINUTE);
    await enforce('s1');

    expect(engine.findOne).toHaveBeenCalledTimes(1);
    expect(heartbeatWrites(engine)).toHaveLength(1);

    vi.setSystemTime(T0 + MINUTE + 1);
    await enforce('s1');

    expect(engine.findOne).toHaveBeenCalledTimes(2);
  });

  it('a session whose last_activity_at is younger than a minute is read but not written', async () => {
    // Another process touched it 20 s ago: this process reads once and leaves it.
    const engine = sessionEngine([session('s1', new Date(T0 - 20 * SECOND))]);
    const { enforce } = manager(engine);

    await enforce('s1');

    expect(engine.findOne).toHaveBeenCalledTimes(1);
    expect(heartbeatWrites(engine)).toHaveLength(0);
  });

  it('the memo is per session: a second session of the same user is read on its own first request', async () => {
    const engine = sessionEngine([session('s1', null), session('s2', null)]);
    const { enforce } = manager(engine);

    await enforce('s1');
    await enforce('s2');

    expect(engine.findOne).toHaveBeenCalledTimes(2);
    expect(engine.byId.get('s1')!.last_activity_at!.getTime()).toBe(T0);
    expect(engine.byId.get('s2')!.last_activity_at!.getTime()).toBe(T0);
  });

  it('the memo is per data engine: another engine never answers from the first one\'s memo', async () => {
    const a = sessionEngine([session('s1', null)]);
    const b = sessionEngine([session('s1', null)]);

    await manager(a).enforce('s1');
    await manager(b).enforce('s1');

    expect(a.findOne).toHaveBeenCalledTimes(1);
    expect(b.findOne).toHaveBeenCalledTimes(1);
    expect(heartbeatWrites(b)).toHaveLength(1);
  });

  it('a failed read is not memoised: the next request reads again, and the warning names the heartbeat, not the limits', async () => {
    const engine = sessionEngine([session('s1', null)], { failFindOnce: true });
    const { enforce, logger } = manager(engine);

    await enforce('s1');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const text = String(logger.warn.mock.calls[0][0]);
    expect(text).toContain('heartbeat');
    expect(text).not.toContain('limits (ADR-0069 D4)');

    await enforce('s1');
    expect(engine.findOne).toHaveBeenCalledTimes(2);
    expect(heartbeatWrites(engine)).toHaveLength(1);
  });

  it('a revoked session is read once a minute and never touched', async () => {
    const engine = sessionEngine([{ ...session('s1', null), revoked_at: new Date(T0 - MINUTE) }]);
    const { enforce } = manager(engine);

    await enforce('s1');
    await enforce('s1');

    expect(engine.findOne).toHaveBeenCalledTimes(1);
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('the memo is bounded: past its cap the least recently read session is forgotten and read again', async () => {
    const ids = Array.from({ length: SESSION_HEARTBEAT_MEMO_MAX + 1 }, (_, i) => `s${i}`);
    // Every row present and freshly touched, so no write muddies the count.
    const engine = sessionEngine(ids.map((id) => session(id, new Date(T0))));
    const { enforce } = manager(engine);

    for (const id of ids) await enforce(id);
    expect(engine.findOne).toHaveBeenCalledTimes(ids.length);

    // The newest is still remembered; the first one was evicted.
    await enforce(ids[ids.length - 1]);
    expect(engine.findOne).toHaveBeenCalledTimes(ids.length);
    await enforce(ids[0]);
    expect(engine.findOne).toHaveBeenCalledTimes(ids.length + 1);
  });
});

describe('[#25343] with a session limit configured, every request still reads (the memo is not asked)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['idle timeout', { sessionIdleTimeoutMinutes: 15 }],
    ['absolute max', { sessionAbsoluteMaxHours: 24 }],
  ])('%s on: two requests a second apart read twice and write the heartbeat once', async (_label, cfg) => {
    const engine = sessionEngine([session('s1', new Date(T0 - 5 * MINUTE))]);
    const { enforce } = manager(engine, cfg);

    await enforce('s1');
    vi.setSystemTime(T0 + SECOND);
    await enforce('s1');

    expect(engine.findOne).toHaveBeenCalledTimes(2);
    expect(heartbeatWrites(engine)).toHaveLength(1);
  });
});
