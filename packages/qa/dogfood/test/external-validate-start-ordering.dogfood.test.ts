// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21876] The federation service compares every federated object, on the
// composition the verify harness boots.
//
// ## What was broken
//
// `ExternalDatasourceServicePlugin.init()` read the `metadata` service once and
// kept the answer. On a composition with no metadata plugin, that service is
// the kernel's in-memory fallback, registered after every plugin's `init()`,
// just before the start phase. So the federation service kept "no metadata
// service" for the life of the process. Measured on the showcase at the time:
// `POST /datasources/:name/external/validate` answered `ok: true` with no rows,
// and the boot gate logged "all federated objects match their remote schema"
// with `objects: 0` — although two federated objects exist, and one of them
// could have drifted. The service now resolves `metadata` when it is used.
// That ordering fix is pinned at its seam, in
// `packages/services/service-datasource/src/__tests__/external-validate-reads-live-registry.test.ts`.
//
// ## Why this composition
//
// The verify harness composes `@objectstack/metadata`'s `MetadataPlugin`, the
// artifact-less one `objectstack serve` and `start` give a host configuration
// such as the showcase (#23088). The first case asserts that occupant: the
// plugin is registered, and the `metadata` service is its manager, with the
// endpoint matcher. So a change to what the harness composes cannot pass
// through this file unnoticed. The harness does not mount the federation
// service, so this file mounts it, as
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
import { MetadataManager } from '@objectstack/metadata';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
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

describe('federation on the harness composition, which holds the metadata plugin', () => {
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
    stack = await bootShowcase({ extraPlugins: [new ExternalDatasourceServicePlugin()] });
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('precondition: the metadata service is the composed MetadataPlugin\'s manager, with its endpoint matcher', () => {
    // The plugin is registered under its own name, and the `metadata` slot is
    // its `MetadataManager`, not the kernel's in-memory fallback (a plain
    // object with no matcher).
    expect(stack.kernel.hasPlugin('com.objectstack.metadata')).toBe(true);
    const metadata = stack.kernel.getService<{ matchEndpoint?: unknown }>('metadata');
    expect(metadata).toBeInstanceOf(MetadataManager);
    expect(typeof metadata.matchEndpoint).toBe('function');
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
