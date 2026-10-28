// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27008] The in-process engine refuses an empty projection, as every
 * published declaration of a read's projection does.
 *
 * #26817, #26909 and #26954 settled one rule: an empty projection is refused,
 * never read as every column. The HTTP doors refuse `select: []`
 * (`projectionFieldsValue`, `400 VALIDATION_ERROR`) and
 * `EngineQueryOptionsSchema.fields` declares the same refusal, but
 * `ObjectQL.find` / `findOne` never parse their options with that schema. Their
 * projection guards ran only when `ast.fields.length > 0`, so `fields: []`
 * reached the driver, and every driver serves an empty projection as none:
 * owner, organization and audit columns came back, and the caller was not told.
 *
 * Driven against a REAL {@link ObjectQL} engine over a driver double that
 * projects exactly (an empty list answers every column, as `SqlDriver` and
 * `InMemoryDriver` do) and counts its reads, so "refused before any driver
 * call" is measured rather than assumed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { EngineQueryOptionsSchema } from '@objectstack/spec/data';
import { mapDataError } from '@objectstack/types';
import { ObjectQL } from './engine.js';

const projectObject = {
  name: 'proj_27008',
  label: 'Project',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

const taskObject = {
  name: 'task_27008',
  label: 'Task',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    project_id: { name: 'project_id', label: 'Project', type: 'lookup' as const, reference: 'proj_27008' },
  },
};

/** The declarations' own refusal words, read off the published schema. */
const declaredRefusal = (): string => {
  const parsed = EngineQueryOptionsSchema.shape.fields.safeParse([]);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues[0].message;
};

function makeDriver() {
  const rows: Record<string, Record<string, unknown>[]> = {
    proj_27008: [{ id: 'p1', name: 'Apollo', owner_id: 'usr_1', organization_id: 'org_1' }],
    task_27008: [{
      id: 't1', title: 'Ship', project_id: 'p1',
      owner_id: 'usr_1', organization_id: 'org_1', created_at: '2026-10-28T00:00:00.000Z',
    }],
  };
  const reads: Array<{ object: string; fields: unknown }> = [];
  const project = (row: Record<string, unknown>, fields: unknown) =>
    Array.isArray(fields) && fields.length > 0
      ? Object.fromEntries(fields.map((f: string) => [f, row[f]]))
      : { ...row };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((arm) => matches(row, arm))) return false;
        continue;
      }
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.map(String).includes(String(row[k]))) return false;
        continue;
      }
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if (row[k] !== expected) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      reads.push({ object, fields: ast?.fields });
      const matched = (rows[object] ?? []).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map((r) => project(r, ast?.fields));
    },
    async findOne(object: string, ast: any) {
      reads.push({ object, fields: ast?.fields });
      const hit = (rows[object] ?? []).find((r) => matches(r, ast?.where));
      return hit ? project(hit, ast?.fields) : null;
    },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count(object: string) { return (rows[object] ?? []).length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

/** The refusal as the REST door would answer it: `mapDataError`'s status and code. */
async function wireAnswer(read: Promise<unknown>) {
  const err = await read.then(
    () => { throw new Error('expected a refusal, got an answer'); },
    (e: unknown) => e,
  );
  const mapped = mapDataError(err);
  return { status: mapped.status, code: mapped.body.code, message: (err as Error).message };
}

describe('[#27008] the in-process engine refuses an empty projection', () => {
  let engine: ObjectQL;
  let reads: Array<{ object: string; fields: unknown }>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const made = makeDriver();
    reads = made.reads;
    engine.registerDriver(made.driver, true);
    await engine.init();
    engine.registry.registerObject(projectObject, 'test-package');
    engine.registry.registerObject(taskObject, 'test-package');
  });

  it('find with fields: [] is refused 400 VALIDATION_ERROR in the declarations\' words, before any driver read', async () => {
    const answer = await wireAnswer(engine.find('task_27008', { fields: [] }));
    expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(answer.message).toContain(declaredRefusal());
    expect(answer.message).toMatch(/^ObjectQL\.find\('task_27008'\) names no field in 'fields'/);
    expect(reads).toEqual([]);
  });

  it('findOne with fields: [] is refused the same way, before any driver read', async () => {
    const answer = await wireAnswer(engine.findOne('task_27008', { where: { id: 't1' }, fields: [] }));
    expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(answer.message).toContain(declaredRefusal());
    expect(answer.message).toMatch(/^ObjectQL\.findOne\('task_27008'\)/);
    expect(reads).toEqual([]);
  });

  it('a system-context read is refused too: the rule is about the shape, not the caller', async () => {
    const answer = await wireAnswer(engine.find('task_27008', { fields: [], context: { isSystem: true } }));
    expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(reads).toEqual([]);
  });

  it('an expand sub-read with fields: [] is refused at the entry, not swallowed into a bare foreign key', async () => {
    // The expansion's own `catch` keeps the foreign key on a sub-read failure,
    // so a refusal raised only inside the sub-read would degrade silently. The
    // entry judges the nested projection before the parent row is read.
    const answer = await wireAnswer(engine.find('task_27008', {
      expand: { project_id: { object: 'proj_27008', fields: [] } },
    }));
    expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(answer.message).toContain(declaredRefusal());
    expect(answer.message).toContain("expand['project_id']");
    expect(reads).toEqual([]);
  });

  it('a deeper expand level is judged too', async () => {
    const answer = await wireAnswer(engine.findOne('task_27008', {
      where: { id: 't1' },
      expand: { project_id: { object: 'proj_27008', fields: ['name'], expand: { owner: { object: 'sys_user', fields: [] } } } },
    }));
    expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(answer.message).toContain("expand['project_id'].expand['owner']");
    expect(reads).toEqual([]);
  });

  it('the REST door answers the same status and code for the same projection', async () => {
    const protocol = new ObjectStackProtocolImplementation(engine);
    const door = await wireAnswer(protocol.findData({ object: 'task_27008', query: { select: [] } }));
    const inProcess = await wireAnswer(engine.find('task_27008', { fields: [] }));
    expect({ status: inProcess.status, code: inProcess.code }).toEqual({ status: door.status, code: door.code });
    expect(door).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(door.message).toContain(declaredRefusal());
    expect(reads).toEqual([]);
  });

  // ─── Controls ────────────────────────────────────────────────────

  it('CONTROL: an absent fields still reads every column', async () => {
    const [row] = await engine.find('task_27008', {});
    expect(row).toMatchObject({ id: 't1', title: 'Ship', owner_id: 'usr_1', organization_id: 'org_1' });
    expect(reads).toHaveLength(1);
  });

  it('CONTROL: fields: null is a withdrawal and reads every column', async () => {
    const [row] = await engine.find('task_27008', { fields: null as unknown as string[] });
    expect(row).toMatchObject({ id: 't1', title: 'Ship', owner_id: 'usr_1' });
  });

  it('CONTROL: a named projection projects', async () => {
    const [row] = await engine.find('task_27008', { fields: ['title'] });
    expect(row).toEqual({ title: 'Ship' });
    const one = await engine.findOne('task_27008', { where: { id: 't1' }, fields: ['title'] });
    expect(one).toEqual({ title: 'Ship' });
  });

  it('CONTROL: an expand with a named nested projection still expands', async () => {
    const [row] = await engine.find('task_27008', {
      fields: ['title', 'project_id'],
      expand: { project_id: { object: 'proj_27008', fields: ['name'] } },
    });
    expect(row).toEqual({ title: 'Ship', project_id: { name: 'Apollo' } });
  });
});
