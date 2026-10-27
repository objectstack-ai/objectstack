// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] `api-backend.rest-route-generation-tombstones`, pinned at the layers
// its oracles name. Every key of `RestServerConfig.routes` is a `retiredKey()`
// tombstone, so the item asks whether the SERVER refuses each one (a real
// RestServer, directly and through `createRestApiPlugin(...).start()`), whether
// each prescription points at a surface that exists, whether authoring the key
// is a `tsc` error too, and whether the empty block still constructs. The
// 18.2.0 Tier 1 sweep (#26468) scored the item PARTIAL: one authored value
// per key and no release-naming half (acceptance[0]), no prescription check
// (acceptance[2]), no typecheck (acceptance[3]) and no unknown-key strip
// inside `routes` (acceptance[4]).
//
// ## What each case pins
//
//   - acceptance[0]: includeObjects, excludeObjects, nameTransform at BOTH
//     former values and overrides each refuse at construction, naming
//     `routes.<key>`, RouteGenerationConfigSchema and "was removed in
//     @objectstack/spec 17";
//   - acceptance[1] / negative[0]: the same five refusals through the plugin
//     path, beside a control that boots;
//   - acceptance[2]: each prescription's replacement is in the shipped surface
//     — `enable.apiEnabled` / `enable.apiMethods` declared on the object's
//     capabilities, `crud.dataPrefix` moving the data routes of a real
//     RestServer, and `object_operation` an executable declarative endpoint
//     type;
//   - acceptance[3]: authoring each key in TypeScript fails `tsc` with a
//     diagnostic on the key's own line, beside a clean control;
//   - acceptance[4]: `routes: {}` constructs and normalizes to `{}`, and an
//     unknown key inside it is stripped rather than refused.
//
// The enforcement half of acceptance[2] (apiEnabled: false → 404,
// apiMethods → 405) is driven over HTTP by second-object-exposure.dogfood.test.ts;
// this file does not boot a stack.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RestServer, createRestApiPlugin } from '@objectstack/runtime';
import { ObjectCapabilities } from '@objectstack/spec/data';
import { ApiEndpointSchema, CrudEndpointsConfigSchema } from '@objectstack/spec/api';

const require = createRequire(import.meta.url);
const SPEC_ROOT = dirname(require.resolve('@objectstack/spec/package.json'));
const TSC = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');

/** One authored value per retired key — nameTransform at both former enum values. */
const RETIRED: Array<[key: string, value: unknown]> = [
  ['includeObjects', ['showcase_account']],
  ['excludeObjects', ['sys_log']],
  ['nameTransform', 'none'],
  ['nameTransform', 'plural'],
  ['overrides', { showcase_account: { enabled: false } }],
];

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
  };
}

function construct(config: Record<string, unknown>): RestServer {
  const rest = new RestServer(mockServer() as any, mockProtocol() as any, { api: { requireAuth: false }, ...config } as any);
  rest.registerRoutes();
  return rest;
}

function refusalOf(config: Record<string, unknown>): string {
  try {
    construct(config);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`constructed cleanly with ${JSON.stringify(config)} — a tombstone was stripped instead of refused`);
}

/** The plugin's start context: just enough for `start()` to build a REST server. */
function bootCtx() {
  const services: Record<string, unknown> = { 'http.server': mockServer(), protocol: mockProtocol() };
  return {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name in services) return services[name];
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map(Object.entries(services))),
    hook: vi.fn(),
    trigger: vi.fn().mockResolvedValue(undefined),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getKernel: vi.fn(),
  } as any;
}

function expectRefusal(message: string, key: string) {
  expect(message).toContain('`routes` does not satisfy `RouteGenerationConfigSchema`');
  expect(message).toContain(`\`routes.${key}\` was removed in @objectstack/spec 17`);
}

describe('[#26572] rest-route-generation-tombstones — every retired selector refuses, on every door', () => {
  it('acceptance[0]: each key refuses at construction, whatever value is authored', () => {
    for (const [key, value] of RETIRED) {
      expectRefusal(refusalOf({ routes: { [key]: value } }), key);
    }
  });

  it('acceptance[1]: the same refusals survive the plugin path, beside a control that boots', async () => {
    const control = createRestApiPlugin({ api: { routes: {} } } as any);
    await expect(control.start!(bootCtx())).resolves.toBeUndefined();

    for (const [key, value] of RETIRED) {
      const plugin = createRestApiPlugin({ api: { routes: { [key]: value } } } as any);
      let message: string | undefined;
      try {
        await plugin.start!(bootCtx());
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, `plugin path started with routes.${key} — the tombstone was stripped`).toBeDefined();
      expectRefusal(message!, key);
    }
  });

  it('acceptance[2]: each prescription names a surface that exists in the shipped spec and server', () => {
    // Exposure moved onto the object: both keys are DECLARED (the capabilities
    // object is strict, so an undeclared key would be refused, not kept).
    const caps = ObjectCapabilities.parse({ apiEnabled: false, apiMethods: ['get', 'list'] });
    expect(caps).toMatchObject({ apiEnabled: false, apiMethods: ['get', 'list'] });
    expect(() => ObjectCapabilities.parse({ apiExcluded: true })).toThrow();
    for (const key of ['includeObjects', 'excludeObjects', 'overrides']) {
      const message = refusalOf({ routes: { [key]: key === 'overrides' ? {} : [] } });
      expect(message).toContain('`enable.apiEnabled');
      expect(message).toContain('`enable.apiMethods`');
    }

    // The base path is `crud.dataPrefix`, and a real server moves its data routes by it.
    expect(refusalOf({ routes: { overrides: {} } })).toContain('`crud.dataPrefix`');
    expect(CrudEndpointsConfigSchema.parse({ dataPrefix: '/records' }).dataPrefix).toBe('/records');
    const moved = construct({ crud: { dataPrefix: '/records' } }).getRoutes().map((r: any) => r.path);
    expect(moved).toContain('/api/v1/records/:object');
    expect(moved.filter((p: string) => p.startsWith('/api/v1/data/'))).toEqual([]);

    // The object name is the path segment: the data routes take `:object`, no transform.
    expect(refusalOf({ routes: { nameTransform: 'none' } })).toContain('the object `name` is the canonical id on every surface');
    expect(construct({}).getRoutes().map((r: any) => r.path)).toContain('/api/v1/data/:object/:id');

    // A custom path is a declarative `api` endpoint, and object_operation is an executable type.
    expect(refusalOf({ routes: { overrides: {} } })).toContain('a declarative `api` endpoint');
    const endpoint = ApiEndpointSchema.parse({
      name: 'custom_accounts',
      path: '/custom/accounts',
      method: 'GET',
      type: 'object_operation',
      objectParams: { object: 'showcase_account', operation: 'find' },
    });
    expect(endpoint.type).toBe('object_operation');
  });

  it('acceptance[4]: `routes: {}` constructs and normalizes to {}, and an unknown key inside it is stripped', () => {
    const empty = construct({ routes: {} }) as unknown as { config: { routes: unknown } };
    expect(empty.config.routes).toEqual({});

    const unknown = construct({ routes: { someUnknownKey: 1 } }) as unknown as { config: { routes: unknown } };
    expect(unknown.config.routes).toEqual({});
  });
});

describe('[#26572] rest-route-generation-tombstones — acceptance[3]: authoring a retired key is a tsc error', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-26572-tsc-'));
    mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
    symlinkSync(SPEC_ROOT, join(dir, 'node_modules', '@objectstack', 'spec'), 'dir');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tsc-26572', type: 'module', private: true }));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, skipLibCheck: true, types: [],
        module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022',
      },
      include: ['*.ts'],
    }));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** Type-check one authored config; the key sits on line 3 of the file. */
  function typecheck(file: string, routes: string) {
    writeFileSync(join(dir, file), [
      "import type { RestServerConfig } from '@objectstack/spec/api';",
      'export const config: RestServerConfig = { routes: {',
      `  ${routes}`,
      '} };',
      '',
    ].join('\n'));
    const run = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: dir, encoding: 'utf8' });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  }

  it('control: the empty block typechecks clean', () => {
    const empty = typecheck('control.ts', '');
    expect(empty.status, empty.out).toBe(0);
  });

  it.each([
    ['include-objects.ts', "includeObjects: ['showcase_account'],"],
    ['exclude-objects.ts', "excludeObjects: ['sys_log'],"],
    ['name-transform-none.ts', "nameTransform: 'none',"],
    ['name-transform-plural.ts', "nameTransform: 'plural',"],
    ['overrides.ts', 'overrides: { showcase_account: { enabled: false } },'],
  ])('%s fails tsc on the key\'s own line', (file, routes) => {
    rmSync(join(dir, 'control.ts'), { force: true });
    const res = typecheck(file, routes);
    try {
      expect(res.status, res.out).not.toBe(0);
      expect(res.out).toMatch(new RegExp(`${file.replace('.', '\\.')}\\(3,\\d+\\): error TS\\d+`));
      // The retiredKey input type names the retirement in the diagnostic itself.
      expect(res.out).toContain('[REMOVED] Key retired');
    } finally {
      rmSync(join(dir, file), { force: true });
    }
  });
});
