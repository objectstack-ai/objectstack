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
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The showcase's code-defined external datasource (`showcase-external.datasource.ts`). */
const DATASOURCE = 'showcase_external';
/** The package that declares it, and that package's ADR-0028 namespace. */
const PACKAGE_ID = 'com.example.showcase';
const NAMESPACE = 'showcase';
/** An explicit import name with no namespace prefix: the defect's shape. */
const UNPREFIXED = 'dogfood_ext_order_21889';
const PREFIXED = `${NAMESPACE}_${UNPREFIXED}`;

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
    stack = await bootStack(showcaseStack, {
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
});
