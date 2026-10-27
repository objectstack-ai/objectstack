// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.write-time-option-and-element-shape-judgement`
// (#26573): its four api clauses pinned at the REST doors of a booted stack —
// `POST/PATCH /data/:object` and `POST /data/:object/import` — the layer their
// oracle names. The objectql pins in the item's `automated.ref` drive the
// engine or `runImport` over the protocol in-process, so they are evidence of
// their own layer, never these clauses' pass (RUNNER rule 6).
//
//   acceptance[1] — picking an option whose `visibleWhen` cannot be evaluated
//     → 400 VALIDATION_FAILED, `rule_violation`, `constraint.reason:
//     'unevaluable'`; nothing is stored.
//   acceptance[2] — an import with `createMissingOptions` stores an unmatched
//     select value and its dry run agrees; a later PATCH sending that value
//     back → `invalid_option`.
//   acceptance[3] — the dry run of a MATCHED row (update mode) admits exactly
//     where the real import admits, and refuses where it refuses.
//   acceptance[4] — each malformed element of a multi-valued lookup → 400
//     VALIDATION_FAILED `invalid_type`, naming the element's index.
//
// The fixture is synthetic. The faulting `visibleWhen` reads a misspelt key
// (`record.statsu`); declared in code, it is never judged by the metadata save
// door, which is the shape the item's "stored with
// OS_ALLOW_UNLINTED_METADATA_WRITES=1" step reaches on a live boot.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const SYS = { context: { isSystem: true } } as const;
const ITEM = 'wto_item';
const TARGET = 'wto_target';

const wtoStack = defineStack({
  manifest: {
    id: 'com.dogfood.write-time-option', namespace: 'wto', version: '0.0.0', type: 'app',
    name: 'Write-time option and element shape fixture',
    description: 'A faulting option gate, a kept-option import, a matched-row dry run and a multi lookup.',
  },
  objects: [
    ObjectSchema.create({
      name: TARGET, label: 'Target', pluralLabel: 'Targets', sharingModel: 'public_read_write',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
    ObjectSchema.create({
      name: ITEM, label: 'Item', pluralLabel: 'Items', sharingModel: 'public_read_write',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        status: Field.text({ label: 'Status' }),
        tier: Field.select({
          label: 'Tier',
          options: [
            { label: 'Gold', value: 'gold', visibleWhen: "record.statsu == 'vip'" },
            { label: 'Silver', value: 'silver' },
          ],
        }),
        priority: Field.select({
          label: 'Priority',
          options: [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }],
        }),
        country: Field.select({
          label: 'Country',
          options: [{ label: 'China', value: 'cn' }, { label: 'United States', value: 'us' }],
        }),
        note: Field.text({ label: 'Note', requiredWhen: "record.country == 'us'" }),
        refs: Field.lookup(TARGET, { label: 'Refs', multiple: true }),
      },
    } as never),
  ],
} as never);

type Answer = { status: number; json: any };

describe('records-forms.write-time-option-and-element-shape-judgement — over REST', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const importRows = (rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    call('POST', `/data/${ITEM}/import`, { format: 'json', rows, ...extra });
  /** One row's verdict, as the import answer reports it. */
  const verdicts = (json: any) =>
    ((json?.results ?? []) as any[]).map((r) => ({ ok: r.ok, action: r.action, ...(r.ok ? {} : { field: r.field, code: r.code }) }));

  beforeAll(async () => {
    stack = await bootStack(wtoStack);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1]: picking the option whose visibleWhen faults is 400 rule_violation, reason unevaluable, and nothing is stored', async () => {
    const res = await call('POST', `/data/${ITEM}`, { name: 'wto-gold', tier: 'gold' });
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    expect(res.json.code).toBe('VALIDATION_FAILED');
    expect(res.json.fields, JSON.stringify(res.json)).toEqual([
      expect.objectContaining({
        field: 'tier', code: 'rule_violation',
        constraint: expect.objectContaining({ rule: 'visibleWhen', reason: 'unevaluable' }),
      }),
    ]);
    expect(await stack.rows(ITEM, { name: 'wto-gold' })).toHaveLength(0);
    // Control: the option with no gate is admitted.
    const ok = await call('POST', `/data/${ITEM}`, { name: 'wto-silver', tier: 'silver' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
  });

  it('acceptance[2]: createMissingOptions stores the unmatched value, its dry run agrees, and a later PATCH sending it back is invalid_option', async () => {
    const dry = await importRows([{ name: 'wto-kept', priority: 'urgent' }], { createMissingOptions: true, dryRun: true });
    expect(dry.status, JSON.stringify(dry.json)).toBe(200);
    expect(await stack.rows(ITEM, { name: 'wto-kept' })).toHaveLength(0);

    const real = await importRows([{ name: 'wto-kept', priority: 'urgent' }], { createMissingOptions: true });
    expect(real.status, JSON.stringify(real.json)).toBe(200);
    expect(verdicts(real.json)).toEqual([{ ok: true, action: 'created' }]);
    expect(verdicts(dry.json)).toEqual(verdicts(real.json));
    const [stored] = await stack.rows(ITEM, { name: 'wto-kept' });
    expect(stored.priority).toBe('urgent');

    // Control: with the option off, the same cell is refused.
    const off = await importRows([{ name: 'wto-off', priority: 'urgent' }]);
    expect(verdicts(off.json), JSON.stringify(off.json)).toEqual([
      { ok: false, action: 'failed', field: 'priority', code: 'invalid_option' },
    ]);

    const patched = await call('PATCH', `/data/${ITEM}/${stored.id}`, { priority: 'urgent' });
    expect(patched.status, JSON.stringify(patched.json)).toBe(400);
    expect(patched.json.code).toBe('VALIDATION_FAILED');
    expect((patched.json.fields ?? []).map((f: any) => [f.field, f.code])).toEqual([['priority', 'invalid_option']]);
    // The row stays editable: a patch that leaves the field out is admitted.
    const other = await call('PATCH', `/data/${ITEM}/${stored.id}`, { status: 'touched' });
    expect(other.status, JSON.stringify(other.json)).toBe(200);
  });

  it('acceptance[3]: the dry run of a matched row admits where the import admits, and refuses where it refuses', async () => {
    await ql.insert(ITEM, { name: 'wto-matched', country: 'cn' }, SYS);
    const update = { writeMode: 'update', matchFields: ['name'] };

    // `note`'s requiredWhen reads `country`, which the row omits: judged against the stored row.
    const admitDry = await importRows([{ name: 'wto-matched', note: 'x' }], { ...update, dryRun: true });
    expect(verdicts(admitDry.json), JSON.stringify(admitDry.json)).toEqual([{ ok: true, action: 'updated' }]);
    const [untouched] = await stack.rows(ITEM, { name: 'wto-matched' });
    expect(untouched.note ?? null).toBeNull();
    const admitReal = await importRows([{ name: 'wto-matched', note: 'x' }], update);
    expect(verdicts(admitReal.json)).toEqual(verdicts(admitDry.json));

    // Control: a matched row whose merge really violates the rule is refused by both.
    await ql.insert(ITEM, { name: 'wto-matched-2', country: 'cn' }, SYS);
    const refuseDry = await importRows([{ name: 'wto-matched-2', country: 'us' }], { ...update, dryRun: true });
    expect(verdicts(refuseDry.json), JSON.stringify(refuseDry.json)).toEqual([
      { ok: false, action: 'failed', field: 'note', code: 'required' },
    ]);
    const refuseReal = await importRows([{ name: 'wto-matched-2', country: 'us' }], update);
    expect(verdicts(refuseReal.json)).toEqual(verdicts(refuseDry.json));
    const [kept] = await stack.rows(ITEM, { name: 'wto-matched-2' });
    expect(kept.country).toBe('cn');
  });

  it('acceptance[4]: each malformed multi-lookup element is 400 invalid_type naming its index', async () => {
    const target = await ql.insert(TARGET, { name: 'wto-target' }, SYS);
    for (const [label, bad] of [['an object', { id: target.id }], ['false', false], ['a number', 42]] as const) {
      const name = `wto-refs-${label.replace(/\s/g, '-')}`;
      const res = await call('POST', `/data/${ITEM}`, { name, refs: [target.id, bad] });
      expect(res.status, `${label}: ${JSON.stringify(res.json)}`).toBe(400);
      expect(res.json.code).toBe('VALIDATION_FAILED');
      const [entry] = res.json.fields ?? [];
      expect(entry, `${label}: ${JSON.stringify(res.json)}`).toMatchObject({ field: 'refs', code: 'invalid_type' });
      expect(String(entry.constraint?.detail), `${label}: the refusal names the index`).toMatch(/^at index 1:/);
      expect(await stack.rows(ITEM, { name })).toHaveLength(0);
    }
    // Control: well-formed ids are stored.
    const ok = await call('POST', `/data/${ITEM}`, { name: 'wto-refs-ok', refs: [target.id] });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
  });
});
