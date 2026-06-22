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
