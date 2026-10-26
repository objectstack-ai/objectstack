// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ValidationPreview vs `ValidationRuleSchema` (objectui#3281, folded into #3275).
 *
 * The union has exactly six members — `script`, `state_machine`, `format`,
 * `cross_field`, `json_schema`, `conditional`. This preview drew nine, read two
 * keys that have never existed on any branch, and had no branch at all for one
 * member that does. Every one of those is the AGENTS.md #0.1 tolerant consumer:
 *
 *  • `condition ?? expression` — `expression` is not a retired key, it was
 *    never a key. The fallback is precisely why a bogus `expression` sat
 *    unnoticed in the console sample (objectui#3276): the preview rendered
 *    either spelling, so nothing surfaced the mistake, while a real publish
 *    strips the key and the rule silently enforces nothing.
 *  • `pattern ?? regex` — same shape; only `regex` is declared.
 *  • `unique` / `async` / `custom` — removed by one paragraph of
 *    `validation.zod.ts` ("Deliberately NOT validation rules"), because a rule
 *    must be a deterministic, synchronous, side-effect-free predicate over one
 *    record. Uniqueness is a DB unique index (a SELECT-then-INSERT rule is
 *    racy — TOCTOU). Drawing an editor for them advertised a rule type that
 *    cannot be saved.
 *  • `conditional` read `condition`; the branch's predicate is `when`, so a
 *    VALID conditional rule displayed "No expression set".
 *  • `json_schema` had no branch, so a VALID rule displayed "Unknown rule type".
 *
 * `object` USED to be exempt from that list, on one stated ground: `anchors.ts`
 * registered a standalone `validation` resource matched by
 * `anchorByField('object')`, so a standalone rule was taken to carry the key.
 * ADR-0088 / objectstack#4509 retired the kind, objectui#4132 removed that
 * registration, and the exemption goes with it — the last case in this file is
 * now the negative, with the schema's own verdict as its instrument rather than
 * a claim about a registration.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ValidationRuleSchema } from '@objectstack/spec/data';
import { ValidationPreview } from './ValidationPreview';

afterEach(cleanup);

const BASE = {
  name: 'amount_positive',
  label: 'Amount Must Be Positive',
  message: 'Order amount must be greater than zero.',
  severity: 'error',
  active: true,
  events: ['insert', 'update'],
  priority: 10,
} satisfies Record<string, unknown>;

function renderPreview(draft: Record<string, unknown>) {
  return render(
    <ValidationPreview
      type="validation"
      name="amount_positive"
      draft={draft}
    />,
  );
}

describe('ValidationPreview renders the condition of a spec-valid script rule', () => {
  it('renders `condition` — the predicate that FAILS the record when true', () => {
    renderPreview({ ...BASE, type: 'script', condition: 'record.amount <= 0' });
    expect(screen.getByText('Condition')).toBeTruthy();
    expect(screen.getByText('record.amount <= 0')).toBeTruthy();
  });

  it('renders a CEL object form (`{ source }`) as its source text', () => {
    renderPreview({ ...BASE, type: 'script', condition: { source: 'record.amount <= 0' } });
    expect(screen.getByText('record.amount <= 0')).toBeTruthy();
  });

  it('does NOT fall back to `expression` — a key no branch has ever declared', () => {
    // The exact draft objectui#3276 found in the sample: a real `condition`
    // plus a bogus `expression`. Only the declared key may render.
    renderPreview({ ...BASE, type: 'script', expression: 'amount > 0' });
    expect(screen.queryByText('amount > 0')).toBeNull();
    expect(screen.getByText(/no expression set/i)).toBeTruthy();
  });
});

describe('ValidationPreview renders removed rule types as a redirect, not an editor', () => {
  it('tells a `unique` draft that uniqueness is an index, and draws no fields editor', () => {
    renderPreview({
      ...BASE,
      type: 'unique',
      fields: ['order_number'],
      scope: 'record.org_id',
    });
    expect(screen.getByText(/cannot be saved/i)).toBeTruthy();
    expect(screen.getByText(/unique.*index/i)).toBeTruthy();
    // The old editor is gone: no field chips, no Scope block.
    expect(screen.queryByText('order_number')).toBeNull();
    expect(screen.queryByText('Scope')).toBeNull();
    expect(screen.queryByText('record.org_id')).toBeNull();
  });

  it('redirects `async` to the form layer and renders no endpoint', () => {
    renderPreview({ ...BASE, type: 'async', endpoint: 'https://api.example.com/check' });
    expect(screen.queryByText('https://api.example.com/check')).toBeNull();
    expect(screen.getByText(/form-layer concern/i)).toBeTruthy();
  });

  it('redirects `custom` to a lifecycle hook and renders no handler', () => {
    renderPreview({ ...BASE, type: 'custom', handler: 'validateOrder' });
    expect(screen.queryByText('validateOrder')).toBeNull();
    expect(screen.getByText(/beforeInsert/i)).toBeTruthy();
  });
});

describe('ValidationPreview renders the branches it previously got wrong', () => {
  it('reads `when` (not `condition`) on a conditional rule and shows the nested rule', () => {
    renderPreview({
      ...BASE,
      type: 'conditional',
      when: "record.type == 'enterprise'",
      then: {
        type: 'script',
        name: 'enterprise_min_amount',
        condition: 'record.amount < 1000',
        message: 'Enterprise orders start at 1000.',
      },
    });
    expect(screen.getByText('When')).toBeTruthy();
    expect(screen.getByText("record.type == 'enterprise'")).toBeTruthy();
    expect(screen.getByText('Then apply')).toBeTruthy();
    expect(screen.getByText('enterprise_min_amount')).toBeTruthy();
    expect(screen.getByText('Enterprise orders start at 1000.')).toBeTruthy();
  });

  it('renders a json_schema rule instead of "Unknown rule type"', () => {
    renderPreview({
      ...BASE,
      type: 'json_schema',
      field: 'payload',
      schema: { type: 'object', required: ['sku'] },
    });
    expect(screen.queryByText(/unknown rule type/i)).toBeNull();
    expect(screen.getByText('JSON Schema on payload')).toBeTruthy();
    expect(screen.getByText(/"required"/)).toBeTruthy();
  });

  it('reads `regex` and not `pattern` on a format rule', () => {
    renderPreview({ ...BASE, type: 'format', field: 'email', regex: '^.+@.+$' });
    expect(screen.getByText('^.+@.+$')).toBeTruthy();
    cleanup();
    // `pattern` is not a key — a rule carrying only it has no regex at all.
    renderPreview({ ...BASE, type: 'format', field: 'email', pattern: '^.+@.+$' });
    expect(screen.queryByText('^.+@.+$')).toBeNull();
    expect(screen.getByText(/no format or regex set/i)).toBeTruthy();
  });

  it('shows a state machine transitions matrix and its initial states', () => {
    renderPreview({
      ...BASE,
      type: 'state_machine',
      field: 'status',
      transitions: { draft: ['open'], open: ['closed'] },
      initialStates: ['draft'],
    });
    expect(screen.getByText('Transitions on status')).toBeTruthy();
    expect(screen.getByText('May be created in')).toBeTruthy();
  });

  it('keeps the cross_field branch rendering fields and condition', () => {
    renderPreview({
      ...BASE,
      type: 'cross_field',
      fields: ['start_date', 'end_date'],
      condition: 'record.end_date < record.start_date',
    });
    expect(screen.getByText('start_date')).toBeTruthy();
    expect(screen.getByText('record.end_date < record.start_date')).toBeTruthy();
  });
});

describe('ValidationPreview still renders the shared envelope', () => {
  it('keeps label, name, severity and message', () => {
    renderPreview({ ...BASE, type: 'script', condition: 'record.amount <= 0' });
    expect(screen.getByText('Amount Must Be Positive')).toBeTruthy();
    expect(screen.getByText('amount_positive')).toBeTruthy();
    expect(screen.getByText('Order amount must be greater than zero.')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });
});

describe('`object` is residue after ADR-0088 (objectui#4132)', () => {
  /**
   * The old case here asserted the `object: …` pill and justified it with the
   * standalone resource registration. Re-spelling that case would have kept a
   * passing test for a key nothing can produce, so it is replaced outright: the
   * schema is asked directly, and the preview is asserted NOT to paint the key.
   */
  const rejectedKeysIn = (draft: Record<string, unknown>): string[] => {
    const parsed = ValidationRuleSchema.safeParse(draft);
    if (parsed.success) return [];
    return parsed.error.issues.flatMap((issue) =>
      issue.code === 'unrecognized_keys' ? ((issue as { keys: string[] }).keys ?? []) : [],
    );
  };

  it('the schema rejects `object` by name — this is why the read is gone', () => {
    expect(
      rejectedKeysIn({ ...BASE, type: 'script', condition: 'record.amount <= 0', object: 'sales_order' }),
    ).toContain('object');
  });

  it('non-vacuity: the same draft WITHOUT `object` is not rejected for its keys', () => {
    // Guards the probe above against a schema that rejects everything (or a
    // renamed export), which would make the assertion meaningless.
    expect(rejectedKeysIn({ ...BASE, type: 'script', condition: 'record.amount <= 0' })).toEqual([]);
  });

  it('the preview paints no object pill even when a draft carries the key', () => {
    renderPreview({ ...BASE, type: 'script', object: 'sales_order', condition: 'record.amount <= 0' });
    expect(screen.queryByText('object: sales_order')).toBeNull();
    expect(screen.queryByText(/sales_order/)).toBeNull();
    // The rest of the envelope is untouched — this deleted one pill, not a tab.
    expect(screen.getByText('Amount Must Be Positive')).toBeTruthy();
    expect(screen.getByText('record.amount <= 0')).toBeTruthy();
  });
});
