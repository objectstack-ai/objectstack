// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSharingRule } from '@objectstack/spec/security';

/**
 * Criteria-based sharing: share high-value opportunities (amount > 100000)
 * with the Sales Manager role so managers always have read access to big deals.
 */
export const HighValueOpportunitySharingRule = defineSharingRule({
  type: 'criteria',
  name: 'share_high_value_opps_with_managers',
  label: 'High-Value Deals → Sales Managers',
  description: 'Automatically share opportunities over $100,000 with all Sales Managers.',
  object: 'crm_opportunity',
  condition: 'record.amount > 100000',
  accessLevel: 'edit',
  sharedWith: {
    type: 'position',
    value: 'sales_manager',
  },
  active: true,
});

/**
 * Criteria-based sharing: in-flight leads (not yet converted or disqualified)
 * are shared read-only with Sales Managers for coaching visibility.
 *
 * Replaces the retired owner-based `share_rep_leads_with_manager` rule:
 * `type: 'owner'` (`ownedBy`) no longer parses — it depended on live position
 * membership and was silently skipped at seed time (ADR-0078). The enforced
 * criteria form scopes the same coaching set by pipeline state instead.
 */
export const RepLeadSharingRule = defineSharingRule({
  type: 'criteria',
  name: 'share_active_leads_with_manager',
  label: 'Active Leads → Manager (read-only)',
  description: 'Share in-flight (not converted/disqualified) leads with Sales Managers for coaching visibility.',
  object: 'crm_lead',
  condition: "record.status != 'converted' && record.status != 'disqualified'",
  accessLevel: 'read',
  sharedWith: {
    type: 'position',
    value: 'sales_manager',
  },
  active: true,
});

/**
 * Criteria-based: share activities linked to won deals with the whole
 * Sales team so everyone can learn from successful engagement patterns.
 */
export const WonDealActivitySharingRule = defineSharingRule({
  type: 'criteria',
  name: 'share_won_deal_activities',
  label: 'Won-Deal Activities → All Sales',
  description: 'Share activities attached to closed-won opportunities across the sales team.',
  object: 'crm_activity',
  condition: "record.status == 'completed'",
  accessLevel: 'read',
  sharedWith: {
    type: 'position',
    value: 'sales_rep',
  },
  active: true,
});
