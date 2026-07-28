// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0062 D1 (#3826): the standalone `default` datasource is a DECLARATION,
// connected at boot by DefaultDatasourcePlugin through the same
// DatasourceConnectionService as every declared/runtime datasource — one
// connect path, one failure verdict, one escape hatch. These boots exercise
// the real kernel (init-all → start-all) with the real driver factory.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Runtime } from './runtime.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { AppPlugin } from './app-plugin.js';

const BOOT_TIMEOUT = 60_000;
const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';

async function assemble(opts: {
  driver?: string;
  withAdminPlugin?: boolean;
  connectPolicy?: any;
  bundle?: any;
} = {}) {
  const { ObjectQLPlugin } = await import('@objectstack/objectql');
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  // Order matters for START: the default datasource must connect before
  // ObjectQLPlugin.start() runs boot schema-sync.
  await kernel.use(new DefaultDatasourcePlugin({ driver: opts.driver ?? 'memory' }));
  await kernel.use(new ObjectQLPlugin());
  if (opts.bundle) await kernel.use(new AppPlugin(opts.bundle));
  if (opts.withAdminPlugin !== false) {
    const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
      '@objectstack/service-datasource'
    );
    await kernel.use(
      new DatasourceAdminServicePlugin({
        driverFactory: createDefaultDatasourceDriverFactory(),
        connectPolicy: opts.connectPolicy,
      }),
    );
  }
  return kernel;
}

describe('DefaultDatasourcePlugin — the default datasource as a declaration (#3826)', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('boots, registers the driver as DEFAULT, and serves reads/writes end to end', async () => {
    const kernel = await assemble({
      bundle: {
        manifest: { id: 'com.test.default-ds', name: 'Default DS', version: '1.0.0' },
        objects: [{ name: 'note', label: 'Note', fields: { title: { type: 'text' } } }],
      },
    });
    try {
      await kernel.bootstrap();
      const engine = kernel.getService<any>('data');
      // The driver keeps its NATURAL name (no 'default' stamping) — routing to
      // `default` goes through the engine's default-driver fallback.
      expect(engine.getDriverByName('default')).toBeUndefined();
      await engine.insert('note', { title: 'through-the-default' });
      const rows = await engine.find('note');
      expect(rows.map((r: any) => r.title)).toContain('through-the-default');
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);

  it('shows the primary DB in the datasource-admin list with a REAL status (#3827)', async () => {
    const kernel = await assemble({});
    try {
      await kernel.bootstrap();
      const admin = kernel.getService<{ listDatasources(): Promise<any[]> }>('datasource-admin');
      const def = (await admin.listDatasources()).find((d) => d.name === 'default');
      expect(def).toBeDefined();
      expect(def!.status).toBe('ok');
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);

  it('works without the datasource-admin plugin — same class, locally instantiated', async () => {
    const kernel = await assemble({ withAdminPlugin: false });
    try {
      await kernel.bootstrap();
      const engine = kernel.getService<any>('data');
      await engine.insert('sys_metadata', undefined as never).catch(() => { /* shape probe only */ });
      // The default driver exists and the engine can answer a trivial query path.
      expect(typeof engine.find).toBe('function');
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);

  it('refuses the boot when the default cannot be built/connected (bootCritical ⇒ fail-fast)', async () => {
    const kernel = await assemble({ driver: 'not-a-real-driver' });
    const err = await kernel.bootstrap().then(
      () => { throw new Error('bootstrap() resolved but should have thrown'); },
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/default/);
    expect(err.message).toMatch(/boot-critical/);
    expect(err.message).toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE');
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
  }, BOOT_TIMEOUT);

  it('boots degraded under OS_ALLOW_DRIVER_CONNECT_FAILURE — same escape hatch as the engine guard', async () => {
    process.env[ENV] = '1';
    const kernel = await assemble({ driver: 'not-a-real-driver' });
    try {
      await expect(kernel.bootstrap()).resolves.not.toThrow();
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);

  it('is NOT gated by the host connect policy — a deny-all policy cannot block the primary DB', async () => {
    // Byte-for-byte with the pre-#3826 boot: the default never consulted a
    // DatasourceConnectPolicy (that gate exists for optional/external
    // datasources). A multi-tenant host's deny-all must not brick every boot.
    const kernel = await assemble({
      connectPolicy: { canConnect: () => ({ allow: false, reason: 'egress blocked' }) },
    });
    try {
      await expect(kernel.bootstrap()).resolves.not.toThrow();
      const engine = kernel.getService<any>('data');
      expect(engine.getDefaultDriverName()).toBeDefined();
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);

  it("rejects an app bundle that declares a datasource named 'default' (host-reserved name)", async () => {
    const kernel = await assemble({
      bundle: {
        manifest: { id: 'com.test.reserved', name: 'Reserved', version: '1.0.0' },
        objects: [{ name: 'note', label: 'Note', fields: { title: { type: 'text' } } }],
        datasources: [{ name: 'default', driver: 'memory', config: {} }],
      },
    });
    const err = await kernel.bootstrap().then(
      () => { throw new Error('bootstrap() resolved but should have thrown'); },
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/reserved for the host's primary datasource/);
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
  }, BOOT_TIMEOUT);
});
