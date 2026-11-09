import { describe, it, expect, vi } from 'vitest';
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
