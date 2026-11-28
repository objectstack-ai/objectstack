// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#36806] The hand lock keeps every write path open (ruling record
// 7180466652, the two-tier field-lock model). `uiReadonly: true` locks a field
// against editing by hand at the console and NOTHING else: the engine's
// readonly strip keys on `readonly` alone, so a REST PATCH, an import and a
// declarative action all write the field, and the object's validations judge
// each write. Proven here over the real HTTP stack of a booted scratch app:
//
//  - a PATCH to the `uiReadonly` field lands, and the answer carries no
//    `X-ObjectStack-Dropped-Fields` (the control: the same PATCH to a
//    `readonly` sibling is stripped and advertised, as it always was);
//  - the object's `state_machine` judges the write the hand lock no longer
//    gates: an illegal move is refused with the machine's own message on the
//    PATCH door, the import door and the action door alike;
//  - a create that leaves the field out (what the console's create dialog
//    submits, since a hand-locked field is never in its payload) lands on the
//    field's `defaultValue`, and an API create outside `initialStates` is
//    refused by the machine, not by the lock.
//
// [#37402] The object level of the same model: an object whose
// `uiReadonlyWhen` locks a whole confirmed record by hand, with one field
// (`notes`) that overrides it with its own `uiReadonlyWhen: P\`false\``. The
// engine reads neither key, so on a confirmed record a PATCH, an import update
// and a declarative action still write, judged by the machine, and nothing is
// dropped; the served definition carries the predicate the console folds.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack, P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const OBJ = 'hlk_order';
const MACHINE_MESSAGE = 'An order moves draft, then submitted, then approved; an approved order never moves back.';
const idOf = (b: any): string => String(b?.id ?? b?.record?.id ?? b?.data?.id ?? '');
const recordOf = (b: any) => b?.record ?? b?.data ?? b;

const order = ObjectSchema.create({
  name: OBJ,
  label: 'Order',
  pluralLabel: 'Orders',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: {
      ...Field.select(['draft', 'submitted', 'approved'], { label: 'Status' }),
      defaultValue: 'draft',
      uiReadonly: true,
    },
    locked_note: Field.text({ label: 'Locked note', readonly: true }),
  },
  validations: [
    {
      type: 'state_machine',
      name: 'hlk_order_flow',
      message: MACHINE_MESSAGE,
      field: 'status',
      initialStates: ['draft'],
      transitions: { draft: ['submitted'], submitted: ['approved', 'draft'], approved: [] },
    },
  ],
  actions: [
    { name: 'hlk_submit', label: 'Submit', objectName: OBJ, operation: 'update', patch: { status: 'submitted' } },
    { name: 'hlk_back_to_draft', label: 'Back to draft', objectName: OBJ, operation: 'update', patch: { status: 'draft' } },
  ],
} as never);

const LOCKED = 'hlk_locked_order';
const LOCKED_MESSAGE = 'An order moves draft, then confirmed, then done.';

const lockedOrder = ObjectSchema.create({
  name: LOCKED,
  label: 'Locked order',
  pluralLabel: 'Locked orders',
  uiReadonlyWhen: P`record.status in ['confirmed', 'done']`,
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: {
      ...Field.select(['draft', 'confirmed', 'done'], { label: 'Status' }),
      defaultValue: 'draft',
    },
    amount: Field.number({ label: 'Amount' }),
    notes: { ...Field.text({ label: 'Notes' }), uiReadonlyWhen: P`false` },
  },
  validations: [
    {
      type: 'state_machine',
      name: 'hlk_locked_order_flow',
      message: LOCKED_MESSAGE,
      field: 'status',
      initialStates: ['draft'],
      transitions: { draft: ['confirmed'], confirmed: ['done'], done: [] },
    },
  ],
  actions: [
    { name: 'hlk_locked_finish', label: 'Finish', objectName: LOCKED, operation: 'update', patch: { status: 'done', amount: 99 } },
  ],
} as never);

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.ui-readonly-hand-lock',
    namespace: 'hlk',
    version: '0.0.0',
    type: 'app',
    name: 'Hand Lock Fixture',
    description: 'One object whose status is locked by hand at the console and judged by a state machine on every write.',
  },
  objects: [order, lockedOrder],
} as never);

// One booted stack for both describes below (the field level and the object level).
let stack: VerifyStack;
let admin = '';

beforeAll(async () => {
  stack = await bootStack(stackConfig as never);
  admin = await stack.signIn();
}, 240_000);

afterAll(async () => {
  await stack?.stop?.();
});

describe('[#36806] a uiReadonly field keeps every write path, judged by the validations', () => {

  const create = async (name: string): Promise<string> => {
    const res = await stack.apiAs(admin, 'POST', `/data/${OBJ}`, { name });
    expect(res.status, await res.clone().text()).toBe(201);
    return idOf(await res.json());
  };
  const statusOf = async (id: string) =>
    recordOf(await (await stack.apiAs(admin, 'GET', `/data/${OBJ}/${id}`)).json()).status;
  /** Walk a fresh order to `approved` through the PATCH door. */
  const approved = async (name: string): Promise<string> => {
    const id = await create(name);
    for (const status of ['submitted', 'approved']) {
      const res = await stack.apiAs(admin, 'PATCH', `/data/${OBJ}/${id}`, { status });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    expect(await statusOf(id)).toBe('approved');
    return id;
  };

  it('a create that leaves the hand-locked field out lands on its defaultValue', async () => {
    const id = await create('hlk default');
    expect(await statusOf(id)).toBe('draft');
  });

  it('a PATCH to the uiReadonly field lands with no X-ObjectStack-Dropped-Fields; a readonly sibling is still stripped', async () => {
    const id = await create('hlk patch');
    const res = await stack.apiAs(admin, 'PATCH', `/data/${OBJ}/${id}`, { status: 'submitted' });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(res.headers.get('X-ObjectStack-Dropped-Fields')).toBeNull();
    expect(body?.droppedFields, JSON.stringify(body?.droppedFields)).toBeUndefined();
    expect(await statusOf(id)).toBe('submitted');

    // The control: the server lock still strips, and says so.
    const control = await stack.apiAs(admin, 'PATCH', `/data/${OBJ}/${id}`, { locked_note: 'forged' });
    expect(control.status).toBe(200);
    expect(control.headers.get('X-ObjectStack-Dropped-Fields') ?? '').toContain('locked_note;reason=readonly');
  });

  it('PATCH door: an illegal move is refused with the state machine\'s message, and the field keeps its value', async () => {
    const id = await approved('hlk patch refused');
    const res = await stack.apiAs(admin, 'PATCH', `/data/${OBJ}/${id}`, { status: 'draft' });
    const body: any = await res.json();
    const code = body?.error?.code ?? body?.code;
    expect({ status: res.status, code }, JSON.stringify(body)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(body)).toContain(MACHINE_MESSAGE);
    expect(await statusOf(id)).toBe('approved');
  });

  it('action door: a declarative update writes the field, and the machine refuses an illegal move', async () => {
    const id = await create('hlk action');
    const ok = await stack.apiAs(admin, 'POST', `/actions/${OBJ}/hlk_submit`, { recordId: id });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await statusOf(id)).toBe('submitted');

    const lockedId = await approved('hlk action refused');
    const res = await stack.apiAs(admin, 'POST', `/actions/${OBJ}/hlk_back_to_draft`, { recordId: lockedId });
    const body: any = await res.json();
    const code = body?.error?.code ?? body?.code;
    expect({ status: res.status, code }, JSON.stringify(body)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(body)).toContain(MACHINE_MESSAGE);
    expect(await statusOf(lockedId)).toBe('approved');
  });

  it('import door: an update row writes the field, and the machine refuses an illegal move on its row', async () => {
    const movable = await create('hlk import');
    const lockedId = await approved('hlk import refused');
    const res = await stack.apiAs(admin, 'POST', `/data/${OBJ}/import`, {
      format: 'json',
      writeMode: 'update',
      matchFields: ['id'],
      rows: [{ id: movable, status: 'submitted' }, { id: lockedId, status: 'draft' }],
    });
    const report: any = await res.json();
    expect(res.status, JSON.stringify(report)).toBe(200);
    expect(report.results?.[0]?.ok, JSON.stringify(report.results)).toBe(true);
    expect(report.results?.[1]?.ok, JSON.stringify(report.results)).toBe(false);
    expect(JSON.stringify(report.results?.[1])).toContain(MACHINE_MESSAGE);
    expect(await statusOf(movable)).toBe('submitted');
    expect(await statusOf(lockedId)).toBe('approved');
  });

  it('an API create outside initialStates is refused by the machine, not by the lock', async () => {
    const res = await stack.apiAs(admin, 'POST', `/data/${OBJ}`, { name: 'hlk born approved', status: 'approved' });
    const body: any = await res.json();
    const code = body?.error?.code ?? body?.code;
    expect({ status: res.status, code }, JSON.stringify(body)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });
});

describe('[#37402] an object-level uiReadonlyWhen keeps every write path on a locked record', () => {
  const create = async (name: string): Promise<string> => {
    const res = await stack.apiAs(admin, 'POST', `/data/${LOCKED}`, { name, amount: 1, notes: 'n' });
    expect(res.status, await res.clone().text()).toBe(201);
    return idOf(await res.json());
  };
  const read = async (id: string) =>
    recordOf(await (await stack.apiAs(admin, 'GET', `/data/${LOCKED}/${id}`)).json());
  /** A fresh order moved to `confirmed` — the state the object's hand lock holds. */
  const confirmed = async (name: string): Promise<string> => {
    const id = await create(name);
    const res = await stack.apiAs(admin, 'PATCH', `/data/${LOCKED}/${id}`, { status: 'confirmed' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await read(id)).status).toBe('confirmed');
    return id;
  };

  it('the served definition carries the object predicate and the field override the console folds', async () => {
    const res = await stack.apiAs(admin, 'GET', `/meta/object/${LOCKED}`);
    expect(res.status).toBe(200);
    const item: any = ((await res.json()) as { item?: unknown }).item;
    const source = (p: unknown) => (typeof p === 'string' ? p : (p as { source?: string } | undefined)?.source);
    expect(source(item?.uiReadonlyWhen)).toBe("record.status in ['confirmed', 'done']");
    expect(source(item?.fields?.notes?.uiReadonlyWhen)).toBe('false');
  });

  it('a PATCH to a confirmed record writes every field and drops none', async () => {
    const id = await confirmed('hlo patch');
    const res = await stack.apiAs(admin, 'PATCH', `/data/${LOCKED}/${id}`, { amount: 7, notes: 'changed', name: 'hlo patched' });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(res.headers.get('X-ObjectStack-Dropped-Fields')).toBeNull();
    expect(body?.droppedFields, JSON.stringify(body?.droppedFields)).toBeUndefined();
    expect(await read(id)).toMatchObject({ amount: 7, notes: 'changed', name: 'hlo patched', status: 'confirmed' });
  });

  it('an import update on a confirmed record writes, and the machine still judges the lifecycle field', async () => {
    const id = await confirmed('hlo import');
    const refused = await confirmed('hlo import refused');
    const res = await stack.apiAs(admin, 'POST', `/data/${LOCKED}/import`, {
      format: 'json',
      writeMode: 'update',
      matchFields: ['id'],
      rows: [{ id, amount: 42 }, { id: refused, status: 'draft' }],
    });
    const report: any = await res.json();
    expect(res.status, JSON.stringify(report)).toBe(200);
    expect(report.results?.[0]?.ok, JSON.stringify(report.results)).toBe(true);
    expect(report.results?.[1]?.ok, JSON.stringify(report.results)).toBe(false);
    expect(JSON.stringify(report.results?.[1])).toContain(LOCKED_MESSAGE);
    expect((await read(id)).amount).toBe(42);
    expect((await read(refused)).status).toBe('confirmed');
  });

  it('a declarative action on a confirmed record writes the fields it patches', async () => {
    const id = await confirmed('hlo action');
    const res = await stack.apiAs(admin, 'POST', `/actions/${LOCKED}/hlk_locked_finish`, { recordId: id });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await read(id)).toMatchObject({ status: 'done', amount: 99 });
  });
});
