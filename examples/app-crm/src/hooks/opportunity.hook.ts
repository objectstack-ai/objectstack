// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineHook, type HookContext } from '@objectstack/spec/data';

/**
 * Pin the probability to 100% when an opportunity is marked Closed Won,
 * and 0% when Closed Lost. Demonstrates a basic before-update hook.
 */
export const OpportunityStageHook = defineHook({
  name: 'opportunity_stage_probability',
  object: 'crm_opportunity',
  events: ['beforeInsert', 'beforeUpdate'],
  priority: 100,
  handler: async (ctx: HookContext) => {
    const input = ctx.input as { stage?: string; probability?: number };
    if (input.stage === 'closed_won') input.probability = 100;
    if (input.stage === 'closed_lost') input.probability = 0;
  },
});
