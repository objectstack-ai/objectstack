// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { cel, P } from '@objectstack/spec';

export const Opportunity = ObjectSchema.create({
  name: 'crm_opportunity',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is intentionally org-shared; without this the new secure default
  // (unset OWD => private) would owner-filter it, and the D7 publish linter
  // (security-owd-unset) fails the build on an undeclared baseline.
  sharingModel: 'public_read_write',
  label: 'Opportunity',
  pluralLabel: 'Opportunities',
  icon: 'trending-up',
  description: 'A potential sale tied to an account.',

  fields: {
    name: Field.text({
      label: 'Opportunity Name',
      required: true,
      searchable: true,
      maxLength: 200,
    }),
    account: Field.lookup('crm_account', {
      label: 'Account',
      required: true,
    }),
    stage: Field.select({
      label: 'Stage',
      required: true,
      options: [
        { label: 'Prospecting', value: 'prospecting', default: true, color: '#94A3B8' },
        { label: 'Qualification', value: 'qualification', color: '#3B82F6' },
        { label: 'Proposal', value: 'proposal', color: '#F59E0B' },
        { label: 'Closed Won', value: 'closed_won', color: '#10B981' },
        { label: 'Closed Lost', value: 'closed_lost', color: '#EF4444' },
      ],
    }),
    amount: Field.currency({
      label: 'Amount',
      scale: 2,
      min: 0,
    }),
    probability: Field.percent({
      label: 'Probability',
      defaultValue: 50,
      min: 0,
      max: 100,
    }),
    expected_revenue: Field.formula({
      label: 'Expected Revenue',
      expression: cel`(record.amount == null ? 0 : record.amount) * (record.probability == null ? 0 : record.probability) / 100`,
    }),
    close_date: Field.date({
      label: 'Close Date',
    }),
    // Exercises the newly-registered `daysBetween` stdlib function — the canonical
    // "days remaining" formula (negative once the close date has passed).
    days_to_close: Field.formula({
      label: 'Days to Close',
      expression: cel`record.close_date == null ? 0 : daysBetween(today(), record.close_date)`,
    }),
    discount_percent: Field.percent({
      label: 'Discount %',
      defaultValue: 0,
      min: 0,
      max: 100,
    }),
    // Mirror target for the Discount Approval flow's approval nodes
    // (ADR-0019). The approval runtime writes the request status here; it is
    // readonly to users so only the flow drives it.
    approval_status: Field.select({
      label: 'Approval Status',
      readonly: true,
      options: [
        { label: 'Pending', value: 'pending', color: '#F59E0B' },
        { label: 'Approved', value: 'approved', color: '#10B981' },
        { label: 'Rejected', value: 'rejected', color: '#EF4444' },
        { label: 'Recalled', value: 'recalled', color: '#94A3B8' },
      ],
    }),
    renewal_of: Field.lookup('crm_opportunity', {
      label: 'Renewal Of',
    }),
    // Roll-up of the opportunity's product line items — recomputed server-side
    // as lines are inserted/updated/deleted (child FK auto-detected:
    // crm_opportunity_line_item.opportunity). The line-item grid also shows a
    // live running total during entry (inlineAmountField: 'amount').
    line_total: Field.summary({
      label: 'Products Total',
      summaryOperations: { object: 'crm_opportunity_line_item', field: 'amount', function: 'sum' },
    }),
  },

  validations: [
    {
      type: 'script' as const,
      name: 'discount_cap',
      label: 'Discount Cap 40%',
      description: 'Discounts over 40% require special approval.',
      condition: P`record.discount_percent != null && record.discount_percent > 40`,
      message: 'Discount cannot exceed 40% without an approved exception.',
      severity: 'error' as const,
    },
    {
      type: 'cross_field' as const,
      name: 'opp_close_date_not_past',
      label: 'Close Date Must Be Future',
      description: 'Prevent back-dating the close_date of an OPEN opportunity. Closed (won/lost) deals legitimately carry a historical close date, so they are exempt.',
      fields: ['close_date'],
      // `!= null`, not `has(...)` (#4649): `has(x)` is TRUE for a declared
      // column holding NULL, so the old guard let `null < now()` fault and the
      // rule silently did nothing on every opportunity created without a close
      // date.
      condition: P`record.close_date != null && record.close_date < now() && record.stage != "closed_won" && record.stage != "closed_lost"`,
      message: 'Close Date must be today or a future date.',
      events: ['insert'],
    },
    {
      type: 'state_machine' as const,
      name: 'opp_stage_transitions',
      label: 'Opportunity Stage Flow',
      description: 'Opportunities should progress through stages in order.',
      field: 'stage',
      message: 'Invalid stage transition.',
      transitions: {
        prospecting:  ['qualification', 'closed_lost'],
        qualification:['proposal', 'closed_lost'],
        proposal:     ['closed_won', 'closed_lost'],
        closed_won:   [],
        closed_lost:  ['prospecting'],
      },
    },
  ],
});
