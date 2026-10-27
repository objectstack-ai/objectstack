// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.predicate-relationship-traversal` (#26573): a
// validation rule reads a parent field one hop through a lookup — pinned at
// the layer the item's oracle names, the REST data door of a booted stack.
// Its engine pin (`packages/objectql/src/engine-predicate-relationship.test.ts`)
// drives ObjectQL directly and so scores no api clause (RUNNER rule 6).
//
// ## Two boots
//
// - The showcase itself, as shipped: `showcase_invoice` carries
//   `no_invoice_for_churned_account` (`record.account.status == 'churned'`),
//   and the seed carries churned and non-churned accounts. The admin writes an
//   invoice against each (acceptance[0], acceptance[1], negative[0],
//   negative[1]) and repoints a stored invoice at a churned account with a
//   patch that carries no status (acceptance[2]).
// - A scratch pair for the persona the rule exists to constrain, which no
//   stock showcase persona is (the item's fixtures.knownGaps): a member with
//   create/edit on the child object and NO grant at all on the lookup's
//   parent. The member writes against a non-tripping and a tripping parent
//   (acceptance[3], negative[2]); a read of the parent as that member is the
//   control that the persona really cannot read it.
//
// The refusal is scored on the envelope — 400 VALIDATION_FAILED, the
// `_record` / `rule_violation` entry — and on the AUTHORED message, which is
// the one place the item names wording as the contract. A refusal that reads
// "could not be evaluated" is the pre-capability fault, and every case below
// asserts it is absent.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack, P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } } as const;
const UNEVALUABLE = 'could not be evaluated';

/** The message `no_invoice_for_churned_account` declares (examples/app-showcase invoice.object.ts). */
const CHURNED_MESSAGE = 'This account has churned — reactivate it before invoicing.';

type Answer = { status: number; json: any };

const ruleEntries = (json: any) =>
  ((json?.fields ?? []) as any[]).map((f) => ({ field: f.field, code: f.code, message: f.message }));

/** The refusal shape acceptance[1] names: one `_record` rule_violation carrying `message`. */
function expectRuleRefusal(answer: Answer, message: string) {
  expect(answer.status, JSON.stringify(answer.json)).toBe(400);
  expect(answer.json?.code, JSON.stringify(answer.json)).toBe('VALIDATION_FAILED');
  expect(ruleEntries(answer.json)).toEqual([{ field: '_record', code: 'rule_violation', message }]);
  expect(JSON.stringify(answer.json)).not.toContain(UNEVALUABLE);
}

function expectAdmitted(answer: Answer) {
  expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(300);
  expect(JSON.stringify(answer.json)).not.toContain(UNEVALUABLE);
}

const createdId = (json: any): string => String(json?.id ?? json?.record?.id ?? json?.data?.id ?? '');

describe('records-forms.predicate-relationship-traversal — the showcase invoice rule over REST', () => {
  let stack: VerifyStack;
  let token = '';
  let churnedId = '';
  let liveId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const churned = await stack.rows('showcase_account', { status: 'churned' });
    const live = await stack.rows('showcase_account', { status: 'active' });
    expect(churned.length, 'the showcase seed carries a churned account').toBeGreaterThan(0);
    expect(live.length, 'the showcase seed carries an active account').toBeGreaterThan(0);
    churnedId = String(churned[0].id);
    liveId = String(live[0].id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[0]: a write against a non-churned account passes and reads back', async () => {
    const name = uniq('prt-live');
    const created = await call('POST', '/data/showcase_invoice', { name, account: liveId });
    expectAdmitted(created);
    const id = createdId(created.json);
    const read = await call('GET', `/data/showcase_invoice/${id}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(JSON.stringify(read.json)).toContain(name);
  });

  it('acceptance[1], negative[0]: a write against a churned account is refused with the authored message, and nothing is stored', async () => {
    const name = uniq('prt-churned');
    expectRuleRefusal(await call('POST', '/data/showcase_invoice', { name, account: churnedId }), CHURNED_MESSAGE);
    expect(await stack.rows('showcase_invoice', { name })).toHaveLength(0);
  });

  it('acceptance[2]: a patch carrying only the repointed account is judged against the account it lands on', async () => {
    const name = uniq('prt-repoint');
    const created = await call('POST', '/data/showcase_invoice', { name, account: liveId });
    expectAdmitted(created);
    const id = createdId(created.json);
    expectRuleRefusal(await call('PATCH', `/data/showcase_invoice/${id}`, { account: churnedId }), CHURNED_MESSAGE);
    const [row] = await stack.rows('showcase_invoice', { id });
    expect(row?.account).toBe(liveId);
  });

  it('negative[1]: an unrelated patch on an invoice whose account is readable is not refused by the rule', async () => {
    const name = uniq('prt-other');
    const created = await call('POST', '/data/showcase_invoice', { name, account: liveId });
    expectAdmitted(created);
    expectAdmitted(await call('PATCH', `/data/showcase_invoice/${createdId(created.json)}`, { owner: 'prt@verify.test' }));
  });
});

// ── The persona the rule exists to constrain ───────────────────────────────

const PARENT = 'prt_parent';
const CHILD = 'prt_child';
const BLOCKED_MESSAGE = 'PRT26573: the parent is blocked';

const prtMemberSet = PermissionSetSchema.parse({
  name: 'prt_member',
  label: 'Predicate traversal fixture — child writer, no parent grant',
  objects: {
    [CHILD]: { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

const prtStack = defineStack({
  manifest: {
    id: 'com.dogfood.predicate-relationship-traversal', namespace: 'prt', version: '0.0.0', type: 'app',
    name: 'Predicate relationship traversal fixture',
    description: 'A child whose script rule reads its parent one hop through a lookup.',
  },
  objects: [
    ObjectSchema.create({
      name: PARENT, label: 'Parent', pluralLabel: 'Parents',
      // Default sharing model (private) and no grant in the member's set.
      fields: { name: Field.text({ label: 'Name', required: true }), status: Field.text({ label: 'Status' }) },
    }),
    ObjectSchema.create({
      name: CHILD, label: 'Child', pluralLabel: 'Children', sharingModel: 'public_read_write',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        parent: Field.lookup(PARENT, { label: 'Parent', required: true }),
      },
      validations: [
        { type: 'script', name: 'no_child_for_blocked_parent', severity: 'error',
          condition: P`record.parent.status == 'blocked'`, message: BLOCKED_MESSAGE },
      ],
    } as never),
  ],
} as never);

describe('records-forms.predicate-relationship-traversal — a member who cannot read the parent', () => {
  let stack: VerifyStack;
  let member = '';
  let openId = '';
  let blockedId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(member, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  beforeAll(async () => {
    stack = await bootStack(prtStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, prtMemberSet],
        fallbackPermissionSet: prtMemberSet.name,
      }),
    });
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    openId = String((await ql.insert(PARENT, { name: 'open parent', status: 'open' }, SYS)).id);
    blockedId = String((await ql.insert(PARENT, { name: 'blocked parent', status: 'blocked' }, SYS)).id);
    member = await stack.signUp('prt-member@verify.test');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('control: the member really cannot read the parent', async () => {
    const read = await call('GET', `/data/${PARENT}/${openId}`);
    expect(read.status, JSON.stringify(read.json)).toBe(403);
    expect(read.json.code).toBe('PERMISSION_DENIED');
  });

  it('acceptance[3]: a legitimate write against a non-tripping parent goes through', async () => {
    const created = await call('POST', `/data/${CHILD}`, { name: 'prt-open', parent: openId });
    expectAdmitted(created);
    expect(await stack.rows(CHILD, { name: 'prt-open' })).toHaveLength(1);
  });

  it('acceptance[3], negative[2]: a write against a tripping parent is refused with the authored message, never the unevaluable fault', async () => {
    expectRuleRefusal(await call('POST', `/data/${CHILD}`, { name: 'prt-blocked', parent: blockedId }), BLOCKED_MESSAGE);
    expect(await stack.rows(CHILD, { name: 'prt-blocked' })).toHaveLength(0);
  });
});
