// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: the artifact-serve path (`objectstack dev`/`serve`/`start`
// booting from `dist/objectstack.json`, no host `objectstack.config.ts`) must
// surface the artifact's app-declared RBAC — `permissions[]` and `positions[]`
// — at the top level of the returned stack config. The CLI reads
// `config.permissions` to honour an app-declared default profile (ADR-0056 D7 —
// `appDefaultPermissionSetName` → SecurityPlugin `fallbackPermissionSet`); the
// positions are distributed through `sys_user_position`, never as organization
// roles (ADR-0108). Before this was fixed, `createStandaloneStack`
// surfaced `objects`/`requires`/`manifest` but dropped `permissions`/`roles`, so
// an `isDefault` profile carrying e.g. `readScope: 'unit_and_below'` was silently
// ignored under `objectstack dev` and every user fell back to the built-in
// owner-only `member_default`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneStack } from './standalone-stack.js';
import { createDefaultHostConfig } from './default-host.js';

// A minimal `objectstack build` artifact carrying an app-declared default
// profile with a hierarchy read scope, an add-on permission set, app roles,
// plus the metadata the path already surfaced (objects/requires/manifest).
const ARTIFACT = {
  manifest: { id: 'com.test.scope-app', name: 'Scope App', version: '1.0.0' },
  requires: ['auth'],
  objects: [{ name: 'note', label: 'Note', fields: { title: { type: 'text' } } }],
  positions: [
    { name: 'manager', label: 'Manager' },
    { name: 'contributor', label: 'Contributor' },
  ],
  permissions: [
    {
      name: 'app_member_default',
      label: 'App Member (Default)',
      isDefault: true,
      objects: {
        note: { allowRead: true, allowCreate: true, readScope: 'unit_and_below', writeScope: 'unit' },
      },
    },
    {
      name: 'app_contributor',
      label: 'Contributor add-on',
      objects: { note: { allowEdit: true } },
    },
  ],
};

// Mirrors `appDefaultPermissionSetName` from @objectstack/plugin-security (not a
// runtime dependency, so the resolution rule is reproduced here): the first
// first `isDefault` permission set's name (ADR-0090 D5).
function appDefaultPermissionSetName(permissions: unknown): string | undefined {
  if (!Array.isArray(permissions)) return undefined;
  for (const p of permissions) {
    if (p && typeof p === 'object') {
      const ps = p as { name?: unknown; isDefault?: unknown };
      if (ps.isDefault === true && typeof ps.name === 'string' && ps.name.length > 0) {
        return ps.name;
      }
    }
  }
  return undefined;
}

// The first createStandaloneStack call cold-loads heavy deps (objectql,
// metadata, driver-memory) via dynamic import — on a cold CI worker that can
// exceed vitest's default 5s test timeout. Do the one-time boot in beforeAll
// (with a generous timeout) and have the assertion cases read the result.
const BOOT_TIMEOUT = 60_000;

describe('createStandaloneStack — surfaces app RBAC from the artifact (ADR-0056 D7)', () => {
  let dir: string;
  let artifactPath: string;
  let result: Awaited<ReturnType<typeof createStandaloneStack>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-standalone-rbac-'));
    artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(ARTIFACT), 'utf-8');
    result = await createStandaloneStack({ artifactPath, databaseUrl: 'memory://standalone-rbac' });
  }, BOOT_TIMEOUT);
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  it('surfaces permissions[] (with isDefault profile + readScope) at the top level', () => {
    expect(Array.isArray(result.permissions)).toBe(true);
    expect(result.permissions!.map((p: any) => p.name).sort()).toEqual(['app_contributor', 'app_member_default']);
    const def = result.permissions!.find((p: any) => p.name === 'app_member_default');
    expect(def.isDefault).toBe(true);
    // the hierarchy read scope must ride through intact — this is what was lost.
    expect(def.objects.note.readScope).toBe('unit_and_below');
  });

  it('surfaces positions[] at the top level', () => {
    expect(Array.isArray(result.positions)).toBe(true);
    expect(result.positions!.map((r: any) => r.name).sort()).toEqual(['contributor', 'manager']);
  });

  it('still surfaces objects/requires/manifest (no regression)', () => {
    expect(result.requires).toEqual(['auth']);
    expect(result.objects!.map((o: any) => o.name)).toEqual(['note']);
    expect(result.manifest?.id).toBe('com.test.scope-app');
  });

  it('the surfaced config drives appDefaultPermissionSetName → the app profile (the exact CLI wiring)', () => {
    // Reproduce serve.ts: `config = { ...originalConfig, ...standaloneStack }`,
    // then `appDefaultPermissionSetName(config.permissions)` → SecurityPlugin fallback.
    const config: any = { ...{}, ...result };
    expect(appDefaultPermissionSetName(config.permissions)).toBe('app_member_default');
  });

  it('createDefaultHostConfig (the actual serve artifact-fallback) surfaces the same', async () => {
    const r = await createDefaultHostConfig({
      requireArtifact: true,
      artifactPath,
      databaseUrl: 'memory://standalone-rbac',
    });
    expect(appDefaultPermissionSetName(r.permissions)).toBe('app_member_default');
    expect(r.positions!.map((x: any) => x.name).sort()).toEqual(['contributor', 'manager']);
  }, BOOT_TIMEOUT);
});

// #3955 — the standalone boot must share the serve/dev boot's locale-gated
// pinyin decision. `os migrate plan`/`apply` boot through this factory with the
// compiled artifact as the ONLY config in sight; before the stamp below, that
// boot resolved `resolveSearchPinyinEnabled()` env-first-only → off, computed a
// schema view WITHOUT the `__search` companion columns the dev runtime
// provisions, and reported every live companion column of a dev-created
// database as a destructive orphan (`drop_column`).
describe('createStandaloneStack — stamps the locale-derived pinyin decision from the artifact (#3955)', () => {
  const originalEnv = process.env.OS_SEARCH_PINYIN_ENABLED;
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-standalone-pinyin-'));
  });
  afterAll(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    if (originalEnv === undefined) delete process.env.OS_SEARCH_PINYIN_ENABLED;
    else process.env.OS_SEARCH_PINYIN_ENABLED = originalEnv;
  });

  function writeArtifact(name: string, i18n?: unknown): string {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify({ ...ARTIFACT, ...(i18n ? { i18n } : {}) }), 'utf-8');
    return p;
  }

  it('a zh-* locale in the artifact stamps OS_SEARCH_PINYIN_ENABLED before plugins boot, and i18n is surfaced', async () => {
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
    const i18n = { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' };
    const result = await createStandaloneStack({
      artifactPath: writeArtifact('zh.objectstack.json', i18n),
      databaseUrl: 'memory://standalone-pinyin-zh',
    });
    // The stamp is what each engine's SchemaRegistry (constructed later, at
    // kernel start, without config access) reads to decide whether to
    // provision the `__search` companion column.
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBe('true');
    // And the config-shaped result carries i18n like requires/objects/manifest,
    // so the CLI artifact-serve merge sees the same stack config keys.
    expect(result.i18n).toEqual(i18n);
  }, BOOT_TIMEOUT);

  it('a non-Chinese artifact leaves the env untouched (companion stays off)', async () => {
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
    await createStandaloneStack({
      artifactPath: writeArtifact('en.objectstack.json', { defaultLocale: 'en', supportedLocales: ['en'] }),
      databaseUrl: 'memory://standalone-pinyin-en',
    });
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBeUndefined();
  }, BOOT_TIMEOUT);

  it('an explicit OS_SEARCH_PINYIN_ENABLED=false survives a zh-* artifact (operator override wins)', async () => {
    process.env.OS_SEARCH_PINYIN_ENABLED = 'false';
    await createStandaloneStack({
      artifactPath: writeArtifact('zh-override.objectstack.json', { supportedLocales: ['zh-CN'] }),
      databaseUrl: 'memory://standalone-pinyin-override',
    });
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBe('false');
  }, BOOT_TIMEOUT);
});

// ADR-0062 D1 (#3826) — the standalone `default` datasource is a DECLARATION.
// The stack no longer constructs a driver: it translates the database URL into
// a `{ driver, config }` definition carried by `DefaultDatasourcePlugin`, which
// connects it at boot through the shared `DatasourceConnectionService`. These
// tests verify (a) the URL → definition translation per kind, and (b) that the
// definition round-trips through the SAME shared factory the plugin uses at
// boot (connect → syncSchema → create → find) — without booting the full
// kernel (the MetadataPlugin file-artifact boot doesn't play well with
// vitest's module runner; the full-kernel path is covered by
// `default-datasource-plugin.test.ts`). postgres/mongodb need a live server,
// so they're covered by the factory's own usage + the runtime-admin path.
describe('createStandaloneStack — default datasource declared, built via the shared factory (ADR-0062 D1)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'os-standalone-driver-')); });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  const NOTE = { name: 'note', fields: { id: { type: 'text' }, title: { type: 'text' } } };

  function defaultDefOf(stack: Awaited<ReturnType<typeof createStandaloneStack>>): {
    plugin: any;
    def: { driver: string; config?: Record<string, unknown> };
  } {
    const plugin = stack.plugins.find((p: any) => p?.name === 'com.objectstack.runtime.default-datasource');
    expect(plugin, 'stack must carry the DefaultDatasourcePlugin').toBeDefined();
    return { plugin, def: (plugin as any).def };
  }

  async function definitionRoundTrip(
    cfg: Parameters<typeof createStandaloneStack>[0],
  ): Promise<{ driverId: string; kind: string | undefined; titles: string[] }> {
    const stack = await createStandaloneStack(cfg);
    const { def } = defaultDefOf(stack);
    const { createDefaultDatasourceDriverFactory } = await import('@objectstack/service-datasource');
    const handle: any = await createDefaultDatasourceDriverFactory({ dev: false }).create({
      driver: def.driver,
      config: def.config ?? {},
    });
    const driver = handle.driver ?? handle;
    const kind = driver?.constructor?.name as string | undefined;
    await driver.connect?.();
    try {
      await driver.syncSchema('note', NOTE);
      await driver.create('note', { id: 'n1', title: 'hello-driver' });
      const rows = (await driver.find('note', {})) as Array<{ title?: string }>;
      return { driverId: def.driver, kind, titles: rows.map((r) => r.title as string) };
    } finally {
      try { await driver.disconnect?.(); } catch { /* noop */ }
    }
  }

  it('memory:// → declares driver "memory"; factory builds InMemoryDriver that round-trips', async () => {
    const r = await definitionRoundTrip({ databaseUrl: 'memory://default-driver' });
    expect(r.driverId).toBe('memory');
    expect(r.kind).toMatch(/InMemoryDriver$/);
    expect(r.titles).toContain('hello-driver');
  }, BOOT_TIMEOUT);

  it('file: → declares driver "sqlite" with the file path; factory builds SqlDriver that round-trips', async () => {
    const r = await definitionRoundTrip({ databaseUrl: `file:${join(dir, 'better.db')}` });
    expect(r.driverId).toBe('sqlite');
    expect(r.kind).toMatch(/SqlDriver$/);
    expect(r.titles).toContain('hello-driver');
  }, BOOT_TIMEOUT);

  it('databaseDriver:sqlite-wasm → declares driver "sqlite-wasm"; factory builds SqliteWasmDriver that round-trips', async () => {
    const r = await definitionRoundTrip({ databaseDriver: 'sqlite-wasm', databaseUrl: `file:${join(dir, 'wasm.db')}` });
    expect(r.driverId).toBe('sqlite-wasm');
    expect(r.kind).toMatch(/SqliteWasmDriver$/);
    expect(r.titles).toContain('hello-driver');
  }, BOOT_TIMEOUT);

  it('the DefaultDatasourcePlugin precedes ObjectQLPlugin (schema sync needs the driver)', async () => {
    const stack = await createStandaloneStack({ databaseUrl: 'memory://default-order' });
    const names = stack.plugins.map((p: any) => String(p?.name ?? p?.constructor?.name ?? ''));
    const dsIdx = names.indexOf('com.objectstack.runtime.default-datasource');
    const qlIdx = names.findIndex((n: string) => /objectql/i.test(n));
    expect(dsIdx).toBeGreaterThanOrEqual(0);
    expect(qlIdx).toBeGreaterThan(dsIdx);
  }, BOOT_TIMEOUT);
});
