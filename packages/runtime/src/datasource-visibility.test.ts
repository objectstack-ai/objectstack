// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Reproduction + regression (ADR-0015 §18, follow-up from #2111): a code-defined
// external datasource declared in `defineStack({ datasources: [...] })` — stamped
// `origin: 'code'` at compile time — must be VISIBLE through the runtime metadata
// surfaces on the standalone / config-load (`os dev`/`serve`) path:
//
//   • datasource-admin `listDatasources()`             -> backs GET /api/v1/datasources
//   • `protocol.getMetaItems({ type: 'datasource' })`  -> backs GET /api/v1/meta/datasource
//   • the `metadata` service's `list('datasource')`    -> the source both of the above read
//
// AppPlugin registers code datasources via `metadata.registerInMemory('datasource', ...)`
// at start(). This boots the HOST-CONFIG shape (instantiated plugins, NO
// MetadataPlugin) so the kernel auto-injects its in-memory `metadata` fallback —
// the exact shape `examples/app-showcase` boots under `os dev` (its config carries
// instantiated connector plugins, so `isHostConfig` is true and the lightweight
// assembler runs instead of createStandaloneStack/MetadataPlugin).
//
// Before the fix, the fallback (packages/core/src/fallbacks/memory-metadata.ts)
// lacked `registerInMemory`, so AppPlugin's
// `typeof metadata?.registerInMemory === 'function'` guard was false and the
// datasource registration was skipped entirely — both surfaces returned [].

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Runtime } from './runtime.js';
import { DriverPlugin } from './driver-plugin.js';
import { AppPlugin } from './app-plugin.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/driver-sqlite-wasm';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

// A minimal compiled artifact carrying ONE code-defined external datasource
// (origin stamped by `defineDatasource` at compile time) plus a single object.
const ARTIFACT = {
  manifest: { id: 'com.test.ds-visibility', name: 'DS Visibility', version: '1.0.0' },
  objects: [{ name: 'note', label: 'Note', fields: { title: { type: 'text' } } }],
  datasources: [
    {
      name: 'showcase_external',
      label: 'External Analytics (SQLite)',
      driver: 'sqlite',
      schemaMode: 'external',
      origin: 'code',
      config: { filename: ':memory:' },
      external: { allowWrites: false },
      active: true,
    },
  ],
};

const BOOT_TIMEOUT = 60_000;

describe('code-defined datasource visibility (ADR-0015 §18)', () => {
  let kernel: ReturnType<Runtime['getKernel']>;

  beforeAll(async () => {
    const { ObjectQLPlugin } = await import('@objectstack/objectql');
    const { SqliteWasmDriver } = await import('@objectstack/driver-sqlite-wasm');
    const { DatasourceAdminServicePlugin } = await import('@objectstack/service-datasource');

    // Host-config shape: NO MetadataPlugin — the kernel auto-injects its
    // in-memory `metadata` fallback (CORE_FALLBACK_FACTORIES.metadata).
    const runtime = new Runtime({ cluster: false });
    kernel = runtime.getKernel();
    await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AppPlugin(ARTIFACT));
    await kernel.use(new DatasourceAdminServicePlugin({}));
    await kernel.bootstrap();
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
  });

  it('metadata.list("datasource") surfaces the code datasource (shared source)', async () => {
    const metadata = kernel.getService<{ list(t: string): Promise<any[]> }>('metadata');
    const list = await metadata.list('datasource');
    expect(list.map((d) => d?.name)).toContain('showcase_external');
    expect(list.find((d) => d?.name === 'showcase_external')?.origin).toBe('code');
  });

  it('GET /api/v1/datasources backing: datasource-admin.listDatasources() includes the code datasource', async () => {
    const admin = kernel.getService<{ listDatasources(): Promise<any[]> }>('datasource-admin');
    const list = await admin.listDatasources();
    const ds = list.find((d) => d?.name === 'showcase_external');
    expect(ds).toBeDefined();
    expect(ds?.origin).toBe('code');
  });

  it('GET /api/v1/meta/datasource backing: protocol.getMetaItems({type:"datasource"}) includes the code datasource', async () => {
    const protocol = kernel.getService<{ getMetaItems(r: { type: string }): Promise<any> }>('protocol');
    const res = await protocol.getMetaItems({ type: 'datasource' });
    const items: any[] = Array.isArray(res) ? res : (res?.items ?? []);
    expect(items.map((d) => d?.name)).toContain('showcase_external');
  });
});
