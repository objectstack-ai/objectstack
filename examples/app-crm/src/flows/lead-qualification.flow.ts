// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Flow } from '@objectstack/spec/automation';

/**
 * Lead Qualification & Conversion Flow
 *
 * Exercises the full breadth of the Flow node type repertoire:
 *   • assignment      — initialise scoring variables
 *   • get_record      — fetch the related Account
 *   • http    — external enrichment API (with fault edge → error handler)
 *   • script          — calculate a composite lead score
 *   • decision        — branch on score threshold (conditional + isDefault edges)
 *   • parallel_gateway — AND-split: notify rep AND create Opportunity simultaneously
 *   • join_gateway    — AND-join: wait for both branches before continuing
 *   • create_record   — create the derived Opportunity
 *   • update_record   — mark lead converted / disqualified
 *   • wait            — pause 24 h for a prospect-response timer event
 *   • subflow         — escalate to manager if no follow-up after the wait
 *   • end             — multiple terminal nodes for distinct outcomes
 *
 * Flow-level config exercised:
 *   • variables       — typed input/output variable declarations
 *   • errorHandling   — retry with exponential back-off + fallback node
 *   • status / runAs / version
 */
export const LeadQualificationFlow: Flow = {
  name: 'lead_qualification_conversion',
  label: 'Lead Qualification & Conversion',
  description:
    'Qualifies an inbound lead through scoring and enrichment, then converts it to an Opportunity via parallel processing, a timed wait, and optional manager escalation.',
  type: 'record_change',
  status: 'active',
  version: 2,
  runAs: 'system',

  // ── Typed variable declarations ──────────────────────────────────────────
  variables: [
    { name: 'lead_score',       type: 'number',  isInput: false, isOutput: false },
    { name: 'enrichment_data',  type: 'object',  isInput: false, isOutput: false },
    { name: 'account_data',     type: 'object',  isInput: false, isOutput: false },
    { name: 'new_opportunity',  type: 'object',  isInput: false, isOutput: false },
    { name: 'opportunity_id',   type: 'text',    isInput: false, isOutput: true  },
    { name: 'qualified',        type: 'boolean', isInput: false, isOutput: true  },
  ],

  // ── Flow-level error handling (retry with exponential back-off) ──────────
  errorHandling: {
    strategy: 'retry',
    maxRetries: 3,
    retryDelayMs: 2000,
    backoffMultiplier: 2,
    maxRetryDelayMs: 30000,
    jitter: true,
    fallbackNodeId: 'error_handler',
  },

  // ── Node graph ───────────────────────────────────────────────────────────
  nodes: [

    // ── 1. Start — fires when lead status transitions to "qualifying" ─────
    {
      id: 'start',
      type: 'start',
      label: 'Lead Status → Qualifying',
      config: {
        objectName: 'crm_lead',
        triggerType: 'record-after-update',
        condition: 'status == "qualifying" && previous.status != "qualifying"',
      },
      position: { x: 400, y: 0 },
    },

    // ── 2. Assignment — initialise variables before any branching ─────────
    {
      id: 'init_vars',
      type: 'assignment',
      label: 'Initialise Scoring Variables',
      config: {
        assignments: [
          { variable: 'lead_score',      value: 0 },
          { variable: 'qualified',       value: false },
          { variable: 'enrichment_data', value: null },
        ],
      },
      position: { x: 400, y: 120 },
    },

    // ── 3. Get Record — fetch the linked Account for revenue scoring ───────
    {
      id: 'get_account',
      type: 'get_record',
      label: 'Fetch Account Details',
      config: {
        objectName: 'crm_account',
        filter: { id: '{record.account}' },
        outputVariable: 'account_data',
      },
      outputSchema: {
        account_data: { type: 'object', description: 'Account record' },
      },
      position: { x: 400, y: 240 },
    },

    // ── 4. HTTP Request — call an external enrichment service ─────────────
    //    A fault edge connects this node to error_handler if it fails.
    {
      id: 'enrich_lead',
      type: 'http',
      label: 'Enrich Lead (External API)',
      config: {
        method: 'POST',
        url: 'https://api.enrichment-service.example/leads/enrich',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': '{env.ENRICHMENT_API_KEY}',
        },
        body: {
          email:   '{record.email}',
          company: '{record.company}',
        },
        outputVariable: 'enrichment_data',
      },
      outputSchema: {
        enrichment_data: { type: 'object', description: 'Enrichment API response' },
      },
      timeoutMs: 10000,
      position: { x: 400, y: 360 },
    },

    // ── 5. Script — composite lead score from enrichment + account data ────
    {
      id: 'score_lead',
      type: 'script',
      label: 'Calculate Lead Score',
      config: {
        script: `
          let score = 0;
          // Source weighting
          const sourceBonus = { referral: 30, event: 20, web: 10, partner: 25 };
          score += sourceBonus[record.source] ?? 5;
          // Company size from enrichment (may be undefined if enrichment failed)
          const employees = enrichment_data?.employee_count ?? 0;
          if (employees > 500) score += 25;
          else if (employees > 100) score += 15;
          else if (employees > 20) score += 8;
          // Existing account relationship bonus
          if (account_data?.annual_revenue > 5_000_000) score += 20;
          else if (account_data?.annual_revenue > 1_000_000) score += 10;
          // Title / seniority
          const title = (record.title ?? '').toLowerCase();
          if (title.includes('vp') || title.includes('director') || title.includes('chief')) score += 15;
          else if (title.includes('manager') || title.includes('head')) score += 10;
          variables.lead_score = Math.min(score, 100);
          variables.qualified   = score >= 60;
        `,
        outputVariables: ['lead_score', 'qualified'],
      },
      outputSchema: {
        lead_score: { type: 'number',  description: 'Calculated score 0–100' },
        qualified:  { type: 'boolean', description: 'Whether score meets threshold' },
      },
      position: { x: 400, y: 480 },
    },

    // ── 6. Decision — route on qualification threshold ────────────────────
    {
      id: 'decide_qualification',
      type: 'decision',
      label: 'Lead Score ≥ 60?',
      config: {
        conditions: [
          { label: 'Qualified',     expression: 'lead_score >= 60' },
          { label: 'Not Qualified', expression: 'true' },
        ],
      },
      position: { x: 400, y: 600 },
    },

    // ── 7a. Disqualification path ─────────────────────────────────────────
    {
      id: 'update_lead_disqualified',
      type: 'update_record',
      label: 'Mark Lead Disqualified',
      config: {
        objectName: 'crm_lead',
        recordId: '{record.id}',
        data: {
          status: 'disqualified',
          notes:  'Auto-disqualified: Lead score {lead_score}/100 below threshold. Enrichment source: {enrichment_data.company_size}.',
        },
      },
      position: { x: 0, y: 720 },
    },

    // ── 7b. Parallel Gateway — AND-split (notify + create simultaneously) ─
    {
      id: 'parallel_split',
      type: 'parallel_gateway',
      label: 'Notify & Create Opportunity (Parallel)',
      position: { x: 600, y: 720 },
    },

    // ── 8a. Branch A — email notification to the assigned sales rep ────────
    {
      id: 'notify_sales_rep',
      type: 'script',
      label: 'Send Qualification Alert to Rep',
      config: {
        actionType: 'email',
        inputs: {
          to:       '{record.assigned_to}',
          subject:  '🎯 Lead Qualified: {record.name} (Score: {lead_score}/100)',
          template: 'lead_qualified_email',
          context: {
            lead_name:  '{record.name}',
            company:    '{record.company}',
            lead_score: '{lead_score}',
          },
        },
      },
      position: { x: 400, y: 840 },
    },

    // ── 8b. Branch B — create Opportunity record ───────────────────────────
    {
      id: 'create_opportunity',
      type: 'create_record',
      label: 'Create Opportunity from Lead',
      config: {
        objectName: 'crm_opportunity',
        data: {
          name:        '{record.company} — Converted Lead: {record.name}',
          account:     '{record.account}',
          stage:       'prospecting',
          amount:      0,
          probability: 20,
          close_date:  '{daysFromNow(90)}',
        },
        outputVariable: 'new_opportunity',
      },
      outputSchema: {
        new_opportunity: { type: 'object', description: 'Newly created opportunity' },
      },
      position: { x: 800, y: 840 },
    },

    // ── 9. Join Gateway — AND-join: wait for both branches ────────────────
    {
      id: 'parallel_join',
      type: 'join_gateway',
      label: 'Wait for Both Branches',
      position: { x: 600, y: 960 },
    },

    // ── 10. Update Lead — set converted state with opportunity link ────────
    {
      id: 'update_lead_converted',
      type: 'update_record',
      label: 'Mark Lead Converted',
      config: {
        objectName: 'crm_lead',
        recordId: '{record.id}',
        data: {
          status:                  'converted',
          converted_opportunity:   '{new_opportunity.id}',
        },
      },
      position: { x: 600, y: 1080 },
    },

    // ── 11. Wait — pause 24 h on a timer for prospect-response signal ──────
    {
      id: 'wait_prospect_response',
      type: 'wait',
      label: 'Wait 24 h for Prospect Response',
      waitEventConfig: {
        eventType:     'timer',
        timerDuration: 'PT24H',
        timeoutMs:     86_400_000,
        onTimeout:     'continue',
      },
      position: { x: 600, y: 1200 },
    },

    // ── 12. Decision — did the rep advance the opportunity? ────────────────
    {
      id: 'decide_followup',
      type: 'decision',
      label: 'Opportunity Advanced Beyond Prospecting?',
      config: {
        conditions: [
          { label: 'Follow-up complete', expression: 'new_opportunity.stage != "prospecting"' },
          { label: 'No follow-up',       expression: 'true' },
        ],
      },
      position: { x: 600, y: 1320 },
    },

    // ── 13. Subflow — escalate to manager when follow-up is missing ────────
    {
      id: 'escalate_to_manager',
      type: 'subflow',
      label: 'Escalate to Manager (Subflow)',
      config: {
        flowName: 'notify_manager_subflow',
        inputs: {
          opportunity_id: '{new_opportunity.id}',
          reason:         'No rep follow-up within 24 h of lead conversion (score: {lead_score})',
        },
      },
      position: { x: 800, y: 1440 },
    },

    // ── 14. Error handler — catch enrichment / unexpected failures ─────────
    {
      id: 'error_handler',
      type: 'script',
      label: 'Log Error & Continue Scoring',
      config: {
        script: `
          // Enrichment failed — proceed with partial score (no enrichment bonus)
          console.warn('Enrichment failed for lead', record.id, '; scoring without enrichment data.');
          variables.enrichment_data = {};
        `,
        outputVariables: ['enrichment_data'],
      },
      position: { x: 700, y: 360 },
    },

    // ── End nodes ─────────────────────────────────────────────────────────
    { id: 'end_disqualified', type: 'end', label: 'Lead Disqualified',            position: { x: 0,   y: 840  } },
    { id: 'end_converted',    type: 'end', label: 'Lead Converted Successfully',  position: { x: 400, y: 1440 } },
    { id: 'end_escalated',    type: 'end', label: 'Lead Escalated to Manager',    position: { x: 800, y: 1560 } },
  ],

  // ── Edge graph ───────────────────────────────────────────────────────────
  edges: [
    // Linear setup path
    { id: 'e01', source: 'start',              target: 'init_vars' },
    { id: 'e02', source: 'init_vars',          target: 'get_account' },
    { id: 'e03', source: 'get_account',        target: 'enrich_lead' },

    // Enrichment: success path → score; fault path → error_handler
    { id: 'e04', source: 'enrich_lead',        target: 'score_lead',    type: 'default' },
    { id: 'e05', source: 'enrich_lead',        target: 'error_handler', type: 'fault',       label: 'Enrichment Failed' },
    // Error handler rejoins the main path at score step
    { id: 'e06', source: 'error_handler',      target: 'score_lead' },

    { id: 'e07', source: 'score_lead',         target: 'decide_qualification' },

    // Decision: qualified branch → parallel split; default → disqualify
    { id: 'e08', source: 'decide_qualification', target: 'parallel_split',           type: 'conditional', condition: 'lead_score >= 60', label: 'Qualified' },
    { id: 'e09', source: 'decide_qualification', target: 'update_lead_disqualified', type: 'conditional', isDefault: true,               label: 'Not Qualified' },
    { id: 'e10', source: 'update_lead_disqualified', target: 'end_disqualified' },

    // Parallel split → two branches
    { id: 'e11', source: 'parallel_split',     target: 'notify_sales_rep' },
    { id: 'e12', source: 'parallel_split',     target: 'create_opportunity' },

    // Both branches → join
    { id: 'e13', source: 'notify_sales_rep',   target: 'parallel_join' },
    { id: 'e14', source: 'create_opportunity', target: 'parallel_join' },

    // Post-join → update lead → wait → follow-up decision
    { id: 'e15', source: 'parallel_join',          target: 'update_lead_converted' },
    { id: 'e16', source: 'update_lead_converted',  target: 'wait_prospect_response' },
    { id: 'e17', source: 'wait_prospect_response', target: 'decide_followup' },

    // Follow-up decision
    { id: 'e18', source: 'decide_followup', target: 'end_converted',      type: 'conditional', condition: 'new_opportunity.stage != "prospecting"', label: 'Follow-up Done' },
    { id: 'e19', source: 'decide_followup', target: 'escalate_to_manager', type: 'conditional', isDefault: true, label: 'No Follow-up' },
    { id: 'e20', source: 'escalate_to_manager', target: 'end_escalated' },
  ],
};
