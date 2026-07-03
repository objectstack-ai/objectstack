// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// #2532 — durable package registration. `protocol.installPackage` writes BOTH
// package stores (in-memory registry + sys_packages via the `package` service),
// but its persistence guard used to be `pkgSvc?.publish && manifest.version` —
// silently SKIPPING every versionless runtime-created base ({id, name} from the
// builder / Setup), which is exactly why those packages vanished on restart.
// These tests pin the fixed contract: version is defaulted (never skipped) and
// uninstall drops the durable row so packages don't resurrect at boot.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './index.js';

function makeImpl(overrides?: {
  publish?: (d: { manifest: unknown; metadata: unknown }) => Promise<unknown>;
  del?: (id: string) => Promise<unknown>;
  find?: (obj: string, q: unknown) => Promise<unknown[]>;
}) {
  const registryCalls: Array<{ manifest: any; settings: any }> = [];
  const engine = {
    registry: {
      installPackage: (manifest: any, settings: any) => {
        registryCalls.push({ manifest, settings });
        return { manifest, status: 'installed', enabled: true };
      },
    },
    find: overrides?.find ?? (async () => []),
  };
  const publish = vi.fn(overrides?.publish ?? (async () => ({ success: true })));
  const del = vi.fn(overrides?.del ?? (async () => ({ success: true })));
  const services = new Map<string, any>([['package', { publish, delete: del }]]);
  const impl = new ObjectStackProtocolImplementation(engine as any, () => services);
  return { impl, registryCalls, publish, del };
}

describe('installPackage — durable persistence (#2532)', () => {
  it('persists a VERSIONLESS manifest by defaulting version (the vanish-on-restart bug)', async () => {
    const { impl, registryCalls, publish } = makeImpl();
    const res: any = await (impl as any).installPackage({
      manifest: { id: 'com.example.orders', name: '订单中心' },
    });

    // In-memory half.
    expect(registryCalls).toHaveLength(1);
    expect(registryCalls[0].manifest.version).toBe('0.1.0');
    // Durable half — the old guard skipped publish entirely for this shape.
    expect(publish).toHaveBeenCalledTimes(1);
    const persisted = publish.mock.calls[0][0] as any;
    expect(persisted.manifest.id).toBe('com.example.orders');
    expect(persisted.manifest.version).toBe('0.1.0');
    expect(res.package.status).toBe('installed');
  });

  it('keeps an explicit version untouched', async () => {
    const { impl, publish } = makeImpl();
    await (impl as any).installPackage({ manifest: { id: 'com.example.v', version: '2.3.4' } });
    expect((publish.mock.calls[0][0] as any).manifest.version).toBe('2.3.4');
  });

  it('stays non-fatal when the durable write fails (registry install already succeeded)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { impl } = makeImpl({ publish: async () => ({ success: false, error: 'boom' }) });
      const res: any = await (impl as any).installPackage({ manifest: { id: 'com.example.fail' } });
      expect(res.package.status).toBe('installed');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('persist FAILED'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('deletePackage — durable un-registration (#2532 counterpart)', () => {
  it('drops the sys_packages record so the package cannot resurrect at boot', async () => {
    const { impl, del } = makeImpl();
    await (impl as any).deletePackage({ packageId: 'com.example.orders' });
    expect(del).toHaveBeenCalledWith('com.example.orders');
  });
});
