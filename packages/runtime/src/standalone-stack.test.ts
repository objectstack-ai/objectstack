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

// ADR-0062 (Variant A) — the standalone `default` driver's CONSTRUCTION is
// unified: the user-facing kinds (memory / better-sqlite3 / postgres / mongodb)
// go through the SAME `createDefaultDatasourceDriverFactory` used for
// declared/runtime datasources, so there is one "driver kind → instance" path.
// The pure-JS WASM sqlite driver stays bespoke (it's the standalone-specific
// CI-safe default, not a user-creatable datasource type — its only construction
// site). These tests extract the constructed driver from the stack's
// `DriverPlugin` and exercise it directly (connect → syncSchema → create →
// find), proving the right driver is built per kind AND that it actually
// connects + does I/O — without booting the full kernel (the MetadataPlugin
// file-artifact boot doesn't play well with vitest's module runner, and isn't
// what this test is about). postgres/mongodb need a live server, so they're
// covered by the factory's own usage + the runtime-admin path.
describe('createStandaloneStack — default driver construction unified via the factory (ADR-0062)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'os-standalone-driver-')); });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  const NOTE = { name: 'note', fields: { id: { type: 'text' }, title: { type: 'text' } } };

  async function driverRoundTrip(
    cfg: Parameters<typeof createStandaloneStack>[0],
  ): Promise<{ kind: string | undefined; titles: string[] }> {
    const stack = await createStandaloneStack(cfg);
    const plugin = stack.plugins.find(
      (p: any) => p?.driver && typeof p.driver.find === 'function',
    ) as { driver: any } | undefined;
    const driver = plugin!.driver;
    const kind = driver?.constructor?.name as string | undefined;
    await driver.connect?.();
    try {
      await driver.syncSchema('note', NOTE);
      await driver.create('note', { id: 'n1', title: 'hello-driver' });
      const rows = (await driver.find('note', {})) as Array<{ title?: string }>;
      return { kind, titles: rows.map((r) => r.title as string) };
    } finally {
      try { await driver.disconnect?.(); } catch { /* noop */ }
    }
  }

  it('memory:// → InMemoryDriver (factory), connects + round-trips', async () => {
    const r = await driverRoundTrip({ databaseUrl: 'memory://default-driver' });
    expect(r.kind).toMatch(/InMemoryDriver$/);
    expect(r.titles).toContain('hello-driver');
  }, BOOT_TIMEOUT);

  it('file: → better-sqlite3 SqlDriver (factory), connects + round-trips', async () => {
    const r = await driverRoundTrip({ databaseUrl: `file:${join(dir, 'better.db')}` });
    expect(r.kind).toMatch(/SqlDriver$/);
    expect(r.titles).toContain('hello-driver');
  }, BOOT_TIMEOUT);

  it('databaseDriver:sqlite-wasm → SqliteWasmDriver (bespoke), connects + round-trips', async () => {
    const r = await driverRoundTrip({ databaseDriver: 'sqlite-wasm', databaseUrl: `file:${join(dir, 'wasm.db')}` });
    expect(r.kind).toMatch(/SqliteWasmDriver$/);
    expect(r.titles).toContain('hello-driver');
  }, BOOT_TIMEOUT);
});
