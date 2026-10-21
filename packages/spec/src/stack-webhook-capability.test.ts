// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ruling A on #24910 — `defineStack` refuses a stack that declares a webhook
 * while `requires` cannot dispatch it: `webhooks` mounts the dispatcher
 * (`@objectstack/plugin-webhooks`), `realtime` mounts its only source of record
 * events (`@objectstack/service-realtime`), and without either the stack
 * validated, built, booted, answered `enabled: true` at the activation door and
 * 200 on every record write, and never delivered.
 *
 * Pinned: the three arms (no `webhooks`, no `realtime`, both missing — absent
 * `requires` included) on ONE code, `STACK_WEBHOOK_CAPABILITY_REQUIRED`, with
 * the ADR-0112 envelope (`code` + `status: 422`), each finding naming the
 * webhook and the missing tokens; the CONTROL (the pair, in any order, among
 * other tokens, is accepted); each prescription applied once is accepted; no
 * token is implied or added; and the boundaries (no webhook owes nothing, an
 * inactive declaration still owes the pair, the trigger sibling reports first,
 * `strict: false` skips by contract).
 */
import { describe, expect, it } from 'vitest';
import { defineStack } from './stack.zod';

type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

const refusalOf = (stack: Record<string, unknown>, options?: { strict?: boolean }): Envelope | null => {
  try {
    defineStack(stack as never, options);
    return null;
  } catch (e) {
    return e as Envelope;
  }
};

const CODE = 'STACK_WEBHOOK_CAPABILITY_REQUIRED';
const HEADER = /^defineStack webhook capability validation failed \(1 issue\):/;
const PAIR = ['webhooks', 'realtime'];

const task = { name: 'task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } };
const webhook = (name = 'task_changed', extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  object: 'task',
  triggers: ['create', 'update'],
  url: 'https://hooks.example/task',
  ...extra,
});
const stackOf = (requires: string[] | undefined, webhooks: unknown[] = [webhook()]) =>
  requires === undefined ? { objects: [task], webhooks } : { requires, objects: [task], webhooks };

describe('defineStack webhook capability — a declared webhook owes `requires: [\'webhooks\', \'realtime\']`', () => {
  const ARMS: Array<[string, string[] | undefined, string, string]> = [
    // label, requires, the tokens the finding names, the prescription
    ["no 'webhooks'", ['realtime'], "'webhooks'", "Add 'webhooks' to requires: ['webhooks', 'realtime']"],
    ["no 'realtime'", ['webhooks'], "'realtime'", "Add 'realtime' to requires: ['webhooks', 'realtime']"],
    ['both missing', ['automation', 'triggers'], "'webhooks' or 'realtime'", "Add requires: ['webhooks', 'realtime']"],
    ['both missing — `requires: []`', [], "'webhooks' or 'realtime'", "Add requires: ['webhooks', 'realtime']"],
    ['both missing — `requires` absent', undefined, "'webhooks' or 'realtime'", "Add requires: ['webhooks', 'realtime']"],
  ];

  describe.each(ARMS)('%s', (_label, requires, missing, prescription) => {
    it(`refuses with ${CODE}, status 422, naming the webhook and the missing token(s)`, () => {
      const refused = refusalOf(stackOf(requires));
      expect(refused).toBeInstanceOf(Error);
      expect(refused?.code).toBe(CODE);
      expect(refused?.status).toBe(422);
      expect(refused?.message).toMatch(HEADER);
      expect(refused?.issues).toHaveLength(1);
      const finding = refused?.issues?.[0] ?? '';
      expect(finding).toContain(`webhook 'task_changed' is declared but \`requires\` does not include ${missing} — `);
      expect(finding).toContain('a record write would never enqueue a delivery');
      expect(finding).toContain(prescription);
      // The finding rides the message too, one `✗` line per webhook.
      expect(refused?.message).toContain(`✗ ${finding}`);
    });
  });

  it("the pair is ACCEPTED — the control: the scaffold's ['automation', 'triggers'] plus both tokens, and the pair in either order", () => {
    expect(refusalOf(stackOf(['automation', 'triggers', 'webhooks', 'realtime']))).toBeNull();
    expect(refusalOf(stackOf(['realtime', 'webhooks']))).toBeNull();
    expect(refusalOf(stackOf(['webhooks', 'job', 'realtime']))).toBeNull();
  });

  it('no token is implied or added — an accepted stack keeps exactly the `requires` it declared', () => {
    const declared = ['automation', 'triggers', 'webhooks', 'realtime'];
    const out = defineStack(stackOf(declared) as never) as { requires?: string[] };
    expect(out.requires).toEqual(declared);
  });

  describe('each prescription, applied literally once, is ACCEPTED', () => {
    const cases: Array<[string, string[] | undefined, string[]]> = [
      ["['realtime'] + 'webhooks'", ['realtime'], PAIR],
      ["['webhooks'] + 'realtime'", ['webhooks'], PAIR],
      ["['automation', 'triggers'] + the pair", ['automation', 'triggers'], ['automation', 'triggers', ...PAIR]],
      ['absent + the pair', undefined, PAIR],
    ];
    it.each(cases)('%s', (_label, requires, fixed) => {
      const refused = refusalOf(stackOf(requires));
      expect(refused?.code).toBe(CODE);
      // The prescription names exactly the tokens the fix adds.
      const finding = refused?.issues?.[0] ?? '';
      for (const token of fixed.filter((t) => !(requires ?? []).includes(t))) expect(finding).toContain(`'${token}'`);
      expect(refusalOf(stackOf(fixed))).toBeNull();
    });
  });

  it('a stack with no webhook owes neither token — absent, empty, or `requires` omitted', () => {
    expect(refusalOf({ objects: [task] })).toBeNull();
    expect(refusalOf({ objects: [task], webhooks: [] })).toBeNull();
    expect(refusalOf({ requires: ['automation', 'triggers'], objects: [task], webhooks: [] })).toBeNull();
  });

  it('an inactive declaration (`isActive: false`) still owes the pair — the activation door can switch it on', () => {
    const refused = refusalOf(stackOf(['webhooks'], [webhook('dormant', { isActive: false })]));
    expect(refused?.code).toBe(CODE);
    expect(refused?.issues?.[0]).toContain("webhook 'dormant' is declared but `requires` does not include 'realtime'");
  });

  it('reports every declared webhook together, one `issues` entry per webhook', () => {
    const refused = refusalOf(stackOf(['webhooks'], [webhook('first_hook'), webhook('second_hook')]));
    expect(refused?.code).toBe(CODE);
    expect(refused?.message).toMatch(/^defineStack webhook capability validation failed \(2 issues\):/);
    expect(refused?.issues).toHaveLength(2);
    expect(refused?.issues?.[0]).toContain("webhook 'first_hook' is declared");
    expect(refused?.issues?.[1]).toContain("webhook 'second_hook' is declared");
  });

  it('the map form is judged like the array form — the key is the webhook name', () => {
    const { name: _drop, ...body } = webhook('mapped_hook');
    const refused = refusalOf({ requires: ['realtime'], objects: [task], webhooks: { mapped_hook: body } });
    expect(refused?.code).toBe(CODE);
    expect(refused?.issues?.[0]).toContain("webhook 'mapped_hook' is declared but `requires` does not include 'webhooks'");
  });

  it('the trigger sibling reports first — one throw-site family, checked in order', () => {
    const flow = {
      name: 'task_fanout',
      label: 'task_fanout',
      type: 'record_change',
      nodes: [
        { id: 'start', type: 'start', label: 'start', config: { objectName: 'task', triggerType: 'record-after-create' } },
        { id: 'end', type: 'end', label: 'end' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
    const refused = refusalOf({ requires: [], objects: [task], flows: [flow], webhooks: [webhook()] });
    expect(refused?.code).toBe('STACK_TRIGGER_CAPABILITY_REQUIRED');
  });

  it('non-strict mode skips validation by contract (the webhook passes through unrefused)', () => {
    expect(refusalOf(stackOf(['automation', 'triggers']), { strict: false })).toBeNull();
  });
});
