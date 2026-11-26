// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#36794] A scoped import lookup cell (`dependsOn`) whose value names a record
// that lives only under ANOTHER parent answers `reference_out_of_scope`, with
// the row's own scoping column and its cell as data on the cell error — on a
// real boot: the real SecurityPlugin (its field-predicate guard), ObjectQL, the
// SQL driver and the REST import door.
//
// Two answers the reason must NOT give, each pinned through the real seam that
// produces it, never a fake's string:
//
//   • A caller who cannot read the scope field has every scoped read refused by
//     the field-predicate guard. That miss says nothing about where the value
//     lives, so it stays `reference_not_found`, with no `scope`, even for a value
//     that sits under the row's own parent.
//   • A `dependsOn` whose `param` names a target field the engine cannot filter
//     by (a formula) never asks its scoped question: `reference_not_found` with
//     the sentence that says the lookup could not be made within the scope.
//
// ## Armed before anything is believed
//
// The guard is shown live first (the member's own filter on the hidden field is
// refused, the admin's is served), and the admin's in-scope row is the control
// that the scope resolves at all.
//
// Fixtures are synthetic. `@objectstack/core` (the import runner) resolves
// through its BUILT output here, so a verdict on a change to it is a verdict on
// its last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const SYS = { context: { isSystem: true } } as const;

const Project = ObjectSchema.create({
  name: 'oos_project',
  sharingModel: 'public_read_write',
  label: 'Project',
  pluralLabel: 'Projects',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const Task = ObjectSchema.create({
  name: 'oos_task',
  sharingModel: 'public_read_write',
  label: 'Task',
  pluralLabel: 'Tasks',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    project: Field.lookup('oos_project', { label: 'Project' }),
    // A computed copy of the project: a field no driver can filter by.
    project_ref: Field.formula({ label: 'Project ref', expression: 'record.project', returnType: 'text' } as never),
  },
});

const Timesheet = ObjectSchema.create({
  name: 'oos_timesheet',
  sharingModel: 'public_read_write',
  label: 'Timesheet',
  pluralLabel: 'Timesheets',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    project: Field.lookup('oos_project', { label: 'Project' }),
    task: Field.lookup('oos_task', { label: 'Task', dependsOn: [{ field: 'project', param: 'project' }] } as never),
    // The same scope, filtered by the task's formula copy of its project.
    task_by_ref: Field.lookup('oos_task', {
      label: 'Task by ref', dependsOn: [{ field: 'project', param: 'project_ref' }],
    } as never),
  },
});

const stackDef = defineStack({
  manifest: {
    id: 'com.dogfood.import-reference-out-of-scope',
    namespace: 'oos',
    version: '0.0.0',
    type: 'app',
    name: 'Import Reference Out Of Scope Fixture',
    description: 'A timesheet whose task lookup is scoped by its project: a task of another project is out of scope.',
  },
  objects: [Project, Task, Timesheet],
});

const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

/** CRUD on every fixture object, but the task's project is hidden from this member. */
const member = PermissionSetSchema.parse({
  name: 'oos_fixture_member',
  label: 'Out-of-scope fixture member',
  objects: { oos_project: crud, oos_task: crud, oos_timesheet: crud },
  fields: { 'oos_task.project': { readable: false, editable: false } },
});

type CellError = { field: string; code: string; message: string; scope?: Array<{ field: string; value: string }> };
type Row = { ok: boolean; code?: string; field?: string; error?: string; id?: string; errors?: CellError[] };

describe('[#36794] a scoped import lookup naming another parent\'s record answers reference_out_of_scope, on a real boot', () => {
  let stack: VerifyStack;
  const token: Record<'admin' | 'member', string> = { admin: '', member: '' };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    stack = await bootStack(stackDef as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, member],
        fallbackPermissionSet: member.name,
      }),
    });
    token.admin = await stack.signIn();
    token.member = await stack.signUp('oos-member@verify.test');
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    ids.apollo = String((await ql.insert('oos_project', { name: 'Apollo' }, SYS)).id);
    ids.gemini = String((await ql.insert('oos_project', { name: 'Gemini' }, SYS)).id);
    ids.design = String((await ql.insert('oos_task', { name: 'Design review', project: ids.apollo }, SYS)).id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  const importAs = async (who: string, rows: object[]): Promise<Row[]> => {
    const res = await stack.apiAs(who, 'POST', '/data/oos_timesheet/import', { format: 'json', rows });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { results: Row[] }).results;
  };
  const cells = (r: Row) => (r.errors ?? []).map(({ field, code, scope }) => ({ field, code, scope }));

  it('ARMED — the field guard refuses the member\'s filter on the hidden scope field, and serves the admin\'s', async () => {
    const asMember = await stack.apiAs(token.member, 'GET', `/data/oos_task?project=${ids.apollo}`);
    expect(asMember.status, await asMember.clone().text()).toBe(403);
    const asAdmin = await stack.apiAs(token.admin, 'GET', `/data/oos_task?project=${ids.apollo}`);
    expect(asAdmin.status, await asAdmin.clone().text()).toBe(200);
  });

  it('admin: a task of another project is reference_out_of_scope naming Project and its cell; one nobody has stays reference_not_found', async () => {
    const [inScope, outOfScope, missing] = await importAs(token.admin, [
      { name: 'TS-A1', project: 'Apollo', task: 'Design review' },   // the control: resolves under its own project
      { name: 'TS-A2', project: 'Gemini', task: 'Design review' },   // Apollo's task, the row says Gemini
      { name: 'TS-A3', project: 'Gemini', task: 'Retrospective' },   // no task has this name
    ]);
    expect(inScope!.ok, JSON.stringify(inScope)).toBe(true);
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    expect((await ql.find('oos_timesheet', { where: { id: inScope!.id }, ...SYS }))[0]?.task).toBe(ids.design);

    expect(outOfScope).toMatchObject({
      ok: false, field: 'task', code: 'reference_out_of_scope',
      error: 'Task: no record matches "Design review" (Project = "Gemini")',
    });
    expect(cells(outOfScope!)).toEqual([
      { field: 'task', code: 'reference_out_of_scope', scope: [{ field: 'project', value: 'Gemini' }] },
    ]);
    expect(missing).toMatchObject({ ok: false, field: 'task', code: 'reference_not_found' });
    expect(missing!.errors?.[0]).not.toHaveProperty('scope');
  });

  it('member who cannot read the scope field: reference_not_found with no scope, even for a task under the row\'s own project', async () => {
    const results = await importAs(token.member, [
      { name: 'TS-M1', project: 'Apollo', task: 'Design review' },   // the task IS Apollo's
      { name: 'TS-M2', project: 'Gemini', task: 'Design review' },   // the admin's out-of-scope row
    ]);
    for (const r of results) {
      expect(r, JSON.stringify(r)).toMatchObject({
        ok: false, field: 'task', code: 'reference_not_found', error: 'Task: no record matches "Design review"',
      });
      expect(cells(r)).toEqual([{ field: 'task', code: 'reference_not_found', scope: undefined }]);
    }
  });

  it('a dependsOn param naming a formula the engine cannot filter by: reference_not_found saying the lookup could not be made within the scope', async () => {
    const [row] = await importAs(token.admin, [{ name: 'TS-F1', project: 'Gemini', task_by_ref: 'Design review' }]);
    expect(row, JSON.stringify(row)).toMatchObject({
      ok: false, field: 'task_by_ref', code: 'reference_not_found',
      error: 'Task by ref: "Design review" could not be looked up within Project = "Gemini": the lookup\'s target '
        + 'cannot be filtered by that column, so the lookup field\'s dependsOn needs another one',
    });
    expect(row!.errors?.[0]).not.toHaveProperty('scope');
  });
});
