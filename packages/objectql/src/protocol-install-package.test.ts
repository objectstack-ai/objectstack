// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * ADR-0033 package-subsystem consolidation — `protocol.installPackage` is the
 * single canonical write primitive. It must land a package in BOTH the
 * in-memory registry (what the dispatcher's `/api/v1/packages` and
 * `getMetaItems({type:'package'})` read → Studio's selector) AND the durable
 * `sys_packages` table via the optional `package` service.
 */
function makeProtocol(opts: { pkgSvc?: unknown } = {}) {
  const installed: Array<{ manifest: { id: string } }> = [];
  const registry = {
    installPackage: vi.fn((manifest: { id: string }) => {
      const pkg = { manifest, status: 'installed', enabled: true };
      installed.push(pkg);
      return pkg;
    }),
    getPackage: vi.fn((id: string) => installed.find((p) => p.manifest.id === id)),
  };
  const engine = { registry } as never;
  const services = new Map<string, unknown>();
  if (opts.pkgSvc) services.set('package', opts.pkgSvc);
  const protocol = new ObjectStackProtocolImplementation(engine, () => services);
  return { protocol, registry };
}

describe('protocol.installPackage (ADR-0033 consolidation)', () => {
  it('writes the in-memory registry AND persists via the package service', async () => {
    const publish = vi.fn(async () => ({ success: true }));
    const { protocol, registry } = makeProtocol({ pkgSvc: { publish } });
    const manifest = { id: 'app.demo', name: 'Demo', version: '1.0.0', type: 'application' };

    const res = (await protocol.installPackage({ manifest } as never)) as {
      package: { manifest: { id: string } };
      message: string;
    };

    expect(registry.installPackage).toHaveBeenCalledWith(manifest, undefined);
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0] as unknown[])[0]).toMatchObject({ manifest });
    expect(res.package.manifest.id).toBe('app.demo');
    expect(res.message).toContain('app.demo');
  });

  it('forwards install-time settings to the registry', async () => {
    const { protocol, registry } = makeProtocol();
    const manifest = { id: 'app.s', name: 'S', version: '1.0.0', type: 'application' };
    await protocol.installPackage({ manifest, settings: { theme: 'dark' } } as never);
    expect(registry.installPackage).toHaveBeenCalledWith(manifest, { theme: 'dark' });
  });

  it('still registers in-memory when no package service is present (non-fatal)', async () => {
    const { protocol, registry } = makeProtocol();
    const manifest = { id: 'app.nopkg', name: 'NoPkg', version: '1.0.0', type: 'application' };

    const res = (await protocol.installPackage({ manifest } as never)) as {
      package: { manifest: { id: string } };
    };

    expect(registry.installPackage).toHaveBeenCalledOnce();
    expect(res.package.manifest.id).toBe('app.nopkg');
  });

  it('does not throw and keeps the registry write when persistence rejects', async () => {
    const publish = vi.fn(async () => {
      throw new Error('db down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { protocol, registry } = makeProtocol({ pkgSvc: { publish } });
    const manifest = { id: 'app.err', name: 'Err', version: '1.0.0', type: 'application' };

    const res = (await protocol.installPackage({ manifest } as never)) as {
      package: { manifest: { id: string } };
    };

    expect(registry.installPackage).toHaveBeenCalledOnce();
    expect(res.package.manifest.id).toBe('app.err');
    warn.mockRestore();
  });

  it('skips persistence when the manifest has no version (cannot key sys_packages)', async () => {
    const publish = vi.fn(async () => ({ success: true }));
    const { protocol, registry } = makeProtocol({ pkgSvc: { publish } });
    const manifest = { id: 'app.nov', name: 'NoVer', type: 'application' };

    await protocol.installPackage({ manifest } as never);

    expect(registry.installPackage).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
});
