// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: the artifact-serve path (`objectstack dev`/`serve`/`start`
// booting from `dist/objectstack.json`, no host `objectstack.config.ts`) must
// surface the artifact's app-declared RBAC — `permissions[]` and `positions[]`
// — at the top level of the returned stack config. The CLI reads
// `config.permissions` to honour an app-declared default profile (ADR-0056 D7 /
// ADR-0090 D5 — `appSecurityPluginOptions(config)` → SecurityPlugin
// `fallbackPermissionSet`, one resolution for every boot path since #7001); the
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
import { createDefaultHostConfig, resolveDefaultArtifactPath } from './default-host.js';
// The REAL resolution, imported — not reproduced. `@objectstack/plugin-security`
// is a plain `dependencies` entry of this package (and another test in this same
// package, src/domains/share-links-enforcement-context.test.ts, already imports
// SecurityPlugin from it), so the "not a runtime dependency" that once justified
// hand-copying the rule here does not hold. #7092: the copy WAS the defect —
// a case titled "the exact CLI wiring" that could only ever prove a duplicate of
// the rule equals itself, and would have stayed green through any change to the
// real helper (last-`isDefault` instead of first, an anchor pre-filter, a shape
// change) while `objectstack dev`/`serve` did something else.
//
// `appSecurityPluginOptions` is the anchor rather than the bare name helper
// because it is what `serve.ts` actually calls today (#7001):
// `new SecurityPlugin(appSecurityPluginOptions(config))`. That construction —
// serve's side of it, and its parity with `bootStack` — is pinned in
// packages/cli/src/commands/serve-verify-security-parity.contract.test.ts; the
// helper's own contract (first-`isDefault` wins, the undefined-vs-`{...undefined}`
// distinction, top-level-only) in
// packages/plugins/plugin-security/src/app-default-permission-set.test.ts. What
// neither of those can see, and what THIS file owns, is the composition: that the
// config `createStandaloneStack` / `createDefaultHostConfig` actually return is a
// config that resolution reads correctly.
import { appDefaultPermissionSetName, appSecurityPluginOptions } from '@objectstack/plugin-security';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/service-datasource';

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
  // Declaration order is deliberate and load-bearing (#7092): the NON-default set
  // comes FIRST, so the resolution cases below discriminate `isDefault` rather
  // than agreeing with "take permissions[0]". With the default set first, a
  // resolution that had degenerated to the first entry would have been green.
  permissions: [
    {
      name: 'app_contributor',
      label: 'Contributor add-on',
      objects: { note: { allowEdit: true } },
    },
    {
      name: 'app_member_default',
      label: 'App Member (Default)',
      isDefault: true,
      objects: {
        note: { allowRead: true, allowCreate: true, readScope: 'unit_and_below', writeScope: 'unit' },
      },
    },
  ],
};

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

  it('surfaces permissions[] (with isDefault profile + readScope) at the top level, in DECLARATION order', () => {
    expect(Array.isArray(result.permissions)).toBe(true);
    // Unsorted, on purpose. `appDefaultPermissionSetName` resolves the FIRST
    // `isDefault` set, so "which order does the artifact's array arrive in" is a
    // precondition of that rule, not a presentation detail — and it is this
    // package's half of it. A `.sort()` here erases exactly the property the
    // resolution depends on (#7092).
    expect(result.permissions!.map((p: any) => p.name)).toEqual(['app_contributor', 'app_member_default']);
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

  it('the surfaced config feeds the REAL appSecurityPluginOptions → the app profile', () => {
    // Reproduce serve.ts's merge: `config = { ...originalConfig, ...standaloneStack }`,
    // then `new SecurityPlugin(appSecurityPluginOptions(config))`.
    const config: any = { ...{}, ...result };
    // The whole constructor argument, deep-equalled — the OPTIONS shape is the
    // half that was a decision (`name ? { fallbackPermissionSet: name }
    // : undefined`), so asserting only the name would leave it unmeasured here.
    expect(appSecurityPluginOptions(config)).toEqual({ fallbackPermissionSet: 'app_member_default' });
    // …and the name half, read off the surfaced array exactly as the helper does.
    // `app_contributor` sits ahead of it in the artifact, so this is a real
    // discrimination on `isDefault`, not agreement with permissions[0].
    expect(appDefaultPermissionSetName(config.permissions)).toBe('app_member_default');
  });

  it('createDefaultHostConfig (the actual serve artifact-fallback) surfaces the same', async () => {
    const r = await createDefaultHostConfig({
      requireArtifact: true,
      artifactPath,
      databaseUrl: 'memory://standalone-rbac',
    });
    expect(appSecurityPluginOptions(r)).toEqual({ fallbackPermissionSet: 'app_member_default' });
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

  // The composition ships both plugins, with the datasource ahead of the engine
  // in the array. That LIST SHAPE is all this asserts — it is NOT what orders
  // them, and this test's previous title ("…precedes ObjectQLPlugin (schema sync
  // needs the driver)") claimed otherwise. The kernel resolves init and start
  // order from the dependency graph, which HOISTS ObjectQLPlugin ahead of the
  // datasource plugin on a real boot (measured: objectql inits 6 slots earlier).
  // Pinning an array index as if it were the guarantee is how #4085 happened —
  // a reader trusts the index, moves a plugin, and nothing fails.
  it('composes the default datasource alongside the engine', async () => {
    const stack = await createStandaloneStack({ databaseUrl: 'memory://default-order' });
    const names = stack.plugins.map((p: any) => String(p?.name ?? p?.constructor?.name ?? ''));
    const dsIdx = names.indexOf('com.objectstack.runtime.default-datasource');
    const qlIdx = names.findIndex((n: string) => /objectql/i.test(n));
    expect(dsIdx).toBeGreaterThanOrEqual(0);
    expect(qlIdx).toBeGreaterThanOrEqual(0);
  }, BOOT_TIMEOUT);

  // …and THIS is the guarantee. The driver exists before boot schema-sync
  // because the datasource plugin connects in `init()` (Phase 1 completes before
  // ANY `start()` runs) and declares a hard dependency on ObjectQL, so the engine
  // is registered by the time that init runs. Delete the declaration and the
  // kernel stops ordering the two inits — which the array cannot notice, and
  // this does.
  it('declares the ObjectQL dependency that actually orders the two inits', async () => {
    const stack = await createStandaloneStack({ databaseUrl: 'memory://default-order-deps' });
    const ds = stack.plugins.find(
      (p: any) => p?.name === 'com.objectstack.runtime.default-datasource',
    ) as any;
    expect(ds).toBeDefined();
    expect(ds.dependencies).toContain('com.objectstack.engine.objectql');
  }, BOOT_TIMEOUT);
});

// #4110 follow-up — a NAMED artifact that does not exist is a broken
// instruction, and `createDefaultHostConfig` is the boot with no
// `objectstack.config.ts`: the artifact IS the deployment, so there is nothing
// else to serve.
//
// #4110 made an absent artifact non-fatal all the way down (`loadArtifactBundle`
// logs and returns null; `MetadataPlugin` starts empty) — correct for the
// CONVENTIONAL `<cwd>/dist/objectstack.json`, which is simply "not compiled
// yet". But `OS_ARTIFACT_PATH` / `{ artifactPath }` skip the existence check by
// design, so that tolerance reached them too and turned a typo into a silent
// empty boot: `OS_ARTIFACT_PATH=/nope os serve` reached "Server is ready" with
// the missing path named NOWHERE in its output. The distinction that matters is
// named vs conventional, not the errno.
describe('createDefaultHostConfig — a named-but-missing artifact fails loudly (#4110 follow-up)', () => {
  const originalArtifactPath = process.env.OS_ARTIFACT_PATH;

  afterAll(() => {
    if (originalArtifactPath === undefined) delete process.env.OS_ARTIFACT_PATH;
    else process.env.OS_ARTIFACT_PATH = originalArtifactPath;
  });

  it('rejects an OS_ARTIFACT_PATH that does not exist, naming the path and the source', async () => {
    const missing = join(tmpdir(), `os-named-missing-${process.pid}`, 'objectstack.json');
    process.env.OS_ARTIFACT_PATH = missing;
    try {
      await expect(createDefaultHostConfig({ requireArtifact: true })).rejects.toThrow(
        /OS_ARTIFACT_PATH does not exist/,
      );
      await expect(createDefaultHostConfig({ requireArtifact: true })).rejects.toThrow(missing);
    } finally {
      delete process.env.OS_ARTIFACT_PATH;
    }
  });

  it('rejects an explicit `artifactPath` that does not exist', async () => {
    const missing = join(tmpdir(), `os-named-missing-opt-${process.pid}`, 'objectstack.json');
    delete process.env.OS_ARTIFACT_PATH;
    await expect(
      createDefaultHostConfig({ requireArtifact: true, artifactPath: missing }),
    ).rejects.toThrow(/`artifactPath` does not exist/);
  });

  // …and it stays loud in empty-boot mode too: `requireArtifact: false` means
  // "an artifact is optional", not "ignore the one I named".
  it('rejects a named-but-missing artifact even when requireArtifact is false', async () => {
    const missing = join(tmpdir(), `os-named-missing-empty-${process.pid}`, 'objectstack.json');
    delete process.env.OS_ARTIFACT_PATH;
    await expect(
      createDefaultHostConfig({ requireArtifact: false, artifactPath: missing }),
    ).rejects.toThrow(/does not exist/);
  });

  // The control: nothing NAMED an artifact, so the conventional path being
  // absent keeps its own pre-existing message — this guard must not swallow it.
  it('keeps the "no artifact source" error when nothing named one', async () => {
    delete process.env.OS_ARTIFACT_PATH;
    const emptyDir = mkdtempSync(join(tmpdir(), 'os-no-artifact-source-'));
    const cwd = process.cwd();
    process.chdir(emptyDir);
    try {
      await expect(createDefaultHostConfig({ requireArtifact: true })).rejects.toThrow(
        /No artifact source available/,
      );
    } finally {
      process.chdir(cwd);
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  // A remote artifact is never stat'ed — a URL cannot be cheaply checked, and
  // the loader owns that failure.
  it('passes an http(s) artifact source through without a filesystem check', () => {
    delete process.env.OS_ARTIFACT_PATH;
    expect(resolveDefaultArtifactPath('https://example.com/objectstack.json')).toBe(
      'https://example.com/objectstack.json',
    );
  });
});
