// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24468] A validation rule that reads, through a lookup, a field the
// lookup's target does not declare — on a real boot: the real `ObjectQL`, SQL
// driver, REST, auth and metadata layers.
//
// ## The two halves
//
// - The save door. `PUT /api/v1/meta/object/:name` refuses a rule condition
//   reading `record.account.region` when `rrh_account` declares no `region`,
//   under the existing `EXPRESSION_INVALID` rule, naming the field and the
//   target object. The same object with only the rule reading a declared field
//   saves.
// - The write. A rule already stored with such a read (here: declared in code,
//   which this door never judged) refuses every write, naming its own field;
//   a VALID sibling rule reading through the SAME lookup keeps the verdict it
//   gives alone — it admits an order on an open account and refuses one on a
//   closed account with its own message.
//
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const SYS = { context: { isSystem: true } } as const;
/** The valid rule: an order needs an account that is not closed. */
const VALID = "record.account.status == 'closed'";
const VALID_MESSAGE = 'RRHVALID81: the account is closed';
/** Reads a field `rrh_account` does not declare. */
const UNDECLARED = "record.account.region == 'north'";

const object = (name: string, fields: Record<string, unknown>, validations: unknown[]) =>
  ObjectSchema.create({ name, label: name, pluralLabel: name, sharingModel: 'public_read_write', fields, validations } as never);

const orderFields = () => ({
  label: Field.text({ label: 'Label' }),
  account: Field.lookup('rrh_account', { label: 'Account' }),
});
const validRule = { name: 'open_account', type: 'script', severity: 'error', message: VALID_MESSAGE, condition: VALID };
const badRule = { name: 'north_only', type: 'script', severity: 'error', message: 'RRHBAD82', condition: UNDECLARED };

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.rule-hop-undeclared', namespace: 'rrh', version: '0.0.0', type: 'app',
    name: 'Rule Hop Undeclared Field Fixture',
    description: 'Orders whose validation rules read through a lookup to an account.',
  },
  objects: [
    object('rrh_account', { status: Field.text({ label: 'Status' }) }, []),
    // The stored bad rule: declared in code, beside the valid sibling.
    object('rrh_order', orderFields(), [validRule, badRule]),
    // Control: the valid rule alone.
    object('rrh_order_alone', orderFields(), [validRule]),
  ],
});

/** The object body a `PUT /meta/object/:name` writes: plain JSON, as Studio or an AI author sends it. */
const saveBody = (name: string, validations: unknown[]) => ({
  name,
  label: name,
  pluralLabel: name,
  sharingModel: 'public_read_write',
  fields: {
    label: { type: 'text', label: 'Label' },
    account: { type: 'lookup', label: 'Account', reference: 'rrh_account' },
  },
  validations,
});

type Row = Record<string, any>;

describe('[#24468] a validation rule reading a field its lookup target does not declare', () => {
  let stack: VerifyStack;
  let token = '';
  let openId = '';
  let closedId = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  /** Every refusal text the write's response carries, joined. */
  const refusalText = (json: any): string => JSON.stringify(json ?? {});

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0]);
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    token = await stack.signIn();
    openId = String((await ql.insert('rrh_account', { status: 'open' }, SYS)).id);
    closedId = String((await ql.insert('rrh_account', { status: 'closed' }, SYS)).id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the save door refuses the rule, naming the field and the target object', async () => {
    const saved = await call('PUT', '/meta/object/rrh_order_saved', saveBody('rrh_order_saved', [validRule, badRule]));
    expect(saved.status, JSON.stringify(saved.json)).toBe(422);
    expect(saved.json?.code, JSON.stringify(saved.json)).toBe('INVALID_METADATA');
    const issues = (saved.json?.issues ?? []) as Row[];
    // The existing `EXPRESSION_INVALID` rule, located at the rule the author edits.
    expect(issues.map((i) => [i.rule, i.where]), JSON.stringify(saved.json)).toEqual([
      ['expression-invalid', "object 'rrh_order_saved' · validation 'north_only'"],
    ]);
    expect(String(issues[0].message)).toMatch(/^unknown field `region` on `rrh_account`/);
  });

  it('control: the same object with only the rule reading a declared field saves', async () => {
    const saved = await call('PUT', '/meta/object/rrh_order_ok', saveBody('rrh_order_ok', [validRule]));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  });

  it('control: the valid rule alone admits an open account and refuses a closed one', async () => {
    const open = await call('POST', '/data/rrh_order_alone', { label: 'open', account: openId });
    expect(open.status, JSON.stringify(open.json)).toBe(201);
    const closed = await call('POST', '/data/rrh_order_alone', { label: 'closed', account: closedId });
    expect(closed.status, JSON.stringify(closed.json)).toBe(400);
    expect(refusalText(closed.json)).toContain(VALID_MESSAGE);
  });

  it('beside a stored bad rule, the valid rule keeps its own verdict and the bad one names only its own field', async () => {
    // An open account: the valid rule admits it; only the bad rule refuses,
    // and the refusal names `region`, never the valid rule.
    const open = await call('POST', '/data/rrh_order', { label: 'open', account: openId });
    expect(open.status, JSON.stringify(open.json)).toBe(400);
    const openText = refusalText(open.json);
    expect(openText).toContain("Validation rule 'north_only' could not be evaluated");
    expect(openText).toContain("declares no 'region'");
    expect(openText).not.toContain("Validation rule 'open_account'");
    expect(openText).not.toContain(VALID_MESSAGE);

    // A closed account: the valid rule refuses with its OWN message, as alone.
    const closed = await call('POST', '/data/rrh_order', { label: 'closed', account: closedId });
    expect(closed.status, JSON.stringify(closed.json)).toBe(400);
    const closedText = refusalText(closed.json);
    expect(closedText).toContain(VALID_MESSAGE);
    expect(closedText).not.toContain("Validation rule 'open_account' could not be evaluated");
  });
});
