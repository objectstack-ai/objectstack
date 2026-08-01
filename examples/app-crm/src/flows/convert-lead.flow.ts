// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * Convert Lead → Customer + Opportunity — Master-Detail Screen Flow
 *
 * A user-triggered wizard that walks a sales rep through converting a qualified
 * lead into a full Account + Opportunity. Unlike a flat field-list wizard, each
 * step renders the target object's COMPLETE create form via an `object-form`
 * screen node (`config.objectName`): the client renders the real ObjectForm —
 * including inline master-detail child grids — persists the record (and its
 * children, atomically), and resumes the run with the new record's id bound to
 * `config.idVariable`.
 *
 *   start → get_lead → decision (already converted?) — exclusive, exactly one:
 *     → screen_already_converted (abort path, when status == 'converted')
 *     → screen_account       (Step 1 — full Customer form → account_id)
 *     → screen_opportunity   (Step 2 — full Opportunity form WITH product
 *                             line-items grid, prefilled account → opportunity_id)
 *     → update_lead          (mark converted + link account & opportunity)
 *     → end
 */
export const ConvertLeadScreenFlow = defineFlow({
  name: 'crm_convert_lead_wizard',
  label: 'Convert Lead to Customer + Opportunity',
  description:
    'Screen-flow wizard that walks the rep through a full Customer form then a full Opportunity form (with product line items), creates both, and marks the lead converted.',
  type: 'screen',
  status: 'active',
  runAs: 'user',

  // Friendly terminal toasts — the flow-runner shows these instead of a generic
  // "Done" / the raw error when the wizard finishes.
  successMessage: '🎉 Lead converted — customer and opportunity created.',
  errorMessage: 'Lead conversion did not finish — review the lead and try again.',

  variables: [
    // ── input (from the action trigger) ───────────────────────────────────
    { name: 'recordId',       type: 'text',   isInput: true,  isOutput: false },
    // ── intermediate (populated at runtime) ───────────────────────────────
    { name: 'lead_record',    type: 'object', isInput: false, isOutput: false },
    // ── produced by the object-form steps (the saved record ids) ──────────
    // `isInput: true` lets the trigger API pre-populate them for automated
    // testing; at runtime each is bound by its step's `idVariable` on resume.
    { name: 'account_id',     type: 'text',   isInput: true,  isOutput: true  },
    { name: 'opportunity_id', type: 'text',   isInput: true,  isOutput: true  },
  ],

  nodes: [
    // ── 1. Start ──────────────────────────────────────────────────────────
    { id: 'start', type: 'start', label: 'Start' },

    // ── 2. Load the lead record ───────────────────────────────────────────
    {
      id: 'get_lead',
      type: 'get_record',
      label: 'Load Lead',
      config: {
        objectName: 'crm_lead',
        // get_record filters via `filter` (it ignores a bare `recordId`), so
        // load THIS lead by id — otherwise findOne with an empty filter returns
        // the first lead in the table.
        filter: { id: '{recordId}' },
        outputVariable: 'lead_record',
      },
    },

    // ── 3. Guard: already converted? ──────────────────────────────────────
    // A plain exclusive gateway: the branching lives on the OUT-EDGES (`e3a`'s
    // CEL condition, `e3b`'s `isDefault`) — ONE mechanism, not two.
    //
    // It used to ALSO declare `config.conditions` with its own labels, and that
    // guard did not guard (#4414). Those labels (`'Yes — already converted'` /
    // `'No — proceed'`) matched no out-edge label (`'Yes'` / `'No'`), so the
    // branch the node computed was dropped and every out-edge was considered
    // instead — and `e3b` was unconditional, so an already-converted lead got
    // the abort screen AND walked straight into the wizard behind it.
    {
      id: 'check_converted',
      type: 'decision',
      label: 'Already Converted?',
    },

    // ── 3a. Already-converted abort screen ────────────────────────────────
    {
      id: 'screen_already_converted',
      type: 'screen',
      label: 'Already Converted',
      config: {
        waitForInput: true,
        title: 'Already Converted',
        description: 'This lead has already been converted to an opportunity.',
      },
    },

    // ── 4. Step 1 — full Customer (Account) form ──────────────────────────
    // `objectName` ⇒ object-form screen: the client renders the real
    // crm_account create form, persists it, and resumes with the new id under
    // `account_id`.
    {
      id: 'screen_account',
      type: 'screen',
      label: 'Customer',
      config: {
        objectName: 'crm_account',
        idVariable: 'account_id',
        title: 'Step 1 of 2 · Customer',
        description: 'Review and complete the customer record carried over from the lead.',
        defaults: {
          name: '{lead_record.company}',
        },
      },
    },

    // ── 5. Step 2 — full Opportunity form WITH product line items ──────────
    // crm_opportunity_line_item.opportunity declares inlineEdit: 'grid', so the
    // standard Opportunity form (and therefore this step) renders an editable
    // product line-item grid below the header — the master-detail entry the
    // user asked for. The account FK is prefilled with Step 1's new id.
    {
      id: 'screen_opportunity',
      type: 'screen',
      label: 'Opportunity',
      config: {
        objectName: 'crm_opportunity',
        idVariable: 'opportunity_id',
        title: 'Step 2 of 2 · Opportunity',
        description: 'Add the opportunity and its product line items. Saved together in one transaction.',
        defaults: {
          name: '{lead_record.name}',
          account: '{account_id}',
          stage: 'qualification',
        },
      },
    },

    // ── 6. Mark the lead converted + link both new records ────────────────
    {
      id: 'update_lead',
      type: 'update_record',
      label: 'Mark Lead Converted',
      config: {
        objectName: 'crm_lead',
        filter: { id: '{recordId}' },
        fields: {
          status:                'converted',
          account:               '{account_id}',
          converted_opportunity: '{opportunity_id}',
        },
      },
    },

    // ── 7. End ────────────────────────────────────────────────────────────
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1',  source: 'start',                    target: 'get_lead',                 type: 'default' },
    { id: 'e2',  source: 'get_lead',                 target: 'check_converted',          type: 'default' },
    // Guard branches — mutually exclusive. `e3a` carries the CEL predicate;
    // `e3b` is the BPMN default flow (`isDefault`), traversed ONLY when no
    // conditional sibling matched. Without that marker `e3b` is an ordinary
    // unconditional out-edge and runs on every pass, wizard and abort screen
    // together (#4414).
    { id: 'e3a', source: 'check_converted',          target: 'screen_already_converted', type: 'default', condition: "lead_record.status == 'converted'", label: 'Yes' },
    { id: 'e3b', source: 'check_converted',          target: 'screen_account',           type: 'default', isDefault: true, label: 'No' },
    { id: 'e3c', source: 'screen_already_converted', target: 'end',                      type: 'default' },
    // main path — full Customer form → full Opportunity form → link
    { id: 'e4',  source: 'screen_account',           target: 'screen_opportunity',       type: 'default' },
    { id: 'e5',  source: 'screen_opportunity',       target: 'update_lead',              type: 'default' },
    { id: 'e6',  source: 'update_lead',              target: 'end',                      type: 'default' },
  ],

  errorHandling: {
    strategy: 'fail',
    maxRetries: 0,
    retryDelayMs: 0,
    backoffMultiplier: 1,
    maxRetryDelayMs: 0,
    jitter: false,
  },
});
