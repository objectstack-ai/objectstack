// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21889, ADR-0028] An import over a CODE-DEFINED datasource is held to the
// namespace of the package that declares the datasource, over the real
// showcase composition.
//
// ## What was broken
//
// The showcase declares `showcase_external` in its own package, whose
// `manifest.namespace` is `showcase`. `POST
// /api/v1/datasources/showcase_external/external/tables/orders/import` with an
// explicit `name` that carried no prefix answered `201` and persisted an
// unprefixed federated object, and the draft door answered the bare remote
// table name with its `TODO(namespace)` note. Two links were missing:
// `AppPlugin` registered the code-defined datasource with no `_packageId`, and
// the federation service then looked the package record up on the `metadata`
// service, which holds none in any composition. The datasource is now stamped
// with the package body that declares it, and the namespace is read from the
// engine registry, the store the publish gate reads.
//
// ## What each case pins
//
// The ruling's two pins: an unprefixed import name is refused with ADR-0028's
// message and saves nothing, and the draft door answers the prefixed name with
// no `TODO(namespace)` note. Then the controls that show the stamp moved
// nothing else: a prefixed import is saved and serves the remote rows, the
// host `default` datasource carries no package, the admin service keeps
// refusing edits to a code-defined datasource and lists it as before, and
// validate and the existing federated objects answer as before.
//
// The verify harness does not mount the federation service, so this file
// mounts `ExternalDatasourceServicePlugin` itself, as `objectstack dev` and
// `serve` do. The working directory is a temporary one because the showcase's
// external datasource and its fixture both name a cwd-relative SQLite file.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { ExternalDatasourceServicePlugin } from '@objectstack/service-datasource';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The showcase's code-defined external datasource (`showcase-external.datasource.ts`). */
const DATASOURCE = 'showcase_external';
/** The package that declares it, and that package's ADR-0028 namespace. */
const PACKAGE_ID = 'com.example.showcase';
const NAMESPACE = 'showcase';
/**
 * [#30469 item 2] The package an import over it is SAVED into: the showcase is
 * read-only, so its customization package, whose namespace is the import's.
 */
const IMPORT_NAMESPACE = 'showcase_custom';
const PAIR_ID = `${PACKAGE_ID}.custom`;
/** The object an import of `customers` with no name override makes there. */
const LANDED = `${IMPORT_NAMESPACE}_customers`;
/** An explicit import name with no namespace prefix: the defect's shape. */
const UNPREFIXED = 'dogfood_ext_order_21889';
const PREFIXED = `${IMPORT_NAMESPACE}_${UNPREFIXED}`;

const ext = `/datasources/${DATASOURCE}/external`;

interface Envelope {
  success?: boolean;
  error?: { code?: string; message?: string };
  item?: Record<string, unknown>;
  data?: unknown;
  records?: Array<Record<string, unknown>>;
}

describe('an import over a code-defined datasource is held to its package\'s namespace (showcase)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json = (await res.json().catch(() => ({}))) as Envelope;
    return { status: res.status, json };
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21889-'));
    process.chdir(dir);
    // Provision the remote tables, exactly as `os dev` does at boot (the
    // harness imports only the stack's default export, so `onEnable` never
    // runs on its own).
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootShowcase({
      databaseFile: join(dir, 'showcase.db'),
      extraPlugins: [new ExternalDatasourceServicePlugin()],
    });
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('premise: the code-defined datasource carries the provenance of the package that declares it', async () => {
    const version = (showcaseStack as unknown as { manifest?: { version?: string } }).manifest?.version;
    expect(version).toMatch(/^\d+\.\d+\.\d+/);

    const read = await call('GET', `/meta/datasource/${DATASOURCE}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(read.json.item).toMatchObject({
      origin: 'code',
      _packageId: PACKAGE_ID,
      _packageVersion: version,
      _provenance: 'package',
    });
  });

  it('control: validate and the code-defined federated objects answer as before, ahead of any import', async () => {
    const validated = await call('POST', `${ext}/validate`);
    expect(validated.status, JSON.stringify(validated.json)).toBe(200);
    const report = validated.json.data as { ok?: boolean; results?: Array<{ object: string }> };
    expect(report.ok).toBe(true);
    expect(report.results?.map((r) => r.object).sort()).toEqual(['showcase_ext_customer', 'showcase_ext_order']);

    const rows = await call('GET', '/data/showcase_ext_order');
    expect(rows.status, JSON.stringify(rows.json)).toBe(200);
    expect(rows.json.records).toHaveLength(4);
  });

  it('an explicit import name without the prefix is refused with ADR-0028\'s message, and nothing is saved', async () => {
    const refused = await call('POST', `${ext}/tables/orders/import`, { name: UNPREFIXED });

    expect(refused.status, JSON.stringify(refused.json)).toBe(400);
    expect(refused.json.error?.code).toBe('EXTERNAL_IMPORT_ERROR');
    expect(refused.json.error?.message).toContain('missing the package namespace prefix');
    expect(refused.json.error?.message).toContain(`'${PREFIXED}'`);

    const stored = await call('GET', `/meta/object/${UNPREFIXED}`);
    expect(stored.status, JSON.stringify(stored.json)).toBe(404);
  });

  it('the draft door answers the prefixed name, with no TODO(namespace) note', async () => {
    const drafted = await call('POST', `${ext}/tables/orders/draft`, {});

    expect(drafted.status, JSON.stringify(drafted.json)).toBe(200);
    const draft = (drafted.json.data as { draft?: { name?: string; source?: string } } | undefined)?.draft;
    expect(draft?.name).toBe(`${NAMESPACE}_orders`);
    expect(draft?.source).not.toContain('TODO(namespace)');
  });

  it('control: a prefixed import name is saved and serves the remote rows', async () => {
    const imported = await call('POST', `${ext}/tables/orders/import`, { name: PREFIXED });
    expect(imported.status, JSON.stringify(imported.json)).toBe(201);

    const rows = await call('GET', `/data/${PREFIXED}`);
    expect(rows.status, JSON.stringify(rows.json)).toBe(200);
    expect(rows.json.records).toHaveLength(4);
  });

  it('control: the host `default` datasource carries no package, so no namespace is demanded on it', async () => {
    const read = await call('GET', '/meta/datasource/default');
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(read.json.item).not.toHaveProperty('_packageId');
    expect(read.json.item).not.toHaveProperty('_provenance');
  });

  it('control: the admin service still refuses to edit or remove a code-defined datasource, and lists no envelope key', async () => {
    // The harness mounts no `/api/v1/datasources` admin routes (the CLI's
    // `serve` does), so this reads the service those routes relay: a refusal
    // here is the door's `400 DATASOURCE_ADMIN_ERROR`. The refusals key on
    // `origin`, which the stamp leaves as it was.
    const admin = stack.kernel.getService<{
      updateDatasource(name: string, patch: Record<string, unknown>): Promise<unknown>;
      removeDatasource(name: string): Promise<void>;
      listDatasources(): Promise<Array<Record<string, unknown>>>;
    }>('datasource-admin');

    await expect(admin.updateDatasource(DATASOURCE, { label: 'Renamed 21889' })).rejects.toBeInstanceOf(Error);
    await expect(admin.removeDatasource(DATASOURCE)).rejects.toBeInstanceOf(Error);

    const entry = (await admin.listDatasources()).find((d) => d.name === DATASOURCE);
    expect(entry).toMatchObject({ origin: 'code', label: 'External Analytics (SQLite)' });
    expect(entry).not.toHaveProperty('_packageId');
  });

  // [#30469 item 2, ruling B] The showcase package is read-only (a booted code
  // package), so an object imported over the datasource it declares is saved
  // into its customization package, and travels with that package's export.
  it('an import with no name lands in the showcase\'s customization package, and the package export carries it', async () => {
    const imported = await call('POST', `${ext}/tables/customers/import`, {});
    expect(imported.status, JSON.stringify(imported.json)).toBe(201);
    expect((imported.json.data as { object?: { name?: string } }).object?.name).toBe(LANDED);

    const listed = await call('GET', '/meta/object');
    const items = (listed.json as { data?: unknown; items?: unknown }).data ?? (listed.json as { items?: unknown }).items;
    const entry = (Array.isArray(items) ? items : (items as { items?: unknown[] })?.items ?? [])
      .find((i) => (i as { name?: string }).name === LANDED) as { _packageId?: string } | undefined;
    expect(entry?._packageId).toBe(PAIR_ID);

    const pairExport = await call('GET', `/packages/${PAIR_ID}/export`);
    expect(pairExport.status, JSON.stringify(pairExport.json)).toBe(200);
    expect(JSON.stringify(pairExport.json)).toContain(`"${LANDED}"`);

    const whole = await call('GET', '/packages/export');
    expect(whole.status, JSON.stringify(whole.json)).toBe(200);
    expect(JSON.stringify(whole.json)).toContain(`"${LANDED}"`);

    const rows = await call('GET', `/data/${LANDED}`);
    expect(rows.status, JSON.stringify(rows.json)).toBe(200);
    expect(rows.json.records?.length).toBeGreaterThan(0);
  });
});

// [#30469 item 2, ruling B] Under a walled posture the platform operator
// creates a customization package, through its ensure door (ADR-0146 D3,
// ADR-0131 D3). The import never creates one: while the pair is absent the
// import is refused, naming the operator and that door, and nothing is saved
// anywhere; once the pair exists the import lands in it.
describe('group: an import never creates the customization package (showcase)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;
  const previous = process.env.OS_TENANCY_POSTURE;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json = (await res.json().catch(() => ({}))) as Envelope;
    return { status: res.status, json };
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-30469-'));
    process.chdir(dir);
    process.env.OS_TENANCY_POSTURE = 'group';
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootShowcase({
      databaseFile: join(dir, 'showcase.db'),
      multiTenant: 'posture-only',
      extraPlugins: [new ExternalDatasourceServicePlugin()],
    });
    // The seeded administrator is the platform operator on this harness.
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = previous;
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('guard the guard: a real, non-degraded walled posture', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
    expect(tenancy.posture).toBe('group');
    expect(tenancy.degraded).toBe(false);
  });

  it('with no pair, the import is refused naming the platform operator and the ensure door, and nothing is saved', async () => {
    const refused = await call('POST', `${ext}/tables/customers/import`, {});

    expect(refused.status, JSON.stringify(refused.json)).toBe(400);
    expect(refused.json.error?.code).toBe('EXTERNAL_IMPORT_ERROR');
    expect(refused.json.error?.message).toContain('platform operator');
    expect(refused.json.error?.message).toContain(`/packages/${PACKAGE_ID}/ensure-customization`);

    expect((await call('GET', `/meta/object/${LANDED}`)).status).toBe(404);
    expect((await call('GET', '/meta/object/showcase_customers')).status).toBe(404);
    expect((await call('GET', `/packages/${PAIR_ID}`)).status).toBe(404);
  });

  it('once the operator has created the pair through its door, the import lands in it', async () => {
    const ensured = await call('POST', `/packages/${PACKAGE_ID}/ensure-customization`, {});
    expect(ensured.status, JSON.stringify(ensured.json)).toBe(201);

    const imported = await call('POST', `${ext}/tables/customers/import`, {});
    expect(imported.status, JSON.stringify(imported.json)).toBe(201);
    expect((imported.json.data as { object?: { name?: string } }).object?.name).toBe(LANDED);

    const pairExport = await call('GET', `/packages/${PAIR_ID}/export`);
    expect(JSON.stringify(pairExport.json)).toContain(`"${LANDED}"`);
  });
});
