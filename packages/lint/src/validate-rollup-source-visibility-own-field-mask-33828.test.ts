// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0066 D2 ⑧ note of 2026-11-15] A permission set's own `readable: false`
// binds beside the set's own View All, so the roll-up source rules read that
// mask as hiding the field, on the parent and on the child alike. Modify All
// still votes on every field, so a mask beside it hides nothing.
//
// The pins the note flips stay in `validate-rollup-source-visibility.test.ts`;
// the cases below are the ones it adds. Every case goes through the registry
// runner, for the reason that file gives.
import { describe, expect, it } from 'vitest';

import { runAuthoringRules } from './authoring-rules.js';

const UNREADABLE = 'security-rollup-source-unreadable';
const ROW_SCOPED = 'security-rollup-source-row-scoped';

type Rec = Record<string, unknown>;

/** `invoice` rolls up `sum(invoice_line.amount)` and `count(invoice_line)`. */
const invoice: Rec = {
  name: 'invoice',
  label: 'Invoice',
  sharingModel: 'public_read',
  fields: {
    name: { type: 'text', label: 'Name' },
    total: {
      type: 'summary',
      label: 'Total',
      summaryOperations: { object: 'invoice_line', field: 'amount', function: 'sum' },
    },
    line_count: {
      type: 'summary',
      label: 'Line Count',
      summaryOperations: { object: 'invoice_line', field: 'amount', function: 'count' },
    },
  },
};

const invoiceLine: Rec = {
  name: 'invoice_line',
  label: 'Invoice Line',
  sharingModel: 'public_read',
  fields: {
    name: { type: 'text', label: 'Name' },
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true, deleteBehavior: 'cascade' },
    amount: { type: 'currency', label: 'Amount' },
  },
};

const READ = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };

/** A set reading both objects, with `extra` merged over it. */
const set = (extra: Rec = {}): Rec => ({
  name: 'warehouse_staff',
  label: 'Warehouse Staff',
  objects: { invoice: READ, invoice_line: READ },
  ...extra,
});

const stackOf = (permission: Rec): Rec => ({ objects: [invoice, invoiceLine], permissions: [permission] });

const viaRegistry = (stack: Rec) =>
  runAuthoringRules('lint', { normalized: stack }).filter((f) => f.rule === UNREADABLE || f.rule === ROW_SCOPED);

const pairs = (findings: readonly { rule: string; where: string }[]) => findings.map((f) => [f.rule, f.where]);

const W_TOTAL = 'permission set "warehouse_staff" · summary field "invoice.total"';
const W_COUNT = 'permission set "warehouse_staff" · summary field "invoice.line_count"';

describe('a View All set\'s own mask binds', () => {
  it('on the parent: the masked summary column is not judged, and the unmasked one still is', () => {
    const findings = viaRegistry(
      stackOf(
        set({
          objects: { invoice: { ...READ, viewAllRecords: true } },
          fields: { 'invoice.total': { readable: false } },
        }),
      ),
    );
    // The set reads no child object here, so the column it can still see is reported.
    expect(pairs(findings)).toEqual([[UNREADABLE, W_COUNT]]);
  });

  it('on the child: the hidden aggregated field is unreadable, so the sum over it is reported', () => {
    const findings = viaRegistry(
      stackOf(
        set({
          objects: { invoice: READ, invoice_line: { ...READ, viewAllRecords: true } },
          fields: { 'invoice_line.amount': { readable: false } },
        }),
      ),
    );
    expect(pairs(findings)).toEqual([[UNREADABLE, W_TOTAL]]);
  });

  it('a View All parent with no mask gets the plain remedy: the mask it names will bind', () => {
    const [f] = viaRegistry(stackOf(set({ objects: { invoice: { ...READ, viewAllRecords: true } } })));
    expect(f.hint).not.toContain('first remove');
    expect(f.hint).toContain('set fields["invoice.total"]: { readable: false } on it');
  });
});

describe('Modify All still votes on every field', () => {
  it('both bits on the child entry: the hidden child field is readable, so nothing is reported', () => {
    const findings = viaRegistry(
      stackOf(
        set({
          objects: { invoice: READ, invoice_line: { ...READ, viewAllRecords: true, modifyAllRecords: true } },
          fields: { 'invoice_line.amount': { readable: false } },
        }),
      ),
    );
    expect(findings).toEqual([]);
  });
});
