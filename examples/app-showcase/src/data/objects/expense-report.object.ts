// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Expense Report + Expense Line — the canonical demonstration of **filtered**
 * roll-up `summary` fields (framework#1868).
 *
 * A plain `summary` rolls up EVERY child row (see `showcase_invoice.total`).
 * The power added by `summaryOperations.filter` is that ONE child object can
 * feed SEVERAL different parent totals, each aggregating only the child rows
 * that match a predicate — something that was impossible to express before and
 * had to be hand-maintained (and drifted the moment a real child row was added).
 *
 * Here a single `showcase_expense_line` child feeds six rollups on the report:
 *
 *   • total_amount        SUM(amount)                        — every line
 *   • approved_amount     SUM(amount) WHERE status=approved  — filtered sum (equality)
 *   • reimbursable_amount SUM(amount) WHERE billable=true     — filtered sum (boolean)
 *   • line_count          COUNT                               — every line
 *   • rejected_count      COUNT      WHERE status=rejected    — filtered count (equality)
 *   • over_limit_count    COUNT      WHERE amount>=500        — filtered count (operator)
 *
 * The engine keeps all six current server-side as lines are inserted / updated
 * / deleted. Because each recompute re-runs the whole filtered aggregate, a
 * line moving in or out of a predicate — e.g. a manager flipping one line's
 * `status` from `submitted` to `approved` in the inline grid — updates the
 * relevant totals on that write with no extra wiring. That is the interactive
 * story to drive in the running app: edit line statuses and watch
 * approved/rejected/reimbursable diverge from the unfiltered total.
 */
export const ExpenseReport = ObjectSchema.create({
  name: 'showcase_expense_report',
  // [ADR-0090 D1] grandfather stamp: world-writable demo object so any seeded
  // persona (and the browser e2e) can create/edit reports without a bespoke
  // permission set. Belonging to no permission set, it is intentionally absent
  // from the access-matrix snapshot (cf. showcase_cascade).
  sharingModel: 'public_read_write',
  label: 'Expense Report',
  pluralLabel: 'Expense Reports',
  icon: 'wallet',
  description: 'An expense report whose parent totals are filtered roll-ups of its line items.',

  fields: {
    name: Field.text({ label: 'Report Title', required: true, searchable: true, maxLength: 120 }),
    employee: Field.text({ label: 'Employee', searchable: true, maxLength: 120 }),
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Draft', value: 'draft', default: true, color: '#94A3B8' },
        { label: 'Submitted', value: 'submitted', color: '#3B82F6' },
        { label: 'Approved', value: 'approved', color: '#10B981' },
        { label: 'Reimbursed', value: 'reimbursed', color: '#6366F1' },
      ],
    }),
    submitted_on: Field.date({ label: 'Submitted On' }),

    // ── Filtered roll-ups (the point of this object) ─────────────────────────
    // Child FK is auto-detected (showcase_expense_line.expense_report), so none
    // of these need `relationshipField`.

    /** Baseline: unfiltered — the grand total of every line. */
    total_amount: Field.summary({
      label: 'Total',
      summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: 'sum' },
    }),
    /** Filtered SUM (equality) — only lines a manager has approved. */
    approved_amount: Field.summary({
      label: 'Approved',
      summaryOperations: {
        object: 'showcase_expense_line',
        field: 'amount',
        function: 'sum',
        filter: { status: 'approved' },
      },
    }),
    /** Filtered SUM (boolean) — only lines billable back to a client. */
    reimbursable_amount: Field.summary({
      label: 'Reimbursable',
      summaryOperations: {
        object: 'showcase_expense_line',
        field: 'amount',
        function: 'sum',
        filter: { billable: true },
      },
    }),
    /** Baseline: unfiltered line count. */
    line_count: Field.summary({
      label: 'Lines',
      summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: 'count' },
    }),
    /** Filtered COUNT (equality) — lines a manager rejected. */
    rejected_count: Field.summary({
      label: 'Rejected',
      summaryOperations: {
        object: 'showcase_expense_line',
        field: 'amount',
        function: 'count',
        filter: { status: 'rejected' },
      },
    }),
    /** Filtered COUNT (operator) — lines at or above the $500 receipt-required
     *  threshold. Shows the FilterCondition operator form, not just equality. */
    over_limit_count: Field.summary({
      label: 'Over $500',
      summaryOperations: {
        object: 'showcase_expense_line',
        field: 'amount',
        function: 'count',
        filter: { amount: { $gte: 500 } },
      },
    }),
  },
});

/** Expense line item — owned by its report, entered inline in the grid. */
export const ExpenseLine = ObjectSchema.create({
  name: 'showcase_expense_line',
  label: 'Expense Line',
  pluralLabel: 'Expense Lines',
  icon: 'receipt',
  description: 'A single expense on a report; the parent report rolls these up with filters.',

  // ADR-0055: a line's access is CONTROLLED BY ITS PARENT report — the same
  // master-detail pattern as showcase_invoice_line. No RLS authored here; the
  // security layer derives it from the required master_detail relationship.
  sharingModel: 'controlled_by_parent',

  fields: {
    expense_report: Field.masterDetail('showcase_expense_report', {
      label: 'Report',
      required: true,
      deleteBehavior: 'cascade',
      // Thin, high-volume line items → the editable grid form factor. The
      // report's filtered summaries recompute as rows are saved in this grid.
      inlineEdit: 'grid',
      inlineTitle: 'Expense Lines',
    }),
    merchant: Field.text({ label: 'Merchant', required: true, maxLength: 120 }),
    category: Field.select({
      label: 'Category',
      options: [
        { label: 'Travel', value: 'travel' },
        { label: 'Meals', value: 'meals' },
        { label: 'Lodging', value: 'lodging' },
        { label: 'Supplies', value: 'supplies' },
        { label: 'Software', value: 'software' },
        { label: 'Other', value: 'other', default: true },
      ],
    }),
    amount: Field.currency({ label: 'Amount', required: true, scale: 2, min: 0 }),
    // Whether the expense is billable back to a client — the `billable: true`
    // filter on the report's `reimbursable_amount` rollup reads this.
    billable: Field.boolean({ label: 'Billable to client', defaultValue: false }),
    // Per-line approval status — a manager approves/rejects individual lines,
    // which is what the report's `approved_amount` / `rejected_count` filter on.
    status: Field.select({
      label: 'Line Status',
      required: true,
      options: [
        { label: 'Submitted', value: 'submitted', default: true, color: '#3B82F6' },
        { label: 'Approved', value: 'approved', color: '#10B981' },
        { label: 'Rejected', value: 'rejected', color: '#EF4444' },
      ],
    }),
    /**
     * The exact instant on the receipt — a meal at 19:45, a cab at 07:12.
     *
     * Deliberately a `datetime` sitting NEXT TO the `date` below: the two are
     * the inline grid's temporal-type fixture (objectui#3569). A renderer that
     * folds `datetime` onto the `date` control does not merely hide the clock —
     * `<input type="date">` emits a bare `YYYY-MM-DD`, so a user correcting the
     * DAY writes the time out of the record. Nothing in showcase could catch
     * that before, because no inline-grid child carried a datetime at all.
     *
     * Keep both columns: the pair is what makes the distinction observable.
     * With seven editable fields the grid's six-column default budget parks one
     * of them in the column chooser (`incurred_on`, by declaration order) — that
     * is the intended "personalize columns" behaviour, not a dropped field.
     */
    incurred_at: Field.datetime({ label: 'Incurred At' }),
    incurred_on: Field.date({ label: 'Incurred On' }),
  },
});
