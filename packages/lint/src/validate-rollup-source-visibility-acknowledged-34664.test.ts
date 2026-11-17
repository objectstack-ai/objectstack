// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #34664 — `security-rollup-source-unreadable` is advisory ("the pair is legal
// and is often meant"), and a meant pair is acknowledged where the finding
// points: the set's own entry for the summary column carries
// `rollupSourceUnreadableReason`. That one finding (this set × this column)
// is then an `info` note quoting the reason, so `--strict` passes; every other
// finding of the rule is unchanged. Positive legs go through the registry
// runner, as in the rule's main suite.
import { describe, expect, it } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { runAuthoringRules } from './authoring-rules.js';

const UNREADABLE = 'security-rollup-source-unreadable';
const ROW_SCOPED = 'security-rollup-source-row-scoped';
const REASON = 'Warehouse staff read invoice totals but not line costs';

type Rec = Record<string, unknown>;

const invoice: Rec = {
  name: 'invoice',
  label: 'Invoice',
  sharingModel: 'public_read',
  fields: {
    name: { type: 'text', label: 'Name' },
    total: { type: 'summary', label: 'Total', summaryOperations: { object: 'invoice_line', field: 'amount', function: 'sum' } },
    line_count: { type: 'summary', label: 'Line Count', summaryOperations: { object: 'invoice_line', function: 'count' } },
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

/** A set that reads `invoice` and NOT `invoice_line`: both roll-ups warn. */
const staff = (fields: Rec = {}, extra: Rec = {}): Rec => ({
  name: 'warehouse_staff',
  label: 'Warehouse Staff',
  objects: { invoice: READ },
  fields,
  ...extra,
});

const run = (...permissions: Rec[]) =>
  runAuthoringRules('lint', { normalized: { objects: [invoice, invoiceLine], permissions } }).filter(
    (f) => f.rule === UNREADABLE || f.rule === ROW_SCOPED,
  );

const W = (set: string, column: string) => `permission set "${set}" · summary field "${column}"`;

describe('rollupSourceUnreadableReason acknowledges one meant pair (#34664)', () => {
  it('the control: without the reason, both roll-ups warn', () => {
    const findings = run(staff());
    expect(findings.map((f) => [f.rule, f.where, f.severity])).toEqual([
      [UNREADABLE, W('warehouse_staff', 'invoice.total'), 'warning'],
      [UNREADABLE, W('warehouse_staff', 'invoice.line_count'), 'warning'],
    ]);
  });

  it('with the reason on the column entry, that finding is info, quotes the reason and points at the key', () => {
    const findings = run(staff({ 'invoice.total': { readable: true, rollupSourceUnreadableReason: REASON } }));
    expect(findings.map((f) => [f.rule, f.where, f.severity])).toEqual([
      [UNREADABLE, W('warehouse_staff', 'invoice.total'), 'info'],
      // Another column of the same set is not acknowledged by it.
      [UNREADABLE, W('warehouse_staff', 'invoice.line_count'), 'warning'],
    ]);
    const [acked] = findings;
    expect(acked.message).toContain(`"${REASON}"`);
    expect(acked.path).toBe('permissions[0].fields["invoice.total"].rollupSourceUnreadableReason');
  });

  it('acknowledging every column leaves no warning, so --strict has nothing to fail on', () => {
    const findings = run(
      staff({
        'invoice.total': { rollupSourceUnreadableReason: REASON },
        'invoice.line_count': { rollupSourceUnreadableReason: REASON },
      }),
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.rule === UNREADABLE && f.severity === 'info')).toBe(true);
  });

  it("one set's acknowledgement does not speak for another set reading the same column", () => {
    const other = { ...staff(), name: 'field_sales', label: 'Field Sales' };
    const findings = run(staff({ 'invoice.total': { rollupSourceUnreadableReason: REASON } }), other);
    expect(findings.filter((f) => f.severity === 'warning').map((f) => f.where)).toEqual([
      W('warehouse_staff', 'invoice.line_count'),
      W('field_sales', 'invoice.total'),
      W('field_sales', 'invoice.line_count'),
    ]);
  });

  it('a blank reason acknowledges nothing (the raw door; the schema refuses it on parse)', () => {
    const findings = run(staff({ 'invoice.total': { rollupSourceUnreadableReason: '   ' } }));
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('the row-scoped note is untouched by the key', () => {
    const scoped = staff(
      { 'invoice.total': { rollupSourceUnreadableReason: REASON } },
      {
        objects: { invoice: READ, invoice_line: READ },
        rowLevelSecurity: [{ name: 'own_lines', object: 'invoice_line', operation: 'select', using: 'created_by == current_user.id' }],
      },
    );
    const findings = run(scoped);
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([
      [ROW_SCOPED, 'info'],
      [ROW_SCOPED, 'info'],
    ]);
    expect(findings[0].message).not.toContain(REASON);
  });

  it('the aggregated-field and filter-field arms are acknowledged the same way', () => {
    const readsBoth = { invoice: READ, invoice_line: READ };
    // Aggregated-field arm: the set reads the child but hides `amount`.
    const fieldArm = (fields: Rec) => run(staff({ 'invoice_line.amount': { readable: false }, ...fields }, { objects: readsBoth }));
    expect(fieldArm({}).map((f) => [f.where, f.severity])).toEqual([[W('warehouse_staff', 'invoice.total'), 'warning']]);
    expect(fieldArm({ 'invoice.total': { rollupSourceUnreadableReason: REASON } }).map((f) => [f.where, f.severity])).toEqual([
      [W('warehouse_staff', 'invoice.total'), 'info'],
    ]);
    // Filter-field arm: a count filtered on a field the set hides.
    const banded = {
      ...invoice,
      fields: {
        open_count: {
          type: 'summary',
          label: 'Open Lines',
          summaryOperations: { object: 'invoice_line', function: 'count', filter: { band: 'open' } },
        },
      },
    };
    const line = { ...invoiceLine, fields: { ...(invoiceLine.fields as Rec), band: { type: 'text', label: 'Band' } } };
    const filterArm = (fields: Rec) =>
      runAuthoringRules('lint', {
        normalized: {
          objects: [banded, line],
          permissions: [staff({ 'invoice_line.band': { readable: false }, ...fields }, { objects: readsBoth })],
        },
      }).filter((f) => f.rule === UNREADABLE);
    expect(filterArm({}).map((f) => f.severity)).toEqual(['warning']);
    expect(filterArm({ 'invoice.open_count': { rollupSourceUnreadableReason: REASON } }).map((f) => f.severity)).toEqual(['info']);
  });

  it('the reason is quoted as a string literal, so a quote or a line break in it stays inside the quotes', () => {
    const [f] = run(staff({ 'invoice.total': { rollupSourceUnreadableReason: 'Totals are "public"\nby design' } }));
    expect(f.message.endsWith('Acknowledged on the set: "Totals are \\"public\\"\\nby design"')).toBe(true);
  });

  it('a parsed permission set answers what the raw one does', () => {
    const parsed = PermissionSetSchema.parse(staff({ 'invoice.total': { rollupSourceUnreadableReason: REASON } })) as Rec;
    expect(run(parsed).map((f) => f.severity)).toEqual(['info', 'warning']);
  });
});
