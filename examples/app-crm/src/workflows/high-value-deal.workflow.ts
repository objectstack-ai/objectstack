// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { StateMachineConfig } from '@objectstack/spec/automation';

/**
 * High-Value Deal lifecycle — state-machine workflow.
 *
 * Migrated from the legacy `WorkflowRule` model (removed in the
 * "reclaim `workflow` for state machines" refactor). The original rule
 * fired when a `crm_opportunity` was created/updated with `amount > 100k`
 * and notified sales managers. That intent is preserved here as a guarded
 * transition: while an opportunity is `open`, an UPDATE whose amount clears
 * the $100k threshold moves it to the `high_value` state and runs the
 * notify action. The deal then closes won/lost like any other.
 */
export const HighValueDealWorkflow: StateMachineConfig = {
  id: 'crm_high_value_deal_alert',
  description:
    'Flags a crm_opportunity as high-value and notifies sales managers when the amount exceeds $100k.',
  initial: 'open',
  states: {
    open: {
      meta: { label: 'Open', description: 'Active opportunity below the high-value threshold.' },
      on: {
        UPDATE: {
          target: 'high_value',
          cond: { type: 'expression', params: { source: 'record.amount > 100000' } },
          actions: [
            {
              type: 'email_alert',
              params: {
                template: 'high_value_deal_alert',
                recipients: ['{record.owner_manager_email}'],
              },
            },
          ],
          description: 'Amount cleared the $100k threshold — notify sales managers.',
        },
        CLOSE_WON: 'won',
        CLOSE_LOST: 'lost',
      },
    },
    high_value: {
      meta: {
        label: 'High Value',
        description: 'Opportunity larger than $100k — under sales-manager watch.',
        color: '#16a34a',
      },
      on: {
        CLOSE_WON: 'won',
        CLOSE_LOST: 'lost',
      },
    },
    won: { type: 'final', meta: { label: 'Closed Won' } },
    lost: { type: 'final', meta: { label: 'Closed Lost' } },
  },
};
