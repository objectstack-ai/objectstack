import { describe, it, expect, vi, afterEach } from 'vitest';
import { CronJobAdapter } from './cron-job-adapter.js';

const HOUR = 3_600_000;
const grants = () => ({ acquire: vi.fn(async () => ({ release: vi.fn(async () => {}) })) });
const denies = () => ({ acquire: vi.fn(async () => null) });

describe('CronJobAdapter — scheduler leader-election', () => {
  it('runs the handler when the cluster lock is acquired (leader)', async () => {
    const handler = vi.fn(async () => {});
    const adapter = new CronJobAdapter({ cluster: { lock: grants() } });
    await adapter.schedule('j', { type: 'interval', intervalMs: HOUR }, handler);
    await (adapter as any).runScheduled('j');
    expect(handler).toHaveBeenCalledTimes(1);
    await adapter.destroy();
  });
  it('skips the handler when the lock is held by another node', async () => {
    const handler = vi.fn(async () => {});
    const adapter = new CronJobAdapter({ cluster: { lock: denies() } });
    await adapter.schedule('j', { type: 'interval', intervalMs: HOUR }, handler);
    await (adapter as any).runScheduled('j');
    expect(handler).not.toHaveBeenCalled();
    await adapter.destroy();
  });
  it('runs without a cluster (single-node, unchanged behaviour)', async () => {
    const handler = vi.fn(async () => {});
    const adapter = new CronJobAdapter();
    await adapter.schedule('j', { type: 'interval', intervalMs: HOUR }, handler);
    await (adapter as any).runScheduled('j');
    expect(handler).toHaveBeenCalledTimes(1);
    await adapter.destroy();
  });
  it('manual trigger() bypasses leader-election and always runs', async () => {
    const handler = vi.fn(async () => {});
    const adapter = new CronJobAdapter({ cluster: { lock: denies() } });
    await adapter.schedule('j', { type: 'interval', intervalMs: HOUR }, handler);
    await adapter.trigger('j');
    expect(handler).toHaveBeenCalledTimes(1);
    await adapter.destroy();
  });
  it('releases the lock after the scheduled run', async () => {
    const release = vi.fn(async () => {});
    const acquire = vi.fn(async () => ({ release }));
    const adapter = new CronJobAdapter({ cluster: { lock: { acquire } } });
    await adapter.schedule('j', { type: 'interval', intervalMs: HOUR }, vi.fn(async () => {}));
    await (adapter as any).runScheduled('j');
    expect(acquire).toHaveBeenCalledWith('job:j', { ttlMs: 60000, waitMs: 0 });
    expect(release).toHaveBeenCalledTimes(1);
    await adapter.destroy();
  });
});

describe('CronJobAdapter — an unreachable cluster lock skips the fire, never crashes the process', () => {
  const lostConnection = () => new Error('Reached the max retries per request limit (which is 3).');
  const logger = () => ({ warn: vi.fn(), info: vi.fn() });

  it('a rejected acquire resolves the fire (no rejection), skips the handler, and warns ONCE per outage', async () => {
    const handler = vi.fn(async () => {});
    const log = logger();
    const acquire = vi.fn(async () => { throw lostConnection(); });
    const adapter = new CronJobAdapter({ cluster: { lock: { acquire } }, logger: log });
    await adapter.schedule('a', { type: 'interval', intervalMs: HOUR }, handler);
    await adapter.schedule('b', { type: 'interval', intervalMs: HOUR }, handler);
    for (let tick = 0; tick < 5; tick++) {
      await expect((adapter as any).runScheduled('a')).resolves.toBeUndefined();
      await expect((adapter as any).runScheduled('b')).resolves.toBeUndefined();
    }
    expect(acquire).toHaveBeenCalledTimes(10);
    expect(handler).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toMatch(/could not acquire "job:a".*retries on its next tick/);
    await adapter.destroy();
  });

  it('the next fire after the lock answers again runs, and a later outage warns again', async () => {
    const handler = vi.fn(async () => {});
    const log = logger();
    let down = true;
    const acquire = vi.fn(async () => {
      if (down) throw lostConnection();
      return { release: vi.fn(async () => {}) };
    });
    const adapter = new CronJobAdapter({ cluster: { lock: { acquire } }, logger: log });
    await adapter.schedule('j', { type: 'interval', intervalMs: HOUR }, handler);
    await (adapter as any).runScheduled('j');
    await (adapter as any).runScheduled('j');
    expect(handler).not.toHaveBeenCalled();

    down = false;
    await (adapter as any).runScheduled('j');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0]![0]).toMatch(/answers again/);

    down = true;
    await (adapter as any).runScheduled('j');
    expect(log.warn).toHaveBeenCalledTimes(2);
    await adapter.destroy();
  });

  it('a rejected release after the fire ran is absorbed by the same one-warning latch', async () => {
    const handler = vi.fn(async () => {});
    const log = logger();
    const acquire = vi.fn(async () => ({ release: vi.fn(async () => { throw lostConnection(); }) }));
    const adapter = new CronJobAdapter({ cluster: { lock: { acquire } }, logger: log });
    await adapter.schedule('j', { type: 'interval', intervalMs: HOUR }, handler);
    await expect((adapter as any).runScheduled('j')).resolves.toBeUndefined();
    await expect((adapter as any).runScheduled('j')).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(2);
    // Release #1 fails → one warning; acquire #2 answers → info; release #2 fails → second warning.
    expect(log.warn.mock.calls.map((c) => String(c[0])).every((l) => l.includes('could not release'))).toBe(true);
    await adapter.destroy();
  });

  it('a TIMER-driven fire against a dead lock raises no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const log = logger();
      const acquire = vi.fn(async () => { throw lostConnection(); });
      const adapter = new CronJobAdapter({ cluster: { lock: { acquire } }, logger: log });
      await adapter.schedule('t', { type: 'interval', intervalMs: 10 }, vi.fn(async () => {}));
      await new Promise((r) => setTimeout(r, 120));
      await adapter.destroy();
      await new Promise((r) => setTimeout(r, 20));
      expect(acquire.mock.calls.length).toBeGreaterThan(2);
      expect(unhandled).toEqual([]);
      expect(log.warn).toHaveBeenCalledTimes(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

/**
 * A lock that behaves like the cluster drivers' `ILock` (`service-cluster`
 * `MemoryLock`, `service-cluster-redis` `RedisLock`): granted for `ttlMs`,
 * auto-released when the lease lapses, extended by the handle's `renew()`
 * while still held, and refusing to renew a lease that has already lapsed.
 * Shared by every simulated node, the way one redis is.
 */
function renewableLeasedLock() {
  const held = new Map<string, symbol>();
  const renew = vi.fn();
  const acquire = vi.fn(async (key: string, opts?: { ttlMs?: number; waitMs?: number }) => {
    if (held.has(key)) return null; // another node holds the lease
    const lease = Symbol(key);
    held.set(key, lease);
    const lapseAfter = (ms: number) => setTimeout(() => { if (held.get(key) === lease) held.delete(key); }, ms);
    let lapse = lapseAfter(opts?.ttlMs ?? 15_000);
    const isHeld = () => held.get(key) === lease;
    return {
      isHeld,
      renew: async (ttlMs?: number) => {
        renew(key, ttlMs);
        if (!isHeld()) throw new Error(`Lock "${key}" no longer held`);
        clearTimeout(lapse);
        lapse = lapseAfter(ttlMs ?? opts?.ttlMs ?? 15_000);
      },
      release: vi.fn(async () => {
        clearTimeout(lapse);
        if (isHeld()) held.delete(key);
      }),
    };
  });
  return { lock: { acquire }, acquire, renew, held };
}

describe('CronJobAdapter — a scheduled fire keeps its cluster lease alive while it runs (#31843)', () => {
  const MINUTE = 60_000;
  /** A pull on a 30 s interval; the lease is the default 60 s. */
  const PULL_TICK = 30_000;
  const logger = () => ({ warn: vi.fn(), info: vi.fn() });
  const renewWarnings = (log: ReturnType<typeof logger>) =>
    log.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('could not renew'));

  /** A handler that stays in flight until the test lets it finish. */
  function longRun() {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const handler = vi.fn(async () => { await done; });
    return { handler, finish: () => finish() };
  }

  afterEach(() => { vi.useRealTimers(); });

  it('two nodes, one lock, a run that outlasts the lease: the second node never starts the job while it runs', async () => {
    vi.useFakeTimers();
    const fence = renewableLeasedLock();
    const run = longRun();
    const nodeA = new CronJobAdapter({ cluster: { lock: fence.lock } });
    const nodeB = new CronJobAdapter({ cluster: { lock: fence.lock } });
    await nodeA.schedule('crm_pull', { type: 'interval', intervalMs: PULL_TICK }, run.handler);
    await nodeB.schedule('crm_pull', { type: 'interval', intervalMs: PULL_TICK }, run.handler);

    // Ten minutes: ten times the 60 s lease the first fire took.
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(run.handler, 'one run in flight across both nodes, not a second one once the lease would have lapsed').toHaveBeenCalledTimes(1);
    expect(fence.held.has('job:crm_pull'), 'the running fire still holds its lease').toBe(true);
    expect(fence.renew).toHaveBeenCalledWith('job:crm_pull', 60_000);

    run.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(fence.held.has('job:crm_pull'), 'the lease is released when the run settles').toBe(false);
    const renewals = fence.renew.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PULL_TICK - 1);
    expect(fence.renew, 'the heartbeat stops with the run').toHaveBeenCalledTimes(renewals);

    await nodeA.destroy();
    await nodeB.destroy();
  });

  it('a lost lease is warned about once, naming the job and the error; the run is not cancelled and still releases', async () => {
    vi.useFakeTimers();
    const log = logger();
    const release = vi.fn(async () => {});
    const renew = vi.fn(async () => { throw new Error('Lock "job:crm_pull" no longer held (fence=7)'); });
    const acquire = vi.fn(async () => ({ renew, release, isHeld: () => false }));
    const run = longRun();
    const adapter = new CronJobAdapter({ cluster: { lock: { acquire } }, logger: log });
    await adapter.schedule('crm_pull', { type: 'interval', intervalMs: HOUR }, run.handler);

    const fire = (adapter as any).runScheduled('crm_pull');
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(renew, 'a lease that is gone is not asked for again').toHaveBeenCalledTimes(1);
    const warnings = renewWarnings(log);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"job:crm_pull"');
    expect(warnings[0]).toContain('no longer held (fence=7)');
    expect(release).not.toHaveBeenCalled();

    run.finish();
    await expect(fire).resolves.toBeUndefined();
    expect(run.handler).toHaveBeenCalledTimes(1);
    expect((await adapter.getExecutions('crm_pull')).map((e) => e.status), 'the run ran to completion').toEqual(['success']);
    expect(release).toHaveBeenCalledTimes(1);
    await adapter.destroy();
  });

  it('a renewal that fails while the lease is still held warns once per failure and is retried on the next heartbeat', async () => {
    vi.useFakeTimers();
    const log = logger();
    let failures = 2;
    const renew = vi.fn(async () => {
      if (failures-- > 0) throw new Error('Connection is closed.');
    });
    const acquire = vi.fn(async () => ({ renew, release: vi.fn(async () => {}), isHeld: () => true }));
    const run = longRun();
    const adapter = new CronJobAdapter({ cluster: { lock: { acquire } }, logger: log });
    await adapter.schedule('crm_pull', { type: 'interval', intervalMs: HOUR }, run.handler);

    const fire = (adapter as any).runScheduled('crm_pull');
    // Four heartbeats of a 60 s lease (one every 20 s).
    await vi.advanceTimersByTimeAsync(80_000);

    expect(renew).toHaveBeenCalledTimes(4);
    const warnings = renewWarnings(log);
    expect(warnings, 'two failed renewals, two warnings; the two that succeeded say nothing').toHaveLength(2);
    expect(warnings.every((w) => w.includes('"job:crm_pull"') && w.includes('Connection is closed.'))).toBe(true);

    run.finish();
    await fire;
    await adapter.destroy();
  });

  it('CONTROL — a short run takes and releases the lease as before and is never renewed', async () => {
    vi.useFakeTimers();
    const fence = renewableLeasedLock();
    const handler = vi.fn(async () => { await new Promise((r) => setTimeout(r, 1_000)); });
    const log = logger();
    const adapter = new CronJobAdapter({ cluster: { lock: fence.lock }, logger: log });
    await adapter.schedule('sweep', { type: 'interval', intervalMs: PULL_TICK }, handler);

    await vi.advanceTimersByTimeAsync(5 * PULL_TICK + 2_000);

    expect(handler).toHaveBeenCalledTimes(5);
    expect(fence.acquire).toHaveBeenCalledTimes(5);
    expect(fence.acquire).toHaveBeenCalledWith('job:sweep', { ttlMs: 60_000, waitMs: 0 });
    expect(fence.renew).not.toHaveBeenCalled();
    expect(fence.held.has('job:sweep')).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it('CONTROL — a once job fires once at its deadline under the lease, unchanged', async () => {
    vi.useFakeTimers();
    const fence = renewableLeasedLock();
    const handler = vi.fn(async () => {});
    const log = logger();
    const adapter = new CronJobAdapter({ cluster: { lock: fence.lock }, logger: log });
    await adapter.schedule('once_job', { type: 'once', at: new Date(Date.now() + MINUTE).toISOString() }, handler);

    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fence.acquire).toHaveBeenCalledTimes(1);
    expect(fence.renew).not.toHaveBeenCalled();
    expect(fence.held.has('job:once_job')).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
    await adapter.destroy();
  });
});
