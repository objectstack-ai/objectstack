import { P } from '@objectstack/spec';
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Product Object
 * Represents products/services offered by the company
 */
export const Product = ObjectSchema.create({
  name: 'product',
  label: 'Product',
  pluralLabel: 'Products',
  icon: 'box',
  description: 'Products and services offered by the company',
  titleFormat: '{product_code} - {name}',
  compactLayout: ['product_code', 'name', 'category', 'is_active'],

  // Product detail pages are catalog-style — users edit attributes in
  // place, they don't browse lateral relationships. Suppress the
  // Reference Rail so the single-column form gets full width.
  detail: {
    hideReferenceRail: true,
  },

  fieldGroups: [
    { key: 'basic',    label: 'Product Information', icon: 'info' },
    { key: 'pricing',  label: 'Pricing & Billing',   icon: 'dollar-sign' },
    { key: 'metadata', label: 'Resources',           icon: 'link', defaultExpanded: false },
  ],

  fields: {
    // AutoNumber field - Unique product identifier
    product_code: Field.autonumber({
      label: 'Product Code',
      format: 'PRD-{0000}',
    }),
    
    // Basic Information
    name: Field.text({ 
      label: 'Product Name', 
      required: true, 
      searchable: true,
      maxLength: 255,
    }),
    
    description: Field.markdown({
      label: 'Description',
    }),
    
    // Categorization
    category: Field.select({
      label: 'Category',
      options: [
        { label: 'Software', value: 'software', default: true },
        { label: 'Hardware', value: 'hardware' },
        { label: 'Service', value: 'service' },
        { label: 'Subscription', value: 'subscription' },
        { label: 'Support', value: 'support' },
      ]
    }),
    
    family: Field.select({
      label: 'Product Family',
      options: [
        { label: 'Enterprise Solutions', value: 'enterprise' },
        { label: 'SMB Solutions', value: 'smb' },
        { label: 'Professional Services', value: 'services' },
        { label: 'Cloud Services', value: 'cloud' },
      ]
    }),
    
    // Pricing
    list_price: Field.currency({
      label: 'List Price',
      scale: 2,
      min: 0,
      required: true,
    }),
    
    cost: Field.currency({
      label: 'Cost',
      scale: 2,
      min: 0,
    }),
    
    // SKU and Inventory
    sku: Field.text({
      label: 'SKU',
      maxLength: 50,
      unique: true,
    }),
    
    quantity_on_hand: Field.number({
      label: 'Quantity on Hand',
      min: 0,
      defaultValue: 0,
    }),
    
    reorder_point: Field.number({
      label: 'Reorder Point',
      min: 0,
    }),
    
    // Status
    is_active: Field.boolean({
      label: 'Active',
      defaultValue: true,
    }),
    
    is_taxable: Field.boolean({
      label: 'Taxable',
      defaultValue: true,
    }),
    
    // Relationships
    product_manager: Field.lookup('user', {
      label: 'Product Manager',
    }),
    
    // Images and Assets
    image: Field.image({
      label: 'Product Image',
    }),

    datasheet: Field.file({
      label: 'Datasheet',
    }),

    // Tax & billing
    tax_rate: Field.percent({
      label: 'Default Tax Rate %',
      scale: 2,
      min: 0,
      max: 100,
      defaultValue: 0,
    }),

    billing_type: Field.select({
      label: 'Billing Type',
      options: [
        { label: 'One-Time',  value: 'one_time', default: true },
        { label: 'Monthly',   value: 'monthly' },
        { label: 'Quarterly', value: 'quarterly' },
        { label: 'Annual',    value: 'annual' },
        { label: 'Usage',     value: 'usage' },
      ],
    }),

    unit_of_measure: Field.select({
      label: 'Unit of Measure',
      options: [
        { label: 'Each',       value: 'each', default: true },
        { label: 'License',    value: 'license' },
        { label: 'Seat',       value: 'seat' },
        { label: 'Hour',       value: 'hour' },
        { label: 'Day',        value: 'day' },
        { label: 'Month',      value: 'month' },
      ],
    }),
  },
  
  // Database indexes
  indexes: [
    { fields: ['name'] },
    { fields: ['sku'], unique: true },
    { fields: ['category'] },
    { fields: ['is_active'] },
  ],
  
  // Enable advanced features
  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'search'],
    files: true,
    feeds: true,
    trash: true,
    mru: true,
  },
  
  // Validation Rules
  validations: [
    {
      name: 'price_positive',
      type: 'script',
      severity: 'error',
      message: 'List Price must be positive',
      condition: P`record.list_price < 0`,
    },
    {
      name: 'cost_less_than_price',
      type: 'script',
      severity: 'warning',
      message: 'Cost should be less than List Price',
      condition: P`record.cost >= record.list_price`,
    },
  ],
});
