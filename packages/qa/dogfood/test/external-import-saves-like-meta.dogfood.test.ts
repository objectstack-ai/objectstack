// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21788, ADR-0015 Addendum] "Import as Object" keeps what it answers `201`
// for — over the real showcase composition, across a cold boot on one
// database file.
//
// ## What was broken
//
// `POST /datasources/:name/external/tables/:remote/import` persisted the
// generated object with `metadata.register('object', …)`, which held it in the
// metadata service's memory only: no `sys_metadata` row, no engine schema
// sync, no external-object registration with the driver. Measured on the
// showcase before the fix: an import under a name that differs from its remote
// table answered `201` and then `500 DATABASE_ERROR` on its first read (the
// SQL driver resolved the table by the object's name — `no such table`), an
// import whose name equals the remote table answered `200` only because the
// two names coincide, and after a restart on the same database both answered
// `404 OBJECT_NOT_FOUND`. `PUT /meta/object/:name` with the same binding was
// durable and served the rows. The import now saves through that door's save.
//
// ## Why a booted stack
//
// The seam pins sit beside the plugin
// (`packages/services/service-datasource/src/__tests__/external-import-saves-through-metadata-door.test.ts`).
// What they cannot answer is whether, on the stack an operator runs, the save
// maps the object onto its remote table and lands a row the next boot binds.
// Only a read through the data door and a restart on the same file show that.
//
// The verify harness does not mount the federation service, so this file
// mounts `ExternalDatasourceServicePlugin` itself, as `objectstack dev` and
// `serve` do. The working directory is a temporary one because the showcase's
// external datasource and its fixture both name a cwd-relative SQLite file:
// this file's remote database is its own, not one a parallel file writes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { ExternalDatasourceServicePlugin } from '@objectstack/service-datasource';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The showcase's external datasource and its two remote tables (`external-fixture.ts`). */
const DATASOURCE = 'showcase_external';
/** Imported under a name that differs from its remote table — the defect's shape. */
const RENAMED = 'dogfood_ext_cust_21788';
/** Imported under the remote table's own name — the shape that hid the defect. */
const SAME_NAME = 'orders';

const importPath = (remote: string) => `/datasources/${DATASOURCE}/external/tables/${remote}/import`;

function recordsOf(json: unknown): Array<Record<string, unknown>> {
  const body = json as { records?: unknown[] } | undefined;
  return (body?.records ?? []) as Array<Record<string, unknown>>;
}

async function boot(databaseFile: string): Promise<VerifyStack> {
  return bootStack(showcaseStack, { databaseFile, extraPlugins: [new ExternalDatasourceServicePlugin()] });
}

describe('Import as Object persists like the metadata door (showcase, cold boot)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;
  let dbFile: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: unknown = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21788-'));
    process.chdir(dir);
    dbFile = join(dir, 'showcase.db');
    // Provision the remote tables, exactly as `os dev` does at boot (the
    // harness imports only the stack's default export, so `onEnable` never
    // runs on its own).
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await boot(dbFile);
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('an object imported under a name that differs from its remote table serves the remote rows', async () => {
    const imported = await call('POST', importPath('customers'), { name: RENAMED });
    expect(imported.status, JSON.stringify(imported.json)).toBe(201);

    const read = await call('GET', `/data/${RENAMED}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(recordsOf(read.json).map((r) => r.name)).toEqual(
      expect.arrayContaining(['Aurora Labs', 'Borealis GmbH', 'Cyan Pacific']),
    );
  });

  it('control: an object imported under its remote table\'s own name serves the remote rows', async () => {
    const imported = await call('POST', importPath('orders'), { name: SAME_NAME });
    expect(imported.status, JSON.stringify(imported.json)).toBe(201);

    const read = await call('GET', `/data/${SAME_NAME}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(recordsOf(read.json)).toHaveLength(4);
  });

  it('after a cold boot on the same database file, both imported objects still serve their rows', async () => {
    await stack.stop();
    stack = await boot(dbFile);
    token = await stack.signIn();

    // Independent facts about one restart, so each is reported on its own.
    const renamed = await call('GET', `/data/${RENAMED}`);
    expect.soft(renamed.status, JSON.stringify(renamed.json)).toBe(200);
    expect.soft(recordsOf(renamed.json)).toHaveLength(3);

    const sameName = await call('GET', `/data/${SAME_NAME}`);
    expect.soft(sameName.status, JSON.stringify(sameName.json)).toBe(200);
    expect.soft(recordsOf(sameName.json)).toHaveLength(4);
  }, 180_000);
});
