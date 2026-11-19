// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Verify writes only to its ephemeral store: no write reaches an external
 * datasource, even one whose write gate is open.
 *
 * The boot connects every datasource an app declares, the way `os dev` does
 * (ADR-0062 D1/D2), so an object on an external datasource whose gate is open
 * (`external.allowWrites` on the datasource AND `external.writable` on the
 * object) would take a probe insert into the real database behind it. The
 * fixture below declares exactly that datasource, backed by a driver this
 * suite owns that records every write it receives, and runs the derived write
 * families over it on one boot: the CRUD round trip, reference shapes, delete
 * behaviours and unique scopes. The pins:
 *
 *  - the recording driver receives no write from any of them;
 *  - the CRUD report names the external object as skipped, external and not
 *    exercised, with its gate open; a managed object that requires it is
 *    skipped too, and a managed object that only references it is verified;
 *  - CONTROL: a write sent through the REST door to the same object does reach
 *    the recording driver, so the silence above is the families withholding
 *    the write and not a driver nothing can reach.
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and the service packages
 * through their BUILT `dist/`. Rebuild them before trusting a run of this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataDriver } from '@objectstack/spec/contracts';

import { bootStack, type VerifyStack } from './harness.js';
import { runCrudVerification, formatReport, type VerifyReport } from './verify.js';
import { runReferenceShapeProofs, formatReferenceShapeReport } from './reference-shape.js';
import { runDeleteBehaviorProofs, formatDeleteBehaviorReport } from './delete-behavior.js';
import { runUniqueScopeProofs, formatUniqueScopeReport } from './unique-scope.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Paid at collection: the harness's boot loads it lazily (check:test-source-alias).
import '@objectstack/service-datasource';

await warmUpBoot();

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const REMOTE_DS = 'vxn_remote_ds';
const REMOTE = 'vxn_remote';
const LOCAL = 'vxn_local';
const DEPENDENT = 'vxn_dependent';

// ── The external datasource: a driver that records every write it receives ──

type Write = { method: string; object?: string };
const remoteWrites: Write[] = [];
const recordWrite = (method: string) => async (object?: string): Promise<any> => {
  remoteWrites.push({ method, object });
  return method === 'create' ? { id: `remote_${remoteWrites.length}` } : null;
};

/** A remote store this suite owns. Reads answer empty; every write is recorded. */
const remoteDriver = {
  name: REMOTE_DS,
  version: '0.0.1',
  supports: { transactionsUnsupported: true },
  async connect() {},
  async disconnect() {},
  async checkHealth() {
    return true;
  },
  async find() {
    return [];
  },
  async findOne() {
    return null;
  },
  async count() {
    return 0;
  },
  execute: recordWrite('execute'),
  create: recordWrite('create'),
  update: recordWrite('update'),
  delete: recordWrite('delete'),
  upsert: recordWrite('upsert'),
  bulkCreate: recordWrite('bulkCreate'),
  bulkUpdate: recordWrite('bulkUpdate'),
  bulkDelete: recordWrite('bulkDelete'),
  updateMany: recordWrite('updateMany'),
  deleteMany: recordWrite('deleteMany'),
  async beginTransaction() {
    return {};
  },
  async commit() {},
  async rollback() {},
  async syncSchema() {},
  dropTable: recordWrite('dropTable'),
} as unknown as IDataDriver;

const remoteDriverPlugin: Plugin = {
  name: 'com.objectstack.verify.external-no-writes-remote-driver',
  version: '1.0.0',
  init: async (ctx: PluginContext) => {
    ctx.registerService(`driver.${REMOTE_DS}`, remoteDriver);
  },
};

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.external-no-writes',
    namespace: 'vxn',
    version: '0.0.0',
    type: 'app',
    name: 'External No Writes Fixture',
    description: 'An app declaring an external datasource whose write gate is open.',
  },
  datasources: [
    {
      name: REMOTE_DS,
      label: 'External store (plugin driver)',
      driver: REMOTE_DS,
      schemaMode: 'external',
      config: {},
      external: { allowWrites: true, validation: { onMismatch: 'fail', checkOnBoot: false } },
    },
  ],
  objects: [
    {
      name: LOCAL,
      label: 'Local',
      pluralLabel: 'Locals',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        // A managed object that references the external one, optionally.
        remote_ref: { type: 'lookup', reference: REMOTE, label: 'Remote' },
      },
    },
    {
      name: REMOTE,
      label: 'Remote',
      pluralLabel: 'Remotes',
      datasource: REMOTE_DS,
      external: { remoteName: REMOTE, writable: true },
      sharingModel: 'public_read_write',
      tenancy: { enabled: false },
      fields: {
        // In each family's population: a unique field, and a reference with a delete behaviour.
        code: { type: 'text', label: 'Code', unique: true },
        local_ref: { type: 'lookup', reference: LOCAL, label: 'Local', deleteBehavior: 'set_null' },
      },
    },
    {
      name: DEPENDENT,
      label: 'Dependent',
      pluralLabel: 'Dependents',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        remote_ref: { type: 'lookup', reference: REMOTE, label: 'Remote', required: true },
      },
    },
  ],
  plugins: [remoteDriverPlugin],
} as never);

describe('os verify writes nothing to an external datasource, even one whose write gate is open', () => {
  let stack: VerifyStack;
  let token: string;
  let crud: VerifyReport;
  const reports: Record<string, string> = {};
  const writesDuringFamilies: Write[] = [];

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as never, {});
    token = await stack.signIn();
    const mark = remoteWrites.length;
    crud = await runCrudVerification(stack, token, fixtureStack);
    reports.crud = formatReport(crud);
    reports.referenceShapes = formatReferenceShapeReport(await runReferenceShapeProofs(stack, token, fixtureStack));
    reports.deleteBehaviors = formatDeleteBehaviorReport(await runDeleteBehaviorProofs(stack, token, fixtureStack));
    reports.uniqueScopes = formatUniqueScopeReport(await runUniqueScopeProofs(stack, token, fixtureStack));
    writesDuringFamilies.push(...remoteWrites.slice(mark));
  }, BOOT_TIMEOUT * 2);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
  });

  it('no derived write family sends a write to the external datasource', () => {
    expect(writesDuringFamilies, Object.values(reports).join('\n')).toEqual([]);
    // Each family met the external object (its field is in the family's
    // population) and left it out with the CRUD case's reason, so the silence
    // is a withheld write, not a family that never looked.
    for (const family of ['referenceShapes', 'deleteBehaviors', 'uniqueScopes']) {
      expect(reports[family], `${family}:\n${reports[family]}`).toContain('not exercised');
    }
  });

  it('the CRUD report names the external object as external and not exercised, with its gate open', () => {
    const remote = crud.results.find((r) => r.object === REMOTE);
    expect(remote?.status, reports.crud).toBe('skipped');
    expect(remote?.reason).toContain(`external datasource "${REMOTE_DS}" (writes allowed): not exercised`);
    expect(reports.crud).toContain(`${REMOTE}  skipped: external datasource "${REMOTE_DS}"`);
    // A managed object that requires it is not written either; one that only references it is.
    expect(crud.results.find((r) => r.object === DEPENDENT)?.status, reports.crud).toBe('skipped');
    expect(crud.results.find((r) => r.object === LOCAL)?.status, reports.crud).toBe('verified');
  });

  it('CONTROL: a write sent through the REST door reaches the recording driver', async () => {
    const mark = remoteWrites.length;
    const res = await stack.apiAs(token, 'POST', `/data/${REMOTE}`, { code: 'control' });
    expect(remoteWrites.slice(mark), `${res.status} ${await res.text()}`).toEqual([{ method: 'create', object: REMOTE }]);
  });
});
