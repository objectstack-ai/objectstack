// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29894] An undeclared hook abort answers `HOOK_ABORTED` on the per-object
// batch row too, the code `/data`, `/createMany` and `/batch` give it.
//
// #27597 gave a sandboxed hook body's free-text refusal (`throw new Error('…')`,
// no `code`) the ledgered wire code `HOOK_ABORTED`. The per-object batch door
// (`POST /data/:object/batch`) reports a row failure through `toRowApiError`
// (`@objectstack/metadata-protocol`), which derived the code from the 400 the
// sibling doors serve, so its row said `VALIDATION_ERROR` for the same
// refusal. This file is the card's four-door reproduction over the real HTTP
// stack of one boot, plus the batch row's other modes and verbs, and the
// control that a code the hook DID declare still wins on every door.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const SENTENCE = 'A QA budget line needs an approver before it can be recorded.';
const DECLARED = 'This budget period is locked.';

const obj = (name: string) => ObjectSchema.create({
  name,
  sharingModel: 'public_read_write',
  label: name,
  pluralLabel: name,
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const throwUndeclared = { language: 'js', source: `throw new Error(${JSON.stringify(SENTENCE)});` } as const;

const stack29894 = defineStack({
  manifest: {
    id: 'com.dogfood.batch-row-hook-aborted',
    namespace: 'bra',
    version: '0.0.0',
    type: 'app',
    name: 'Batch Row Hook Aborted Fixture',
    description: 'Hooks that abort a write in their own words, with and without a declared code.',
  },
  objects: [obj('bra_ins'), obj('bra_upd'), obj('bra_del'), obj('bra_declared')],
  hooks: [
    { name: 'bra_ins_refuse', object: 'bra_ins', events: ['beforeInsert'], body: throwUndeclared },
    { name: 'bra_upd_refuse', object: 'bra_upd', events: ['beforeUpdate'], body: throwUndeclared },
    { name: 'bra_del_refuse', object: 'bra_del', events: ['beforeDelete'], body: throwUndeclared },
    {
      name: 'bra_declared_refuse',
      object: 'bra_declared',
      events: ['beforeInsert'],
      body: { language: 'js', source: `throw Object.assign(new Error(${JSON.stringify(DECLARED)}), { code: 'RECORD_LOCKED' });` },
    },
  ],
} as any);

const SYS = { context: { isSystem: true } } as const;

/** The failing row of a per-object batch answer: the one that is not a sibling's NOT_ATTEMPTED / ROLLED_BACK. */
function causalRowError(body: any): any {
  const rows: any[] = body?.results ?? body?.data?.results ?? body?.error?.details?.results ?? [];
  const errors = rows.flatMap((r) => r?.errors ?? []);
  return errors.find((e) => e?.code !== 'NOT_ATTEMPTED' && e?.code !== 'ROLLED_BACK');
}

describe('[#29894] an undeclared hook abort is HOOK_ABORTED on every data door, the batch row included', () => {
  let stack: VerifyStack;
  let admin = '';
  let ql: any;
  let updId = '';
  let delId = '';

  beforeAll(async () => {
    stack = await bootStack(stack29894 as never, {});
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    updId = String((await ql.insert('bra_upd', { name: 'seed' }, SYS))?.id);
    delId = String((await ql.insert('bra_del', { name: 'seed' }, SYS))?.id);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  describe('§1 the card: the whole-request doors answer 400 HOOK_ABORTED with the sentence', () => {
    const doors: Array<[string, () => Promise<Response>]> = [
      ['POST /data/OBJECT', () => stack.apiAs(admin, 'POST', '/data/bra_ins', { name: 'x' })],
      ['POST /data/OBJECT/createMany', () => stack.apiAs(admin, 'POST', '/data/bra_ins/createMany', [{ name: 'x' }])],
      ['POST /batch', () => stack.apiAs(admin, 'POST', '/batch', { operations: [{ action: 'create', object: 'bra_ins', data: { name: 'x' } }] })],
    ];
    for (const [door, send] of doors) {
      it(door, async () => {
        const res = await send();
        const body: any = await res.json();
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(JSON.stringify(body)).toContain(SENTENCE);
        expect(JSON.stringify(body)).toContain('"code":"HOOK_ABORTED"');
      });
    }
  });

  describe('§2 the per-object batch row answers the same code, in every mode and verb', () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ['create', () => stack.apiAs(admin, 'POST', '/data/bra_ins/batch', { operation: 'create', records: [{ data: { name: 'x' } }] })],
      ['create atomic', () => stack.apiAs(admin, 'POST', '/data/bra_ins/batch', { operation: 'create', records: [{ data: { name: 'x' } }, { data: { name: 'y' } }], options: { atomic: true } })],
      ['create continueOnError', () => stack.apiAs(admin, 'POST', '/data/bra_ins/batch', { operation: 'create', records: [{ data: { name: 'x' } }, { data: { name: 'y' } }], options: { continueOnError: true } })],
      ['update', () => stack.apiAs(admin, 'POST', '/data/bra_upd/batch', { operation: 'update', records: [{ id: updId, data: { name: 'moved' } }] })],
      ['upsert (existing id)', () => stack.apiAs(admin, 'POST', '/data/bra_upd/batch', { operation: 'upsert', records: [{ id: updId, data: { name: 'moved' } }] })],
      ['delete', () => stack.apiAs(admin, 'POST', '/data/bra_del/batch', { operation: 'delete', records: [{ id: delId }] })],
    ];
    for (const [label, send] of cases) {
      it(label, async () => {
        const res = await send();
        const body: any = await res.json();
        const row = causalRowError(body);
        expect(row, JSON.stringify(body)).toBeDefined();
        expect(row.message, JSON.stringify(body)).toBe(SENTENCE);
        expect(row.code, `#29894: the row answers the code its sibling doors give the same abort: ${JSON.stringify(body)}`).toBe('HOOK_ABORTED');
      });
    }

    it('nothing was written or moved', async () => {
      expect(await ql.find('bra_ins', { where: {}, ...SYS })).toHaveLength(0);
      const [upd] = await ql.find('bra_upd', { where: {}, ...SYS });
      expect(upd?.name).toBe('seed');
      expect(await ql.find('bra_del', { where: {}, ...SYS })).toHaveLength(1);
    });
  });

  describe('§3 control: a code the hook declared still wins on every door', () => {
    const doors: Array<[string, () => Promise<Response>]> = [
      ['POST /data/OBJECT', () => stack.apiAs(admin, 'POST', '/data/bra_declared', { name: 'x' })],
      ['POST /data/OBJECT/createMany', () => stack.apiAs(admin, 'POST', '/data/bra_declared/createMany', [{ name: 'x' }])],
      ['POST /batch', () => stack.apiAs(admin, 'POST', '/batch', { operations: [{ action: 'create', object: 'bra_declared', data: { name: 'x' } }] })],
    ];
    for (const [door, send] of doors) {
      it(door, async () => {
        const res = await send();
        const text = await res.text();
        expect(text).toContain(DECLARED);
        expect(text).toContain('"code":"RECORD_LOCKED"');
        expect(text).not.toContain('HOOK_ABORTED');
      });
    }

    it('POST /data/OBJECT/batch', async () => {
      const res = await stack.apiAs(admin, 'POST', '/data/bra_declared/batch', { operation: 'create', records: [{ data: { name: 'x' } }] });
      const body: any = await res.json();
      const row = causalRowError(body);
      expect(row?.message, JSON.stringify(body)).toBe(DECLARED);
      expect(row?.code, JSON.stringify(body)).toBe('RECORD_LOCKED');
    });
  });
});
