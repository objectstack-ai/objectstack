import { P } from '@objectstack/spec';
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Account = ObjectSchema.create({
  name: 'account',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'building',
  description: 'Companies and organizations doing business with us',
  titleFormat: '{account_number} - {name}',
  compactLayout: ['account_number', 'name', 'type', 'owner'],

  // Field groups organize the form layout. Array order == display order.
  // Each field below opts in via `group: '<key>'`.
  fieldGroups: [
    { key: 'basic',        label: 'Basic Information',  icon: 'building' },
    { key: 'financials',   label: 'Financials',         icon: 'dollar-sign' },
    { key: 'contact_info', label: 'Contact Information', icon: 'phone' },
    { key: 'ownership',    label: 'Ownership & Status', icon: 'users' },
    { key: 'branding',     label: 'Branding',           icon: 'palette', defaultExpanded: false },
    { key: 'system',       label: 'System',             icon: 'settings', defaultExpanded: false },
  ],

  fields: {
    // AutoNumber field - Unique account identifier
    account_number: Field.autonumber({
      label: 'Account Number',
      format: 'ACC-{000000}',
      group: 'basic',
    }),

    // Basic Information
    name: Field.text({
      label: 'Account Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'basic',
    }),

    // Select fields with custom options
    type: Field.select({
      label: 'Account Type',
      group: 'basic',
      options: [
        { label: 'Prospect', value: 'prospect', color: '#FFA500', default: true },
        { label: 'Customer', value: 'customer', color: '#00AA00' },
        { label: 'Partner', value: 'partner', color: '#0000FF' },
        { label: 'Former Customer', value: 'former', color: '#999999' },
      ]
    }),

    industry: Field.select({
      label: 'Industry',
      group: 'basic',
      options: [
        { label: 'Technology', value: 'technology' },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
        { label: 'Retail', value: 'retail' },
        { label: 'Manufacturing', value: 'manufacturing' },
        { label: 'Education', value: 'education' },
      ]
    }),

    description: Field.markdown({
      label: 'Description',
      group: 'basic',
    }),

    // Number fields
    annual_revenue: Field.currency({
      label: 'Annual Revenue',
      scale: 2,
      min: 0,
      group: 'financials',
    }),

    number_of_employees: Field.number({
      label: 'Employees',
      min: 0,
      group: 'financials',
    }),

    // Contact Information
    phone: Field.text({
      label: 'Phone',
      format: 'phone',
      group: 'contact_info',
    }),

    website: Field.url({
      label: 'Website',
      group: 'contact_info',
    }),

    // Structured Address field (new field type)
    billing_address: Field.address({
      label: 'Billing Address',
      addressFormat: 'international',
      group: 'contact_info',
    }),

    // Office Location (new field type)
    office_location: Field.location({
      label: 'Office Location',
      displayMap: true,
      allowGeocoding: true,
      group: 'contact_info',
    }),

    // Relationship fields
    owner: Field.lookup('user', {
      label: 'Account Owner',
      group: 'ownership',
    }),

    parent_account: Field.lookup('account', {
      label: 'Parent Account',
      description: 'Parent company in hierarchy',
      group: 'ownership',
    }),

    // Boolean field
    is_active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'ownership',
    }),

    // Brand color (new field type)
    brand_color: Field.color({
      label: 'Brand Color',
      colorFormat: 'hex',
      presetColors: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'],
      group: 'branding',
    }),

    // Company logo (uploaded image)
    logo: Field.image({
      label: 'Company Logo',
      group: 'branding',
    }),

    // Date field
    last_activity_date: Field.date({
      label: 'Last Activity Date',
      readonly: true,
      group: 'system',
    }),

    // ─── Customer Success / Account Health ────────────────────────────
    tier: Field.select({
      label: 'Customer Tier',
      group: 'ownership',
      options: [
        { label: 'Strategic',  value: 'strategic',  color: '#7C3AED' },
        { label: 'Enterprise', value: 'enterprise', color: '#4169E1' },
        { label: 'Mid-Market', value: 'mid_market', color: '#00AA00' },
        { label: 'SMB',        value: 'smb',        color: '#FFA500', default: true },
      ],
    }),

    segment: Field.select({
      label: 'Segment',
      group: 'ownership',
      options: [
        { label: 'Net New',    value: 'net_new' },
        { label: 'Growth',     value: 'growth' },
        { label: 'At Risk',    value: 'at_risk' },
        { label: 'Stable',     value: 'stable' },
      ],
    }),

    health_score: Field.select({
      label: 'Health Score',
      group: 'ownership',
      description: 'CSM-maintained health indicator',
      options: [
        { label: 'Healthy',    value: 'healthy',    color: '#00AA00' },
        { label: 'Watching',   value: 'watching',   color: '#FFA500' },
        { label: 'At Risk',    value: 'at_risk',    color: '#FF4500' },
        { label: 'Churning',   value: 'churning',   color: '#FF0000' },
      ],
    }),

    renewal_owner: Field.lookup('user', {
      label: 'Renewal Owner (CSM)',
      group: 'ownership',
    }),

    next_renewal_date: Field.date({
      label: 'Next Renewal Date',
      group: 'ownership',
    }),
  },
  
  // Database indexes for performance
  indexes: [
    { fields: ['name'] },
    { fields: ['owner'] },
    { fields: ['type', 'is_active'] },
  ],
  
  // Enable advanced features
  enable: {
    trackHistory: true,     // Track field changes
    searchable: true,       // Include in global search
    apiEnabled: true,       // Expose via REST/GraphQL
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'search', 'export'], // Whitelist allowed API operations
    files: true,            // Allow file attachments
    feeds: true,            // Enable activity feed/chatter (Chatter-like)
    activities: true,       // Enable tasks and events tracking
    trash: true,            // Recycle bin support
    mru: true,              // Track Most Recently Used
  },
  
  // Validation Rules
  validations: [
    {
      name: 'revenue_positive',
      type: 'script',
      severity: 'error',
      message: 'Annual Revenue must be positive',
      condition: P`record.annual_revenue < 0`,
    },
    {
      name: 'account_name_unique',
      type: 'unique',
      severity: 'error',
      message: 'Account name must be unique',
      fields: ['name'],
      caseSensitive: false,
    },
  ],
  
  // Workflow Rules
  workflows: [
    {
      name: 'update_last_activity',
      objectName: 'account',
      triggerType: 'on_update',
      criteria: P`record.owner != previous.owner || record.type != previous.type`,
      actions: [
        {
          name: 'set_activity_date',
          type: 'field_update',
          field: 'last_activity_date',
          value: 'TODAY()',
        }
      ],
      active: true,
    }
  ],
});