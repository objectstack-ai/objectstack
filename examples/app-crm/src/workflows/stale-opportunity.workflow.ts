// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { StateMachineConfig } from '@objectstack/spec/automation';

/**
 * Stale Opportunity lifecycle — state-machine workflow.
 *
 * Migrated from the legacy time-based `WorkflowRule` (removed in the
 * "reclaim `workflow` for state machines" refactor). The original rule ran
 * on a schedule, found open `crm_opportunity` records untouched for 30+
 * days, and (a) emailed the owner and (b) created a follow-up task.
 *
 * Here the scheduled sweep is modelled as a `STALE_30D` event delivered to
 * the machine: while `active`, that event (guarded to open opportunities)
 * runs the same two actions and moves the record to `flagged`. A later
 * UPDATE clears the flag back to `active`; closing the deal ends the
 * lifecycle.
 */
export const StaleOpportunityWorkflow: StateMachineConfig = {
  id: 'crm_stale_opportunity_alert',
  description:
    'Flags open opportunities untouched for 30 days, notifies the sales rep, and opens a follow-up task.',
  initial: 'active',
  states: {
    active: {
      meta: { label: 'Active', description: 'Open opportunity within the freshness window.' },
      on: {
        STALE_30D: {
          target: 'flagged',
          cond: {
            type: 'expression',
            params: { source: 'stage != "closed_won" && stage != "closed_lost"' },
          },
          actions: [
            {
              type: 'email_alert',
              params: {
                template: 'stale_opportunity_alert',
                recipients: ['{record.owner_email}'],
              },
            },
            {
              type: 'task_creation',
              params: {
                taskObject: 'crm_activity',
                subject: 'Follow up on stale opportunity: {record.name}',
                description:
                  'This opportunity has not been updated in 30+ days. Please review and update.',
                dueDate: '{daysFromNow(3)}',
              },
            },
          ],
          description: 'No update in 30+ days — notify the owner and open a follow-up task.',
        },
        CLOSE_WON: 'won',
        CLOSE_LOST: 'lost',
      },
    },
    flagged: {
      meta: {
        label: 'Stale',
        description: 'Flagged as stale; awaiting owner action.',
        color: '#f59e0b',
      },
      on: {
        UPDATED: 'active',
        CLOSE_WON: 'won',
        CLOSE_LOST: 'lost',
      },
    },
    won: { type: 'final', meta: { label: 'Closed Won' } },
    lost: { type: 'final', meta: { label: 'Closed Lost' } },
  },
};
