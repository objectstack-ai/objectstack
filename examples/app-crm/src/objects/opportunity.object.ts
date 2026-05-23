import { P } from '@objectstack/spec';
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { OpportunityStateMachine } from './opportunity.state';

export const Opportunity = ObjectSchema.create({
  name: 'opportunity',
  label: 'Opportunity',
  pluralLabel: 'Opportunities',
  icon: 'dollar-sign',
  description: 'Sales opportunities and deals in the pipeline',
  titleFormat: '{name} - {stage}',
  compactLayout: ['name', 'account', 'amount', 'stage', 'owner'],

  fieldGroups: [
    { key: 'basic',       label: 'Basic Information',   icon: 'dollar-sign' },
    { key: 'financials',  label: 'Financials',          icon: 'trending-up' },
    { key: 'sales_process', label: 'Sales Process',     icon: 'target' },
    { key: 'classification', label: 'Classification',   icon: 'tag' },
    { key: 'competition', label: 'Competition & Campaigns', icon: 'flag', defaultExpanded: false },
    { key: 'notes',       label: 'Notes & Next Steps',  icon: 'file-text' },
    { key: 'forecast',    label: 'Forecast & Metrics',  icon: 'bar-chart', defaultExpanded: false },
  ],

  fields: {
    // Basic Information
    name: Field.text({
      label: 'Opportunity Name',
      required: true,
      searchable: true,
      group: 'basic',
    }),

    // Relationships
    account: Field.lookup('account', {
      label: 'Account',
      required: true,
      group: 'basic',
    }),

    primary_contact: Field.lookup('contact', {
      label: 'Primary Contact',
      referenceFilters: ['account = {opportunity.account}'],  // Filter contacts by account
      group: 'basic',
    }),

    owner: Field.lookup('user', {
      label: 'Opportunity Owner',
      group: 'basic',
    }),

    // Financial Information
    amount: Field.currency({
      label: 'Amount',
      required: true,
      scale: 2,
      min: 0,
      group: 'financials',
    }),

    expected_revenue: Field.currency({
      label: 'Expected Revenue',
      scale: 2,
      readonly: true,  // Calculated field
      group: 'financials',
    }),

    // Sales Process
    stage: Field.select({
      label: 'Stage',
      required: true,
      group: 'sales_process',
      options: [
        { label: 'Prospecting', value: 'prospecting', color: '#808080', default: true },
        { label: 'Qualification', value: 'qualification', color: '#FFA500' },
        { label: 'Needs Analysis', value: 'needs_analysis', color: '#FFD700' },
        { label: 'Proposal', value: 'proposal', color: '#4169E1' },
        { label: 'Negotiation', value: 'negotiation', color: '#9370DB' },
        { label: 'Closed Won', value: 'closed_won', color: '#00AA00' },
        { label: 'Closed Lost', value: 'closed_lost', color: '#FF0000' },
      ]
    }),

    probability: Field.percent({
      label: 'Probability (%)',
      min: 0,
      max: 100,
      defaultValue: 10,
      group: 'sales_process',
    }),

    // Important Dates
    close_date: Field.date({
      label: 'Close Date',
      required: true,
      group: 'sales_process',
    }),

    created_date: Field.datetime({
      label: 'Created Date',
      readonly: true,
      group: 'sales_process',
    }),

    // Additional Classification
    type: Field.select({
      label: 'Opportunity Type',
      group: 'classification',
      options: [
        { label: 'New Business', value: 'new_business' },
        { label: 'Existing Customer - Upgrade', value: 'existing_upgrade' },
        { label: 'Existing Customer - Renewal', value: 'existing_renewal' },
        { label: 'Existing Customer - Expansion', value: 'existing_expansion' },
      ]
    }),

    lead_source: Field.select({
      label: 'Lead Source',
      group: 'classification',
      options: [
        { label: 'Web', value: 'web' },
        { label: 'Referral', value: 'referral' },
        { label: 'Event', value: 'event' },
        { label: 'Partner', value: 'partner' },
        { label: 'Advertisement', value: 'advertisement' },
        { label: 'Cold Call', value: 'cold_call' },
      ]
    }),

    // Competitor Analysis
    competitors: Field.select({
      label: 'Competitors',
      multiple: true,
      group: 'competition',
      options: [
        { label: 'Competitor A', value: 'competitor_a' },
        { label: 'Competitor B', value: 'competitor_b' },
        { label: 'Competitor C', value: 'competitor_c' },
      ]
    }),

    // Campaign tracking
    campaign: Field.lookup('campaign', {
      label: 'Campaign',
      description: 'Marketing campaign that generated this opportunity',
      group: 'competition',
    }),

    // Sales cycle metrics
    days_in_stage: Field.number({
      label: 'Days in Current Stage',
      readonly: true,
      group: 'forecast',
    }),

    // Additional information
    description: Field.markdown({
      label: 'Description',
      group: 'notes',
    }),

    next_step: Field.textarea({
      label: 'Next Steps',
      group: 'notes',
    }),

    // Flags
    is_private: Field.boolean({
      label: 'Private',
      defaultValue: false,
      group: 'forecast',
    }),

    forecast_category: Field.select({
      label: 'Forecast Category',
      group: 'forecast',
      options: [
        { label: 'Pipeline', value: 'pipeline' },
        { label: 'Best Case', value: 'best_case' },
        { label: 'Commit', value: 'commit' },
        { label: 'Omitted', value: 'omitted' },
        { label: 'Closed', value: 'closed' },
      ]
    }),

    // Approval workflow tracking
    approval_status: Field.select({
      label: 'Approval Status',
      group: 'sales_process',
      readonly: true,
      options: [
        { label: 'Not Required', value: 'not_required', default: true },
        { label: 'Pending', value: 'pending', color: '#FFA500' },
        { label: 'Approved', value: 'approved', color: '#00AA00' },
        { label: 'Rejected', value: 'rejected', color: '#FF0000' },
      ],
    }),

    approved_date: Field.datetime({
      label: 'Approved Date',
      readonly: true,
      group: 'sales_process',
    }),

    // Win / Loss analysis — required when stage moves to closed_*
    win_reason: Field.select({
      label: 'Win Reason',
      group: 'classification',
      options: [
        { label: 'Better Product', value: 'better_product' },
        { label: 'Better Price', value: 'better_price' },
        { label: 'Existing Relationship', value: 'relationship' },
        { label: 'Better Support', value: 'better_support' },
        { label: 'Best Fit / Features', value: 'best_fit' },
        { label: 'Other', value: 'other' },
      ],
    }),

    loss_reason: Field.select({
      label: 'Loss Reason',
      group: 'classification',
      options: [
        { label: 'Price Too High', value: 'price' },
        { label: 'Lost to Competitor', value: 'competitor' },
        { label: 'No Budget', value: 'no_budget' },
        { label: 'No Decision', value: 'no_decision' },
        { label: 'Bad Timing', value: 'timing' },
        { label: 'Missing Features', value: 'features' },
        { label: 'Other', value: 'other' },
      ],
    }),

    loss_details: Field.textarea({
      label: 'Loss/Win Details',
      group: 'classification',
    }),
  },
  
  // Database indexes for performance
  indexes: [
    { fields: ['name'] },
    { fields: ['account'] },
    { fields: ['owner'] },
    { fields: ['stage'] },
    { fields: ['close_date'] },
  ],
  
  // Enable advanced features
  enable: {
    trackHistory: true,    // Critical for tracking stage changes
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'aggregate', 'search'], // Whitelist allowed API operations
    files: true,           // Attach proposals, contracts
    feeds: true,           // Team collaboration (Chatter-like)
    activities: true,      // Enable tasks and events tracking
    trash: true,
    mru: true,             // Track Most Recently Used
  },
  
  // Removed: list_views and form_views belong in UI configuration, not object definition
  
  // Lifecycle State Machine(s)
  stateMachines: {
    lifecycle: OpportunityStateMachine,
  },
  
  // Validation Rules
  validations: [
    {
      name: 'close_date_future',
      type: 'script',
      severity: 'warning',
      message: 'Close date should not be in the past unless opportunity is closed',
      condition: P`record.close_date < today() && record.stage != "closed_won" && record.stage != "closed_lost"`,
    },
    {
      name: 'amount_positive',
      type: 'script',
      severity: 'error',
      message: 'Amount must be greater than zero',
      condition: P`record.amount <= 0`,
    },
  ],
  
  // Workflow Rules
  workflows: [
    {
      name: 'update_probability_by_stage',
      objectName: 'opportunity',
      triggerType: 'on_create_or_update',
      criteria: P`record.stage != previous.stage`,
      active: true,
      actions: [
        {
          name: 'set_probability',
          type: 'field_update',
          field: 'probability',
          value: `CASE(record.stage,
            "prospecting", 10,
            "qualification", 25,
            "needs_analysis", 40,
            "proposal", 60,
            "negotiation", 80,
            "closed_won", 100,
            "closed_lost", 0,
            record.probability
          )`,
        },
        {
          name: 'set_forecast_category',
          type: 'field_update',
          field: 'forecast_category',
          value: `CASE(record.stage,
            "prospecting", "pipeline",
            "qualification", "pipeline",
            "needs_analysis", "best_case",
            "proposal", "commit",
            "negotiation", "commit",
            "closed_won", "closed",
            "closed_lost", "omitted",
            record.forecast_category
          )`,
        }
      ],
    },
    {
      name: 'calculate_expected_revenue',
      objectName: 'opportunity',
      triggerType: 'on_create_or_update',
      criteria: P`record.amount != previous.amount || record.probability != previous.probability`,
      active: true,
      actions: [
        {
          name: 'update_expected_revenue',
          type: 'field_update',
          field: 'expected_revenue',
          value: 'record.amount * (record.probability / 100)',
        }
      ],
    },
    {
      name: 'notify_on_large_deal_won',
      objectName: 'opportunity',
      triggerType: 'on_update',
      criteria: P`record.stage != previous.stage && record.stage == "closed_won" && record.amount > 100000`,
      active: true,
      actions: [
        {
          name: 'notify_management',
          type: 'email_alert',
          template: 'large_deal_won',
          recipients: ['sales_management@example.com'],
        }
      ],
    }
  ],
});