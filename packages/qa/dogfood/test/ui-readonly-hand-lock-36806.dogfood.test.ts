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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
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

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.ui-readonly-hand-lock',
    namespace: 'hlk',
    version: '0.0.0',
    type: 'app',
    name: 'Hand Lock Fixture',
    description: 'One object whose status is locked by hand at the console and judged by a state machine on every write.',
  },
  objects: [order],
} as never);

describe('[#36806] a uiReadonly field keeps every write path, judged by the validations', () => {
  let stack: VerifyStack;
  let admin = '';

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

  beforeAll(async () => {
    stack = await bootStack(stackConfig as never);
    admin = await stack.signIn();
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

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
