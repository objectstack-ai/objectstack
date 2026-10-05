// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21876] On a composition with no metadata plugin — the `objectstack start`
// shape — the federation service compares every federated object.
//
// ## What was broken
//
// `ExternalDatasourceServicePlugin.init()` read the `metadata` service once and
// kept the answer. `objectstack start` composes no metadata plugin: its
// `metadata` service is the kernel's in-memory fallback, registered after every
// plugin's `init()`, just before the start phase. So the federation service
// kept "no metadata service" for the life of the process. Measured on the
// showcase under `objectstack start`: `POST /datasources/:name/external/validate`
// answered `ok: true` with no rows, and the boot gate logged "all federated
// objects match their remote schema" with `objects: 0` — although two
// federated objects exist, and one of them could have drifted. Under
// `objectstack dev` (which composes the metadata plugin before this one) both
// objects were compared. The service now resolves `metadata` when it is used.
//
// ## Why this composition
//
// The verify harness composes no metadata plugin either, so its `metadata`
// service is the same kernel fallback, registered at the same moment, as on
// `objectstack start`. The first case asserts that, so a harness that one day
// composes a metadata plugin cannot turn this file into a silent pass. The
// harness does not mount the federation service, so this file mounts it, as
// `objectstack dev` and `start` do. It does not mount the boot gate either
// (`createExternalValidationPlugin`, `@objectstack/runtime`): the gate's input
// is the federation service's whole-farm sweep, `validateAll()`, which the
// third case reads directly. The gate's own log on a real `objectstack start`
// is recorded on the pull request that brought this file.
//
// ## The drift
//
// The showcase's remote is a SQLite file its `onEnable` provisions. The file
// is the test's own (a temporary working directory), and after provisioning
// its `customers` table loses the `email` column the code-defined
// `showcase_ext_customer` declares — a real drift, so "compared" and "skipped"
// give different answers.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { ExternalDatasourceServicePlugin, resolveSqliteDriver } from '@objectstack/service-datasource';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The showcase's external datasource (`showcase-external.datasource.ts`) and its remote file. */
const DATASOURCE = 'showcase_external';
const REMOTE_FILE = '.objectstack/data/showcase_external.db';
/** The code-defined federated objects bound to it. */
const FEDERATED = ['showcase_ext_customer', 'showcase_ext_order'];

interface Row {
  object: string;
  datasource: string;
  ok: boolean;
  diffs: Array<{ kind: string; column?: string; severity: string }>;
}
interface Report {
  ok: boolean;
  results: Row[];
}

const objectsOf = (rows: Row[]) => rows.map((r) => r.object).sort();

/** Rename the remote's `customers.email` away, so the remote no longer has the column the object declares. */
async function driftRemoteCustomers(): Promise<void> {
  const { driver } = await resolveSqliteDriver({ filename: REMOTE_FILE, warn: () => undefined });
  const remote = driver as unknown as {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    execute(sql: string): Promise<unknown>;
  };
  await remote.connect();
  try {
    await remote.execute('ALTER TABLE customers RENAME COLUMN email TO billing_contact');
  } finally {
    await remote.disconnect();
  }
}

describe('federation on a composition with no metadata plugin (the objectstack start shape)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21876-'));
    process.chdir(dir);
    // Provision the remote tables, exactly as the showcase does at boot (the
    // harness imports only the stack's default export, so `onEnable` never
    // runs on its own), then drift one column away.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    await driftRemoteCustomers();
    stack = await bootStack(showcaseStack, { extraPlugins: [new ExternalDatasourceServicePlugin()] });
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('precondition: the metadata service is the kernel\'s in-memory fallback, as on objectstack start', () => {
    const metadata = stack.kernel.getService<{ __serviceInfo?: { status?: string; message?: string } }>('metadata');
    expect(metadata.__serviceInfo?.status).toBe('degraded');
    expect(metadata.__serviceInfo?.message).toMatch(/^In-memory metadata registry/);
  });

  it('validate compares each federated object, and reports the drifted column', async () => {
    const res = await stack.apiAs(token, 'POST', `/datasources/${DATASOURCE}/external/validate`);
    const body = (await res.json()) as { data?: Report };
    expect(res.status, JSON.stringify(body)).toBe(200);
    const report = body.data as Report;

    expect(objectsOf(report.results)).toEqual(FEDERATED);
    const customer = report.results.find((r) => r.object === 'showcase_ext_customer');
    expect(customer?.ok).toBe(false);
    expect(customer?.diffs).toEqual([
      expect.objectContaining({ kind: 'missing_column', column: 'email', severity: 'error' }),
    ]);
    const order = report.results.find((r) => r.object === 'showcase_ext_order');
    expect(order?.ok, JSON.stringify(order)).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('the boot gate\'s sweep (validateAll) counts the real federated objects', async () => {
    const service = stack.kernel.getService<{ validateAll(): Promise<Report> }>('external-datasource');

    const report = await service.validateAll();

    const onShowcase = report.results.filter((r) => r.datasource === DATASOURCE);
    expect(objectsOf(onShowcase)).toEqual(FEDERATED);
    expect(onShowcase.find((r) => r.object === 'showcase_ext_customer')?.diffs).toEqual([
      expect.objectContaining({ kind: 'missing_column', column: 'email' }),
    ]);
  });
});
