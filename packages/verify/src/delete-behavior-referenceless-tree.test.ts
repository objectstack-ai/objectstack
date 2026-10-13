// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#23065] A `tree` field that names no `reference` is a reference to the
// object that declares it, and a delete of a parent does what its
// `deleteBehavior` declares — read at the public doors, on a real stack.
//
// The contract already read the omission that way: `ObjectSchema`'s refusal of
// a foreign target tells authors to drop `reference`, and `FieldSchema`
// materializes `set_null` on the field. But no reader could read a target off a
// field alone, so the referential delete walk never reached it. Measured at this
// door on `origin/main` `275ad4229a`: `DELETE` of the parent answered `200` and
// the child kept the deleted id under `set_null`, `restrict` and `cascade`
// alike, while the same field written with its own object's name cleared.
//
// Now the doors that know the object write the self-reference down — the
// object parse (`defineStack`, this stack) and the engine's registry (a
// metadata save, whose body is stored verbatim, reaches it unparsed) — so the
// walk, and every other reader of the target, sees an ordinary self-reference.
//
// What is pinned, through the REST data door as the signed-in caller:
//   - `set_null` (the default the spec materializes) clears the child's parent;
//   - `restrict` refuses with `DELETE_RESTRICTED` naming the tree's own object;
//   - `cascade` deletes the subtree;
//   - the metadata save door: an object saved through `PUT /meta/object/:name`
//     with a referenceless tree clears the child too;
//   - `os verify --delete-behaviors` derives a case for the field and proves it
//     through both of its doors, instead of excluding it as "names no target";
//   - CONTROLS: a tree that writes its own name, a `lookup` and a
//     `master_detail` answer exactly as they always did.
//
// And the other readers of the same target, at the record doors (measured on
// `origin/main` `275ad4229a` before, on this stack after):
//   - the write-time reference check: a parent id that names no record is
//     refused `400` with `reference_not_found` (it was `201`, accepted) — the
//     one refusal this change adds at a data door; CONTROL: an existing parent
//     is accepted;
//   - `expand=parent` resolves the parent record (it was `404`, "declares no
//     target object");
//   - a nested relation condition `{ parent: { title } }` filters through the
//     parent (it was `400`, "declares no related object").

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';

import { bootStack, type VerifyStack } from './harness.js';
import { runDeleteBehaviorProofs, type DeleteBehaviorReport } from './delete-behavior.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;
const RUN_TIMEOUT = 120_000;

const treeNode = (name: string, parent: Record<string, unknown>) => ({
  name,
  label: name,
  fields: { title: { type: 'text', label: 'Title' }, parent: { type: 'tree', label: 'Parent', ...parent } },
});

const objects = [
  treeNode('rtl_default', {}),
  treeNode('rtl_restrict', { deleteBehavior: 'restrict' }),
  treeNode('rtl_cascade', { deleteBehavior: 'cascade' }),
  // CONTROLS.
  treeNode('rtl_written', { reference: 'rtl_written' }),
  { name: 'rtl_account', label: 'Account', fields: { title: { type: 'text', label: 'Title' } } },
  {
    name: 'rtl_contact',
    label: 'Contact',
    fields: {
      title: { type: 'text', label: 'Title' },
      account: { type: 'lookup', label: 'Account', reference: 'rtl_account' },
    },
  },
  {
    name: 'rtl_line',
    label: 'Line',
    fields: {
      title: { type: 'text', label: 'Title' },
      account: { type: 'master_detail', label: 'Account', reference: 'rtl_account' },
    },
  },
];

const config = defineStack({
  manifest: { id: 'com.example.referenceless-tree', namespace: 'rtl', version: '0.0.1', type: 'app', name: 'Referenceless Tree' },
  objects,
} as never);

describe('[#23065] a referenceless tree field — delete behaviour at the public doors', () => {
  let stack: VerifyStack;
  let token: string;
  let report: DeleteBehaviorReport;

  beforeAll(async () => {
    stack = await bootStack(config as never);
    token = await stack.signIn();
    report = await runDeleteBehaviorProofs(stack, token, config);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  const create = async (object: string, body: Record<string, unknown>): Promise<string> => {
    const res = await stack.apiAs(token, 'POST', `/data/${object}`, body);
    const text = await res.text();
    expect(res.status, `create ${object}: ${text}`).toBeLessThan(300);
    const parsed = JSON.parse(text) as { id?: unknown; record?: { id?: unknown } };
    return String(parsed.id ?? parsed.record?.id);
  };
  const read = async (object: string, id: string): Promise<{ status: number; record?: Record<string, unknown> }> => {
    const res = await stack.apiAs(token, 'GET', `/data/${object}/${id}`);
    const body = JSON.parse(await res.text()) as { record?: Record<string, unknown> };
    return { status: res.status, record: body.record };
  };
  const remove = async (object: string, id: string): Promise<{ status: number; body: any }> => {
    const res = await stack.apiAs(token, 'DELETE', `/data/${object}/${id}`);
    return { status: res.status, body: JSON.parse(await res.text()) };
  };

  it('set_null (the materialized default): DELETE of the parent clears the child\'s parent', async () => {
    const p = await create('rtl_default', { title: 'p' });
    const c = await create('rtl_default', { title: 'c', parent: p });

    expect((await remove('rtl_default', p)).status).toBe(200);

    const child = await read('rtl_default', c);
    expect(child.status).toBe(200);
    expect(child.record?.parent).toBeNull();
  });

  it('restrict: DELETE of the parent is refused with the envelope naming the tree\'s own object', async () => {
    const p = await create('rtl_restrict', { title: 'p' });
    const c = await create('rtl_restrict', { title: 'c', parent: p });

    const answer = await remove('rtl_restrict', p);

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'DELETE_RESTRICTED', object: 'rtl_restrict', dependentObject: 'rtl_restrict' });
    expect((await read('rtl_restrict', p)).status).toBe(200);
    expect((await read('rtl_restrict', c)).record?.parent).toBe(p);
  });

  it('cascade: DELETE of the parent deletes the subtree', async () => {
    const p = await create('rtl_cascade', { title: 'p' });
    const c = await create('rtl_cascade', { title: 'c', parent: p });
    const g = await create('rtl_cascade', { title: 'g', parent: c });
    const outside = await create('rtl_cascade', { title: 'outside' });

    expect((await remove('rtl_cascade', p)).status).toBe(200);

    expect((await read('rtl_cascade', c)).status).toBe(404);
    expect((await read('rtl_cascade', g)).status).toBe(404);
    expect((await read('rtl_cascade', outside)).status).toBe(200);
  });

  it('the metadata save door: an object saved with a referenceless tree clears the child too', async () => {
    // The save stores the authored body verbatim, so the registry receives the
    // field without the parse's output: the door the parse alone did not cover.
    const saved = await stack.apiAs(token, 'PUT', '/meta/object/rtl_saved', {
      name: 'rtl_saved',
      label: 'Saved',
      sharingModel: 'public_read_write',
      fields: { title: { type: 'text', label: 'Title' }, parent: { type: 'tree', label: 'Parent' } },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);

    const p = await create('rtl_saved', { title: 'p' });
    const c = await create('rtl_saved', { title: 'c', parent: p });

    expect((await remove('rtl_saved', p)).status).toBe(200);
    expect((await read('rtl_saved', c)).record?.parent).toBeNull();
  });

  it('os verify --delete-behaviors proves the referenceless fields through both doors', () => {
    for (const [object, declared] of [
      ['rtl_default', 'set_null'],
      ['rtl_restrict', 'restrict'],
      ['rtl_cascade', 'cascade'],
      ['rtl_written', 'set_null'],
    ] as const) {
      const r = report.results.find((x) => x.object === object && x.field === 'parent');
      expect(r, `${object}.parent: ${JSON.stringify(report.results.map((x) => [x.object, x.field, x.status]))}`).toBeDefined();
      expect(r!.status, `${object}.parent: ${JSON.stringify(r!.probes)}`).toBe('proven');
      expect(r!.declared).toBe(declared);
      expect(r!.probes.map((probe) => probe.door)).toEqual(['rest', 'system']);
    }
  });

  it('the write check: a parent id that names no record is refused 400 reference_not_found; an existing parent is accepted', async () => {
    const refused = await stack.apiAs(token, 'POST', '/data/rtl_default', { title: 'orphan', parent: 'no_such_parent_id' });
    const body = JSON.parse(await refused.text()) as { code?: string; fields?: Array<{ field?: string; code?: string }> };
    expect(refused.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'parent', code: 'reference_not_found' })]),
    );

    // CONTROL: a parent that exists is accepted, and stored as written.
    const p = await create('rtl_default', { title: 'p' });
    const c = await create('rtl_default', { title: 'c', parent: p });
    expect((await read('rtl_default', c)).record?.parent).toBe(p);
  });

  it('expand=parent resolves the parent record, and a nested relation condition filters through it', async () => {
    const p = await create('rtl_default', { title: 'expand-parent' });
    const c = await create('rtl_default', { title: 'expand-child', parent: p });

    const expanded = await stack.apiAs(token, 'GET', `/data/rtl_default/${c}?expand=parent`);
    const record = (JSON.parse(await expanded.text()) as { record?: { parent?: { id?: unknown; title?: unknown } } }).record;
    expect(expanded.status).toBe(200);
    expect(record?.parent).toMatchObject({ id: p, title: 'expand-parent' });

    const filter = encodeURIComponent(JSON.stringify({ parent: { title: 'expand-parent' } }));
    const listed = await stack.apiAs(token, 'GET', `/data/rtl_default?filter=${filter}`);
    const rows = (JSON.parse(await listed.text()) as { records?: Array<{ id?: unknown }> }).records;
    expect(listed.status).toBe(200);
    expect(rows?.map((r) => r.id)).toEqual([c]);
  });

  it('CONTROLS: a tree that writes its own name, a lookup and a master_detail answer as before', async () => {
    const p = await create('rtl_written', { title: 'p' });
    const c = await create('rtl_written', { title: 'c', parent: p });
    expect((await remove('rtl_written', p)).status).toBe(200);
    expect((await read('rtl_written', c)).record?.parent).toBeNull();

    const a = await create('rtl_account', { title: 'a' });
    const contact = await create('rtl_contact', { title: 'contact', account: a });
    const line = await create('rtl_line', { title: 'line', account: a });
    expect((await remove('rtl_account', a)).status).toBe(200);
    expect((await read('rtl_contact', contact)).record?.account).toBeNull();
    expect((await read('rtl_line', line)).status).toBe(404);
  });
});
