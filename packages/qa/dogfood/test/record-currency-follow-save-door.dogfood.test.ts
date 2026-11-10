// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D2 and D6, amended] The record-currency doors that read the
// registry's other objects, through the `/meta` save door of a real booted
// stack (sealed by its cold boot):
//
//  - a child amount following `PARENT_FIELD.CODE_FIELD` whose second segment
//    names no code field on the parent, and a `currencyMode: 'record'` roll-up
//    over a child amount that follows no record, are refused at the save,
//    `422 INVALID_METADATA`, with `defineStack`'s words; nothing is stored and
//    nothing is registered;
//  - D6's roll-up over a child amount in its own record currency is refused at
//    the save the same way;
//  - CONTROL: a child following its parent's code field saves `200` and
//    registers;
//  - the per-item publish (`POST /meta/object/:name/publish`) of a draft that
//    follows no code is refused the same way: the draft saved `200` (a draft
//    is judged when it is published), the publish answers `422`, and the
//    published row and the registered object stay as they were.
//
// Before, the save door judged the body alone: each refused body was stored,
// answered `200`, and left unregistered (its registration refused, logged);
// the per-item publish promoted the draft, answered `published`, and kept the
// old definition registered under the new stored row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const object = (name: string, fields: Record<string, unknown>) =>
  ObjectSchema.create({ name, label: name, pluralLabel: name, sharingModel: 'public_read_write', fields } as never);

const CODE = { valueDomain: 'iso_4217_currency' } as const;

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.record-currency-follow-save-door', namespace: 'rcf', version: '0.0.0', type: 'app',
    name: 'Record Currency Follow Save Door Fixture',
    description: 'An invoice with a code field, and two lines whose amounts follow no invoice.',
  },
  objects: [
    object('rcf_invoice', {
      title: Field.text({ label: 'Title' }),
      currency_code: Field.text({ label: 'Currency', ...CODE } as never),
    }),
    object('rcf_fixed_line', {
      invoice: Field.masterDetail('rcf_invoice', { label: 'Invoice' }),
      amount: Field.currency({ label: 'Amount', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } } as never),
    }),
    object('rcf_own_line', {
      invoice: Field.masterDetail('rcf_invoice', { label: 'Invoice' }),
      currency_code: Field.text({ label: 'Currency', ...CODE } as never),
      amount: Field.currency({ label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } } as never),
    }),
  ],
});

const lineBody = (name: string, pointer: string) => ({
  name, label: name, pluralLabel: name, sharingModel: 'public_read_write',
  fields: {
    title: { type: 'text', label: 'Title' },
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'rcf_invoice' },
    amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: pointer } },
  },
});

const rollupBody = (name: string, child: string, currencyConfig?: Record<string, unknown>) => ({
  name, label: name, pluralLabel: name, sharingModel: 'public_read_write',
  fields: {
    title: { type: 'text', label: 'Title' },
    currency_code: { type: 'text', label: 'Currency', ...CODE },
    total: {
      type: 'summary', label: 'Total',
      summaryOperations: { object: child, field: 'amount', function: 'sum' },
      ...(currencyConfig ? { currencyConfig } : {}),
    },
  },
});

describe('the /meta save door asks the record-currency doors that read other objects (ADR-0144 D2 and D6, amended)', () => {
  let stack: VerifyStack;
  let token = '';
  let ql: any;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  const codeOf = (json: any) => json?.code ?? json?.error?.code;
  const messageOf = (json: any) => String(json?.error?.message ?? json?.message ?? json?.error ?? '');

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0]);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** The refused save left nothing: no stored row, no registry entry. */
  const expectNothingLeft = async (name: string) => {
    expect((await call('GET', `/meta/object/${name}`)).status, name).toBe(404);
    expect(ql.registry.getObject(name), name).toBeUndefined();
  };

  it('the booted registry is sealed, so the follow door judges', () => {
    expect(ql.registry.bareNameHoldersAreSealed).toBe(true);
  });

  it('a child whose path names a field of the parent that holds no code is refused 422 at the save, and nothing is stored', async () => {
    const saved = await call('PUT', '/meta/object/rcf_bad_line', lineBody('rcf_bad_line', 'invoice.title'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(422);
    expect(codeOf(saved.json), JSON.stringify(saved.json)).toBe('INVALID_METADATA');
    expect(messageOf(saved.json)).toContain(
      "Object 'rcf_bad_line' field 'amount' currencyConfig.currencyField: 'invoice.title' follows 'rcf_invoice.title', a 'text' field that does not hold an ISO 4217 code",
    );
    await expectNothingLeft('rcf_bad_line');
  });

  it('a child whose path names no field of the parent is refused 422 at the save, and nothing is stored', async () => {
    const saved = await call('PUT', '/meta/object/rcf_missing_line', lineBody('rcf_missing_line', 'invoice.currency'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(422);
    expect(codeOf(saved.json)).toBe('INVALID_METADATA');
    expect(messageOf(saved.json)).toContain("'rcf_invoice' declares no field 'currency'");
    await expectNothingLeft('rcf_missing_line');
  });

  it('a `record` roll-up over a fixed child amount is refused 422 at the save, and nothing is stored', async () => {
    const saved = await call('PUT', '/meta/object/rcf_fixed_total', rollupBody(
      'rcf_fixed_total', 'rcf_fixed_line', { currencyMode: 'record', currencyField: 'currency_code' },
    ));
    expect(saved.status, JSON.stringify(saved.json)).toBe(422);
    expect(codeOf(saved.json)).toBe('INVALID_METADATA');
    expect(messageOf(saved.json)).toContain("'rcf_fixed_line.amount' is fixed to EUR");
    await expectNothingLeft('rcf_fixed_total');
  });

  it('D6: a roll-up over a child amount in its own record currency is refused 422 at the save, and nothing is stored', async () => {
    const saved = await call('PUT', '/meta/object/rcf_own_total', rollupBody('rcf_own_total', 'rcf_own_line'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(422);
    expect(codeOf(saved.json)).toBe('INVALID_METADATA');
    expect(messageOf(saved.json)).toContain('rolls up sum(rcf_own_line.amount)');
    await expectNothingLeft('rcf_own_total');
  });

  it('CONTROL: a child following its parent\'s code field saves 200 and registers', async () => {
    const saved = await call('PUT', '/meta/object/rcf_good_line', lineBody('rcf_good_line', 'invoice.currency_code'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(ql.registry.getObject('rcf_good_line')).toBeDefined();
  });

  it('the per-item publish of a draft that follows no code is refused 422, and the published row and registered object stay as they were', async () => {
    const name = 'rcf_pub_line';
    const followed = (json: any) => json?.item?.fields?.amount?.currencyConfig?.currencyField
      ?? json?.fields?.amount?.currencyConfig?.currencyField;
    // A published, registered child following the parent's code field.
    expect((await call('PUT', `/meta/object/${name}`, lineBody(name, 'invoice.currency_code'))).status).toBe(200);
    const before = await call('GET', `/meta/object/${name}`);
    expect(followed(before.json), JSON.stringify(before.json).slice(0, 400)).toBe('invoice.currency_code');
    // A draft repointing it at a field that holds no code saves (the re-point
    // is a destructive change, acknowledged with `force`): a draft is judged
    // at its publish.
    const draft = await call('PUT', `/meta/object/${name}?mode=draft&force=true`, lineBody(name, 'invoice.title'));
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    const published = await call('POST', `/meta/object/${name}/publish`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(422);
    expect(codeOf(published.json)).toBe('INVALID_METADATA');
    expect(messageOf(published.json)).toContain(
      "Object 'rcf_pub_line' field 'amount' currencyConfig.currencyField: 'invoice.title' follows 'rcf_invoice.title', a 'text' field that does not hold an ISO 4217 code",
    );
    const after = await call('GET', `/meta/object/${name}`);
    expect(after.status).toBe(200);
    expect(followed(after.json), JSON.stringify(after.json).slice(0, 400)).toBe('invoice.currency_code');
    expect((ql.registry.getObject(name)?.fields as any)?.amount?.currencyConfig?.currencyField).toBe('invoice.currency_code');
  });

  it('the per-item publish of a NEW object\'s draft that follows no code is refused 422, and nothing is published or registered', async () => {
    const name = 'rcf_pub_new_line';
    const draft = await call('PUT', `/meta/object/${name}?mode=draft`, lineBody(name, 'invoice.title'));
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    const published = await call('POST', `/meta/object/${name}/publish`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(422);
    expect(codeOf(published.json)).toBe('INVALID_METADATA');
    expect(messageOf(published.json)).toContain("'rcf_invoice.title', a 'text' field that does not hold an ISO 4217 code");
    await expectNothingLeft(name);
  });
});
