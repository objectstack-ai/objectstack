import { describe, expect, it } from 'vitest';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { scoreMetadata } from '../src/lint/score';

/** A clean, convention-following invoice + line-item model. */
const GOOD_STACK = {
  manifest: { id: 'com.example.demo', namespace: 'demo_app', version: '1.0.0', name: 'Demo', type: 'app' as const, engines: { protocol: `^${PROTOCOL_MAJOR}` } },
  objects: [
    {
      name: 'invoice',
      label: 'Invoice',
      sharingModel: 'private', // exemplary: OWD is an authored decision (ADR-0090 D7)
      fields: {
        name: { type: 'text', label: 'Invoice Number', required: true },
        status: { type: 'select', label: 'Status', options: [{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' }] },
        total: { type: 'summary', label: 'Total', summaryOperations: { object: 'invoice_line', field: 'amount', function: 'sum' } },
      },
    },
    {
      name: 'invoice_line',
      label: 'Invoice Line',
      sharingModel: 'controlled_by_parent',
      fields: {
        invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true, deleteBehavior: 'cascade', inlineEdit: true },
        product: { type: 'text', label: 'Product', required: true },
        amount: { type: 'currency', label: 'Amount', required: true },
      },
    },
  ],
};

/** Schema-invalid (bad namespace) AND riddled with anti-patterns. */
const BAD_STACK = {
  manifest: { id: 'com.example.bad', namespace: 'X', version: '1.0.0', name: 'Bad', type: 'app' as const }, // namespace fails pattern → schema error
  objects: [
    {
      name: 'BadName', // not snake_case → lint error
      // no label → lint error; no name field → suggestion
      fields: {
        Status: { type: 'select' }, // not snake_case + no options
        widget_amount: { type: 'number' },
      },
    },
    {
      name: 'cart_item', // line-item shaped...
      label: 'Cart Item',
      fields: {
        cart: { type: 'lookup', reference: 'cart' }, // ...but lookup, not master_detail → suggestion
      },
    },
  ],
};

describe('scoreMetadata', () => {
  it('scores a clean model highly and marks it valid', () => {
    const r = scoreMetadata(GOOD_STACK);
    expect(r.valid).toBe(true);
    expect(r.counts.schemaErrors).toBe(0);
    expect(r.counts.errors).toBe(0);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.grade).toBe('A');
  });

  it('scores a broken model low and marks it invalid', () => {
    const r = scoreMetadata(BAD_STACK);
    expect(r.valid).toBe(false);
    expect(r.counts.schemaErrors).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(GOOD_STACK ? scoreMetadata(GOOD_STACK).score : 100);
  });

  it('a clean model outscores a broken one (monotonicity)', () => {
    expect(scoreMetadata(GOOD_STACK).score).toBeGreaterThan(scoreMetadata(BAD_STACK).score);
  });

  it('an empty stack is schema-valid and scores 100', () => {
    const r = scoreMetadata({});
    expect(r.valid).toBe(true);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
  });

  it('suggestions cost less than warnings cost less than errors', () => {
    // Only suggestions: a master_detail without explicit deleteBehavior (suggestion).
    const onlySuggestions = scoreMetadata({
      objects: [
        { name: 'invoice', label: 'Invoice', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name', required: true } } },
        { name: 'invoice_line', label: 'Line', sharingModel: 'controlled_by_parent', fields: { invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true, inlineEdit: true } } },
      ],
    });
    // A warning: master_detail not required.
    const withWarning = scoreMetadata({
      objects: [
        { name: 'invoice', label: 'Invoice', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name', required: true } } },
        { name: 'invoice_line', label: 'Line', sharingModel: 'controlled_by_parent', fields: { invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', deleteBehavior: 'cascade' } } },
      ],
    });
    expect(onlySuggestions.score).toBeGreaterThan(withWarning.score);
    expect(onlySuggestions.counts.errors).toBe(0);
  });

  it('reports the schema error messages', () => {
    const r = scoreMetadata(BAD_STACK);
    expect(r.schemaErrors.some((m) => m.includes('namespace'))).toBe(true);
  });
});
