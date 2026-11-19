// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Verify writes only to stores it creates: a declared MANAGED datasource runs
 * on an ephemeral stand-in, never on the database it names.
 *
 * The fixture declares a managed secondary datasource on a real, file-backed
 * SQLite database — the kind `objectstack dev` opens and writes. That file is
 * this suite's recording driver: whatever reaches the real datasource lands in
 * it. The derived write families run over an object bound to it on one boot
 * (the CRUD round trip, reference shapes, delete behaviours and unique
 * scopes), plus a REST create. The pins:
 *
 *  - nothing reached the real database: the file was never created, so no
 *    table and no row reached it;
 *  - coverage is kept: the object's CRUD case ran and was verified, against
 *    the stand-in, and the REST create answered and read back;
 *  - CONTROL: the factory `objectstack dev` builds declared datasources with
 *    opens that very file for the same declaration and writes a row into it,
 *    so the silence above is verify's stand-in and not an unreachable file.
 *
 * A second describe pins the factory itself, without a boot, against a
 * recording real factory: which declarations it stands in for and which keep
 * their real driver.
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and the service packages
 * through their BUILT `dist/`. Rebuild them before trusting a run of this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineStack } from '@objectstack/spec';
import {
  createDefaultDatasourceDriverFactory,
  resolveDatasourceSchemaMode,
  type DatasourceConnectionSpec,
  type IDatasourceDriverFactory,
} from '@objectstack/service-datasource';

import { bootStack, type VerifyStack } from './harness.js';
import { runCrudVerification, formatReport, type VerifyReport } from './verify.js';
import { runReferenceShapeProofs, formatReferenceShapeReport } from './reference-shape.js';
import { runDeleteBehaviorProofs, formatDeleteBehaviorReport } from './delete-behavior.js';
import { runUniqueScopeProofs, formatUniqueScopeReport } from './unique-scope.js';
import { createVerifyDatasourceDriverFactory } from './managed-datasource-stand-in.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Paid at collection: the harness's boot loads these lazily (check:test-source-alias).
import '@objectstack/service-automation';

await warmUpBoot();

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const SIDE_DS = 'vms_side_ds';
const SIDE = 'vms_side';
const LOCAL = 'vms_local';

const dir = mkdtempSync(join(tmpdir(), 'verify-managed-ds-'));
const realDatabase = join(dir, 'side.db');

const sideDatasource = {
  name: SIDE_DS,
  label: 'Managed side store (real file)',
  driver: 'sqlite-wasm',
  schemaMode: 'managed',
  config: { filename: realDatabase },
} as const;

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.managed-stand-in',
    namespace: 'vms',
    version: '0.0.0',
    type: 'app',
    name: 'Managed Stand-in Fixture',
    description: 'An app declaring a managed secondary datasource on a real database file.',
  },
  datasources: [sideDatasource],
  objects: [
    {
      name: LOCAL,
      label: 'Local',
      pluralLabel: 'Locals',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
    {
      name: SIDE,
      label: 'Side',
      pluralLabel: 'Sides',
      datasource: SIDE_DS,
      sharingModel: 'public_read_write',
      fields: {
        // In each family's population: a unique field, and a reference with a delete behaviour.
        serial: { type: 'text', label: 'Serial', unique: true },
        local_ref: { type: 'lookup', reference: LOCAL, label: 'Local', deleteBehavior: 'set_null' },
      },
    },
  ],
} as never);

const CONTROL_TABLE = 'vms_control';

/** Rows of `table` in the real database file, read through the factory `objectstack dev` uses. */
async function rowsIn(table: string): Promise<number> {
  const handle = await createDefaultDatasourceDriverFactory().create({
    ...sideDatasource,
    config: { ...sideDatasource.config },
  } as DatasourceConnectionSpec);
  await handle.connect?.();
  try {
    return ((await (handle.driver as any).find(table, {})) as unknown[]).length;
  } catch {
    return 0; // no such table
  } finally {
    await handle.disconnect?.();
  }
}

/** Whether the real database file exists, and how many fixture rows it holds. */
async function realDatabaseState(): Promise<{ exists: boolean; rows: number }> {
  if (!existsSync(realDatabase)) return { exists: false, rows: 0 };
  return { exists: true, rows: await rowsIn(SIDE) };
}

describe('os verify runs a declared managed datasource on an ephemeral stand-in, never on its real database', () => {
  let stack: VerifyStack | undefined;
  let crud: VerifyReport;
  const reports: Record<string, string> = {};
  let restCreate: { status: number; readBack: number; body: string };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as never, {});
    const token = await stack.signIn();
    crud = await runCrudVerification(stack, token, fixtureStack);
    reports.crud = formatReport(crud);
    reports.referenceShapes = formatReferenceShapeReport(await runReferenceShapeProofs(stack, token, fixtureStack));
    reports.deleteBehaviors = formatDeleteBehaviorReport(await runDeleteBehaviorProofs(stack, token, fixtureStack));
    reports.uniqueScopes = formatUniqueScopeReport(await runUniqueScopeProofs(stack, token, fixtureStack));
    // A write outside verify's derived families reaches the same datasource.
    const created = await stack.apiAs(token, 'POST', `/data/${SIDE}`, { serial: 'rest-create' });
    const body = await created.text();
    const id = (JSON.parse(body) as { data?: { id?: string }; id?: string }).data?.id
      ?? (JSON.parse(body) as { id?: string }).id;
    const read = await stack.apiAs(token, 'GET', `/data/${SIDE}/${id}`);
    restCreate = { status: created.status, readBack: read.status, body };
    await stack.stop();
    stack = undefined;
  }, BOOT_TIMEOUT * 2);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it('nothing reached the real database: its file was never created', async () => {
    expect(await realDatabaseState(), Object.values(reports).join('\n')).toEqual({ exists: false, rows: 0 });
  });

  it("the object's CRUD case still ran, and passed against the stand-in", () => {
    const side = crud.results.find((r) => r.object === SIDE);
    expect(side?.status, reports.crud).toBe('verified');
  });

  it('a REST create to the object answers and reads back, from the stand-in', () => {
    expect(restCreate.status, restCreate.body).toBe(201);
    expect(restCreate.readBack, restCreate.body).toBe(200);
  });

  it("CONTROL: the factory `objectstack dev` uses opens that file for the same declaration and writes into it", async () => {
    const handle = await createDefaultDatasourceDriverFactory().create({
      ...sideDatasource,
      config: { ...sideDatasource.config },
    } as DatasourceConnectionSpec);
    const driver = handle.driver as any;
    await handle.connect?.();
    // A table of the control's own, so this write does not depend on what the
    // run before it left in the file.
    await driver.syncSchema(CONTROL_TABLE, { name: CONTROL_TABLE, fields: { serial: { type: 'text' } } });
    await driver.create(CONTROL_TABLE, { id: 'control_1', serial: 'control' });
    await handle.disconnect?.();
    expect(existsSync(realDatabase)).toBe(true);
    expect(await rowsIn(CONTROL_TABLE)).toBe(1);
  });
});

describe('createVerifyDatasourceDriverFactory — which declarations get a stand-in', () => {
  const built: DatasourceConnectionSpec[] = [];
  const real: IDatasourceDriverFactory = {
    supports: () => true,
    create(spec) {
      built.push(spec);
      return { driver: {} } as never;
    },
  };
  const factory = createVerifyDatasourceDriverFactory({
    real,
    resolveSchemaMode: resolveDatasourceSchemaMode,
    defaultStore: 'sqlite-wasm',
  });
  const buildOne = async (spec: DatasourceConnectionSpec) => {
    built.length = 0;
    await factory.create(spec);
    return built[0];
  };

  it('a managed SQL datasource is built as an in-memory store of the default store engine', async () => {
    const spec = await buildOne({
      name: 'pg', driver: 'postgres', schemaMode: 'managed', config: { host: 'db.internal' }, secret: 's3cret',
    });
    expect(spec).toEqual({ name: 'pg', driver: 'sqlite-wasm', schemaMode: 'managed', config: { filename: ':memory:' } });
  });

  it('a datasource that declares no schemaMode counts as managed', async () => {
    const spec = await buildOne({ name: 'lite', driver: 'sqlite', config: { filename: './data/app.db' } });
    expect(spec).toEqual({ name: 'lite', driver: 'sqlite-wasm', schemaMode: 'managed', config: { filename: ':memory:' } });
  });

  it('a managed memory datasource gets a fresh memory store without its persistence', async () => {
    const spec = await buildOne({
      name: 'mem', driver: 'memory', schemaMode: 'managed', config: { persistence: { type: 'file', path: './m.json' } },
    });
    expect(spec).toEqual({ name: 'mem', driver: 'memory', schemaMode: 'managed', config: {} });
  });

  it('an external datasource keeps its real driver', async () => {
    const declared: DatasourceConnectionSpec = {
      name: 'wh', driver: 'postgres', schemaMode: 'external', config: { host: 'wh.internal' }, external: {},
    };
    expect(await buildOne(declared)).toBe(declared);
  });

  it('a managed datasource with no faithful stand-in (mongodb) keeps its real driver; derive withholds its objects', async () => {
    const declared: DatasourceConnectionSpec = {
      name: 'docs', driver: 'mongodb', schemaMode: 'managed', config: { url: 'mongodb://docs.internal' },
    };
    expect(await buildOne(declared)).toBe(declared);
  });
});
