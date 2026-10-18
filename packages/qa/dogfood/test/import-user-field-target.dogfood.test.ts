// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22785] A `user` field written without `reference` is a reference to
// `sys_user` at the import and export doors, as the spec's arbiter
// (`referenceTargetOf`) and the data door's `$expand` read it — on a real boot.
// The `Field.user` field (which writes `reference: 'sys_user'`) is the control:
// its answers do not move. The refusal of an unserved target is pinned in
// core's `import-runner-reference-exposure.test.ts`.
//
// `@objectstack/core` (the field map and the runner) resolves through its
// BUILT output here, so a verdict on a change to it is a verdict on its last
// build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const SYS = { context: { isSystem: true } } as const;
const ADMIN = 'admin@objectos.ai';

const Task = ObjectSchema.create({
  name: 'iuf_task',
  sharingModel: 'public_read_write',
  label: 'Task',
  pluralLabel: 'Tasks',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner: { type: 'user' as const, label: 'Owner' },
    assignee: Field.user({ label: 'Assignee' }),
  },
});

const stackDef = defineStack({
  manifest: {
    id: 'com.dogfood.import-user-field-target',
    namespace: 'iuf',
    version: '0.0.0',
    type: 'app',
    name: 'Import User Field Target Fixture',
    description: 'A user field written without reference beside a Field.user one, at the import and export doors.',
  },
  objects: [Task],
});

/** Read, create and export on the fixture object, so the export door answers. */
const exporter = PermissionSetSchema.parse({
  name: 'iuf_fixture_exporter',
  label: 'Import user field fixture exporter',
  objects: { iuf_task: { allowRead: true, allowCreate: true, allowExport: true } },
});

type Row = { ok: boolean; code?: string; field?: string; id?: string };

describe('[#22785] a user field without reference resolves to sys_user at the import and export doors', () => {
  let stack: VerifyStack;
  let token = '';
  let adminId = '';
  let ql: any;

  beforeAll(async () => {
    stack = await bootStack(stackDef as never, {
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, exporter], fallbackPermissionSet: exporter.name }),
    });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = String((await ql.find('sys_user', { where: { email: ADMIN }, ...SYS }))[0].id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // [#24348] No `runAutomations: false`: the fixture binds no automation, and the import
  // doors refuse that opt-out to every caller but the system principal.
  const doors = {
    sync: async (rows: object[]): Promise<Row[]> => {
      const res = await stack.apiAs(token, 'POST', '/data/iuf_task/import', { format: 'json', rows });
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { results: Row[] }).results;
    },
    jobs: async (rows: object[]): Promise<Row[]> => {
      const res = await stack.apiAs(token, 'POST', '/data/iuf_task/import/jobs', { format: 'json', rows });
      expect(res.status, await res.clone().text()).toBe(201);
      const { jobId } = (await res.json()) as { jobId: string };
      for (let i = 0; i < 200; i++) {
        const body: any = await (await stack.apiAs(token, 'GET', `/data/import/jobs/${jobId}/results`)).json();
        if (body.status === 'succeeded') return body.results;
        expect(['pending', 'running'], JSON.stringify(body)).toContain(body.status);
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`import job ${jobId} did not finish`);
    },
  };

  for (const door of ['sync', 'jobs'] as const) {
    for (const field of ['owner', 'assignee'] as const) {
      it(`${door}: an email in ${field === 'owner' ? 'the field without reference' : 'CONTROL Field.user'} stores the user id`, async () => {
        const [row] = await doors[door]([{ name: `${door}-${field}`, [field]: ADMIN }]);
        expect(row!.ok, JSON.stringify(row)).toBe(true);
        expect((await ql.find('iuf_task', { where: { id: row!.id }, ...SYS }))[0]?.[field]).toBe(adminId);
      });
    }
  }

  it('export: the field without reference renders the user as Field.user does, not the stored id', async () => {
    await ql.insert('iuf_task', { name: 'export-row', owner: adminId, assignee: adminId }, SYS);
    const filter = encodeURIComponent(JSON.stringify({ name: 'export-row' }));
    const res = await stack.apiAs(token, 'GET', `/data/iuf_task/export?format=json&filter=${filter}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const [row] = (await res.json()) as Array<Record<string, unknown>>;
    expect(row!.assignee, 'CONTROL Field.user renders a name').not.toBe(adminId);
    expect(row!.owner).toBe(row!.assignee);
  });
});
