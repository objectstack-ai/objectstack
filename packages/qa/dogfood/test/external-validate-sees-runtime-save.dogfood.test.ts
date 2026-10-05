// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21842, ADR-0015 §6] `POST /datasources/:name/external/validate` lists a
// federated object the moment it is saved at runtime, with no restart, over
// the real showcase composition.
//
// ## What was broken
//
// The federation service read its objects from the `metadata` service, which
// holds a copy of the engine's object registry taken once at boot.
// `PUT /meta/object/:name`, and the external-table import that saves through
// it, write `sys_metadata` and the engine registry, never that copy. Measured
// on the showcase (`objectstack dev`): after a federated object was saved on
// `showcase_external`, validate still answered the two code-defined objects
// only, and listed the saved one after a restart. The service now reads the
// engine registry, resolved when validation runs.
//
// ## What this file pins, and what it leaves to the seam pins
//
// The listing, through the doors an operator uses: the code-defined objects,
// an object saved through `PUT /meta/object/:name`, and an object imported
// through `…/external/tables/:remote/import`. Under this harness the
// federation service is mounted as an extra plugin and finds no `metadata`
// service at its `init()`, so it holds no datasource definition and every row
// it answers is `ok` with no comparison made. The VERDICT on a runtime-saved
// object is therefore pinned beside the plugin
// (`packages/services/service-datasource/src/__tests__/external-validate-reads-live-registry.test.ts`),
// and was measured on `objectstack dev`, where the definition is read.
//
// The working directory is a temporary one because the showcase's external
// datasource and its fixture both name a cwd-relative SQLite file: this
// file's remote database is its own, not one a parallel file writes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { ExternalDatasourceServicePlugin } from '@objectstack/service-datasource';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The showcase's external datasource (`showcase-external.datasource.ts`). */
const DATASOURCE = 'showcase_external';
/** The two objects the showcase binds to it in code (`data/objects/external/`). */
const CODE_DEFINED = ['showcase_ext_customer', 'showcase_ext_order'];
/** Saved at runtime through the metadata door, bound to the remote `customers` table. */
const SAVED = 'dogfood_ext_cust_21842';
/** Imported at runtime from the remote `orders` table. */
const IMPORTED = 'dogfood_ext_ord_21842';

const validatePath = `/datasources/${DATASOURCE}/external/validate`;

function listedObjects(json: unknown): string[] {
  const body = json as { data?: { results?: Array<{ object?: unknown }> } } | undefined;
  return (body?.data?.results ?? []).map((r) => String(r.object)).sort();
}

describe('external validate lists a federated object saved at runtime, with no restart (showcase)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: unknown = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21842-'));
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

  it('lists the code-defined objects bound to the datasource', async () => {
    const validated = await call('POST', validatePath);
    expect(validated.status, JSON.stringify(validated.json)).toBe(200);
    expect(listedObjects(validated.json)).toEqual(CODE_DEFINED);
  });

  it('lists an object saved through PUT /meta/object/:name, and still the code-defined ones', async () => {
    const saved = await call('PUT', `/meta/object/${SAVED}`, {
      name: SAVED,
      label: 'Dogfood External Customer',
      sharingModel: 'public_read_write',
      datasource: DATASOURCE,
      external: { remoteName: 'customers' },
      fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const validated = await call('POST', validatePath);
    expect(validated.status, JSON.stringify(validated.json)).toBe(200);
    expect(listedObjects(validated.json)).toEqual([...CODE_DEFINED, SAVED].sort());
  });

  it('lists an object imported from a remote table, beside the saved and code-defined ones', async () => {
    const imported = await call('POST', `/datasources/${DATASOURCE}/external/tables/orders/import`, { name: IMPORTED });
    expect(imported.status, JSON.stringify(imported.json)).toBe(201);

    const validated = await call('POST', validatePath);
    expect(validated.status, JSON.stringify(validated.json)).toBe(200);
    expect(listedObjects(validated.json)).toEqual([...CODE_DEFINED, IMPORTED, SAVED].sort());
  });
});
