// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The app the handle's own tests boot — a deliberately small CRM slice whose
// four surfaces are each declared the way a real app ships them:
//
//   • `hnd_deal` carries an L2 (sandboxed JS) lifecycle hook — a port of
//     hotcrm's `opportunity_lifecycle` (`src/objects/opportunity.hook.ts`,
//     the derivation half): stage → probability / forecast_category,
//     amount × probability → expected_revenue, and the `stage_entry_date`
//     clock stamped on insert and on every stage change. hotcrm ships its
//     hooks as bodies, so the exemplar has to run through the QuickJS runner
//     the runtime binds at boot, not as an in-process function.
//   • `hnd_deal` also declares a validation rule (`amount_non_negative`) and a
//     script action with a declared param contract (`apply_discount`).
//   • `hnd_resolve_note` is a screen flow — start → screen → update_record →
//     end — the shape `flow-quote.test.ts` drives in hotcrm (run, then resume
//     with the screen's input).
//   • `hnd_vault` is granted to NOBODY but the platform admin, so a member's
//     write to it is the negative case the parity pin needs: the SAME refusal
//     has to come out of `hooks.run` and out of `POST /data/hnd_vault`.
//
// The `isDefault` permission set is what `bootStack` wires as the fresh
// member's baseline (#7001), exactly as `objectstack serve` would.

import { defineStack, P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';
import { PermissionSetSchema } from '@objectstack/spec/security';

export const STAGES = [
  'prospecting',
  'qualification',
  'needs_analysis',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
] as const;

/** The two derivation tables the hook body carries — the port keeps hotcrm's values. */
export const STAGE_PROBABILITY: Record<(typeof STAGES)[number], number> = {
  prospecting: 10,
  qualification: 25,
  needs_analysis: 40,
  proposal: 60,
  negotiation: 80,
  closed_won: 100,
  closed_lost: 0,
};
export const STAGE_FORECAST: Record<(typeof STAGES)[number], string> = {
  prospecting: 'pipeline',
  qualification: 'pipeline',
  needs_analysis: 'best_case',
  proposal: 'commit',
  negotiation: 'commit',
  closed_won: 'closed',
  closed_lost: 'omitted',
};

/** Today as the hook stamps it (`YYYY-MM-DD`, UTC) — the port of hotcrm's `today()`. */
export const today = (): string => new Date().toISOString().slice(0, 10);

export const HandleDeal = ObjectSchema.create({
  name: 'hnd_deal',
  // [ADR-0090 D1] The gate these tests measure is the OBJECT grant and the
  // hook chain; owner-sharing is kept out of the way on purpose.
  sharingModel: 'public_read_write',
  label: 'Deal',
  pluralLabel: 'Deals',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    amount: Field.number({ label: 'Amount' }),
    stage: Field.select({
      label: 'Stage',
      options: STAGES.map((value) => ({ label: value, value })),
    }),
    probability: Field.number({ label: 'Probability' }),
    expected_revenue: Field.number({ label: 'Expected revenue' }),
    forecast_category: Field.text({ label: 'Forecast category' }),
    stage_entry_date: Field.text({ label: 'Stage entry date' }),
    note: Field.text({ label: 'Note' }),
  },
  validations: [
    {
      name: 'amount_non_negative',
      type: 'script',
      severity: 'error',
      message: 'Amount cannot be negative',
      condition: P`record.amount < 0`,
    },
  ],
});

/** Granted to nobody but the platform admin — the parity pin's refusal case. */
export const HandleVault = ObjectSchema.create({
  name: 'hnd_vault',
  sharingModel: 'public_read_write',
  label: 'Vault',
  pluralLabel: 'Vaults',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/** The record the resumed half of the screen flow stamps. */
export const HandleNote = ObjectSchema.create({
  name: 'hnd_note',
  sharingModel: 'public_read_write',
  label: 'Note',
  pluralLabel: 'Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
    resolution: Field.text({ label: 'Resolution' }),
  },
});

/**
 * hotcrm `opportunity_lifecycle`, derivation half, as the L2 body hotcrm
 * ships. Body-only: no module scope, so the tables are declared inside.
 */
const DEAL_LIFECYCLE_SOURCE = `
  const STAGE_PROBABILITY = {
    prospecting: 10, qualification: 25, needs_analysis: 40, proposal: 60,
    negotiation: 80, closed_won: 100, closed_lost: 0,
  };
  const STAGE_FORECAST = {
    prospecting: 'pipeline', qualification: 'pipeline', needs_analysis: 'best_case',
    proposal: 'commit', negotiation: 'commit', closed_won: 'closed', closed_lost: 'omitted',
  };
  const input = ctx.input;
  const previous = ctx.previous || {};
  const stage = input.stage !== undefined ? input.stage : previous.stage;
  const stageChanged = ctx.event === 'beforeInsert' || (input.stage !== undefined && input.stage !== previous.stage);
  if (stage && STAGE_PROBABILITY[stage] !== undefined) {
    input.probability = STAGE_PROBABILITY[stage];
    input.forecast_category = STAGE_FORECAST[stage];
  }
  const amount = input.amount !== undefined ? input.amount : previous.amount;
  const probability = input.probability !== undefined ? input.probability : previous.probability;
  if (typeof amount === 'number' && typeof probability === 'number') {
    input.expected_revenue = (amount * probability) / 100;
  }
  if (stageChanged) {
    input.stage_entry_date = new Date().toISOString().slice(0, 10);
  }
`;

/**
 * `apply_discount`: a script action with a declared param, run in the sandbox.
 *
 * Spelled in the sandbox's OWN dialect — the declared params arrive as
 * `ctx.input`, the subject as `ctx.record` / `ctx.recordId`, and `ctx.api`'s
 * `update` takes `(data, { where })` (`packages/runtime/src/sandbox/body-runner.ts`).
 * The first draft wrote `ctx.params.discount`, the shape a hand-rolled harness
 * would have accepted; the real runner refused it, which is the handle doing
 * its job.
 */
const APPLY_DISCOUNT_SOURCE = `
  const discount = ctx.input.discount;
  const amount = Math.round(ctx.record.amount * (100 - discount)) / 100;
  await ctx.api.object('hnd_deal').update({ amount: amount }, { where: { id: ctx.recordId } });
  return { amount: amount, discount: discount };
`;

/** start → screen (pauses) → update_record → end. */
export const resolveNoteFlow: Flow = {
  name: 'hnd_resolve_note',
  label: 'Resolve note',
  type: 'screen',
  status: 'active',
  variables: [{ name: 'noteId', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'ask',
      type: 'screen',
      label: 'Resolution',
      config: {
        title: 'How was it resolved?',
        fields: [{ name: 'resolution', label: 'Resolution', type: 'text', required: true }],
      },
    },
    {
      id: 'apply',
      type: 'update_record',
      label: 'Apply resolution',
      config: {
        objectName: 'hnd_note',
        filter: { id: '{noteId}' },
        fields: { status: 'resolved', resolution: '{resolution}' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ask' },
    { id: 'e2', source: 'ask', target: 'apply' },
    { id: 'e3', source: 'apply', target: 'end' },
  ],
};

export const HANDLE_MEMBER_SET = 'hnd_member_default';

/** The fresh member's baseline: deals and notes, never the vault. */
export const handleMemberSet = PermissionSetSchema.parse({
  name: HANDLE_MEMBER_SET,
  label: 'Handle fixture member (default)',
  isDefault: true,
  objects: {
    hnd_deal: { allowRead: true, allowCreate: true, allowEdit: true },
    hnd_note: { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

export const handleFixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.handle-fixture',
    namespace: 'hnd',
    version: '0.0.0',
    type: 'app',
    name: 'Verify Handle Fixture',
    description: 'A hook, a validation rule, a script action, a screen flow and an ungranted object.',
  },
  objects: [HandleDeal, HandleVault, HandleNote],
  hooks: [
    {
      name: 'hnd_deal_lifecycle',
      label: 'Deal lifecycle (derivations)',
      object: 'hnd_deal',
      events: ['beforeInsert', 'beforeUpdate'],
      body: { language: 'js', source: DEAL_LIFECYCLE_SOURCE, capabilities: [] },
    },
  ],
  actions: [
    {
      name: 'apply_discount',
      label: 'Apply discount',
      objectName: 'hnd_deal',
      type: 'script',
      params: [{ name: 'discount', label: 'Discount %', type: 'number', required: true }],
      body: { language: 'js', source: APPLY_DISCOUNT_SOURCE, capabilities: ['api.read', 'api.write'] },
    },
  ],
  flows: [resolveNoteFlow],
  permissions: [handleMemberSet],
} as never);
