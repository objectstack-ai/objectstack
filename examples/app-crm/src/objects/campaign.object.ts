// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F, P } from '@objectstack/spec';

/**
 * Campaign Object
 * Represents marketing campaigns
 */
export const Campaign = ObjectSchema.create({
  name: 'campaign',
  label: 'Campaign',
  pluralLabel: 'Campaigns',
  icon: 'megaphone',
  description: 'Marketing campaigns and initiatives',
  titleFormat: '{campaign_code} - {name}',
  compactLayout: ['campaign_code', 'name', 'type', 'status', 'start_date'],
  
  fields: {
    // AutoNumber field
    campaign_code: Field.autonumber({
      label: 'Campaign Code',
      format: 'CPG-{0000}',
    }),
    
    // Basic Information
    name: Field.text({ 
      label: 'Campaign Name', 
      required: true, 
      searchable: true,
      maxLength: 255,
    }),
    
    description: Field.markdown({
      label: 'Description',
    }),
    
    // Type & Channel
    type: Field.select({
      label: 'Campaign Type',
      options: [
        { label: 'Email', value: 'email', default: true },
        { label: 'Webinar', value: 'webinar' },
        { label: 'Trade Show', value: 'trade_show' },
        { label: 'Conference', value: 'conference' },
        { label: 'Direct Mail', value: 'direct_mail' },
        { label: 'Social Media', value: 'social_media' },
        { label: 'Content Marketing', value: 'content' },
        { label: 'Partner Marketing', value: 'partner' },
      ]
    }),
    
    channel: Field.select({
      label: 'Primary Channel',
      options: [
        { label: 'Digital', value: 'digital' },
        { label: 'Social', value: 'social' },
        { label: 'Email', value: 'email' },
        { label: 'Events', value: 'events' },
        { label: 'Partner', value: 'partner' },
      ]
    }),
    
    // Status
    status: Field.select({
      label: 'Status',
      options: [
        { label: 'Planning', value: 'planning', color: '#999999', default: true },
        { label: 'In Progress', value: 'in_progress', color: '#FFA500' },
        { label: 'Completed', value: 'completed', color: '#00AA00' },
        { label: 'Aborted', value: 'aborted', color: '#FF0000' },
      ],
      required: true,
    }),
    
    // Dates
    start_date: Field.date({
      label: 'Start Date',
      required: true,
    }),
    
    end_date: Field.date({
      label: 'End Date',
      required: true,
    }),
    
    // Budget & ROI
    budgeted_cost: Field.currency({
      label: 'Budgeted Cost',
      scale: 2,
      min: 0,
    }),
    
    actual_cost: Field.currency({
      label: 'Actual Cost',
      scale: 2,
      min: 0,
    }),
    
    expected_revenue: Field.currency({
      label: 'Expected Revenue',
      scale: 2,
      min: 0,
    }),
    
    actual_revenue: Field.currency({
      label: 'Actual Revenue',
      scale: 2,
      min: 0,
      readonly: true,
    }),
    
    // Metrics
    target_size: Field.number({
      label: 'Target Size',
      description: 'Target number of leads/contacts',
      min: 0,
    }),
    
    num_sent: Field.number({
      label: 'Number Sent',
      min: 0,
      readonly: true,
    }),
    
    num_responses: Field.number({
      label: 'Number of Responses',
      min: 0,
      readonly: true,
    }),
    
    num_leads: Field.number({
      label: 'Number of Leads',
      min: 0,
      readonly: true,
    }),
    
    num_converted_leads: Field.number({
      label: 'Converted Leads',
      min: 0,
      readonly: true,
    }),
    
    num_opportunities: Field.number({
      label: 'Opportunities Created',
      min: 0,
      readonly: true,
    }),
    
    num_won_opportunities: Field.number({
      label: 'Won Opportunities',
      min: 0,
      readonly: true,
    }),
    
    // Calculated Metrics (Formula Fields)
    response_rate: Field.formula({
      label: 'Response Rate %',
      expression: F`coalesce(record.num_sent, 0) > 0 ? (coalesce(record.num_responses, 0) * 100.0) / record.num_sent : 0.0`,
      scale: 2,
    }),
    
    roi: Field.formula({
      label: 'ROI %',
      expression: F`coalesce(record.actual_cost, 0) > 0 ? ((coalesce(record.actual_revenue, 0) - record.actual_cost) * 100.0) / record.actual_cost : 0.0`,
      scale: 2,
    }),
    
    // Relationships
    parent_campaign: Field.lookup('campaign', {
      label: 'Parent Campaign',
      description: 'Parent campaign in hierarchy',
    }),
    
    owner: Field.lookup('user', {
      label: 'Campaign Owner',
    }),
    
    // Campaign Assets
    landing_page_url: Field.url({
      label: 'Landing Page',
    }),
    
    is_active: Field.boolean({
      label: 'Active',
      defaultValue: true,
    }),
  },
  
  // Database indexes
  indexes: [
    { fields: ['name'] },
    { fields: ['type'] },
    { fields: ['status'] },
    { fields: ['start_date'] },
    { fields: ['owner'] },
  ],
  
  // Enable advanced features
  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'search', 'export'],
    files: true,
    feeds: true,
    activities: true,
    trash: true,
    mru: true,
  },
  
  // Validation Rules
  validations: [
    {
      name: 'end_after_start',
      type: 'script',
      severity: 'error',
      message: 'End Date must be after Start Date',
      condition: P`record.end_date < record.start_date`,
    },
    {
      name: 'actual_cost_within_budget',
      type: 'script',
      severity: 'warning',
      message: 'Actual Cost exceeds Budgeted Cost',
      condition: P`record.actual_cost > record.budgeted_cost`,
    },
  ],
  
  // Workflow Rules
  workflows: [
    {
      name: 'campaign_completion_check',
      objectName: 'campaign',
      triggerType: 'scheduled',
      schedule: '0 2 * * *',
      criteria: P`record.end_date < today() && record.status == "in_progress"`,
      actions: [
        {
          name: 'mark_completed',
          type: 'field_update',
          field: 'status',
          value: '"completed"',
        }
      ],
      active: true,
    }
  ],
});
