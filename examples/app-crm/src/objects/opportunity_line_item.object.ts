// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';

/**
 * Opportunity Line Item
 *
 * Individual product/service entry on an Opportunity. Together, all line items
 * roll up to the Opportunity amount. Required for any realistic sales process
 * where the deal value comes from a configured set of products rather than
 * a single typed-in total.
 */
export const OpportunityLineItem = ObjectSchema.create({
  name: 'opportunity_line_item',
  label: 'Opportunity Line Item',
  pluralLabel: 'Opportunity Line Items',
  icon: 'package',
  description: 'A single product line on an Opportunity',

  trackHistory: true,
  shareModel: 'controlled-by-parent',

  compactLayout: ['product', 'quantity', 'unit_price', 'total_price'],

  fields: {
    opportunity: Field.lookup('opportunity', {
      label: 'Opportunity',
      required: true,
    }),

    product: Field.lookup('product', {
      label: 'Product',
      required: true,
    }),

    description: Field.text({
      label: 'Description',
      maxLength: 500,
    }),

    quantity: Field.number({
      label: 'Quantity',
      required: true,
      scale: 2,
      min: 0,
      defaultValue: 1,
    }),

    list_price: Field.currency({
      label: 'List Price',
      readonly: true,
      description: 'Auto-populated from product.list_price',
    }),

    unit_price: Field.currency({
      label: 'Sales Price',
      required: true,
      description: 'Negotiated unit price (may differ from list price)',
    }),

    discount: Field.percent({
      label: 'Discount %',
      scale: 2,
      min: 0,
      max: 100,
      defaultValue: 0,
    }),

    total_price: Field.formula({
      label: 'Total',
      expression: P`record.quantity * record.unit_price * (1 - record.discount / 100)`,
    }),

    line_number: Field.number({
      label: 'Line #',
      scale: 0,
      readonly: true,
    }),
  },

  validations: [
    {
      name: 'unit_price_positive',
      type: 'script',
      severity: 'error',
      message: 'Sales price cannot be negative',
      condition: P`record.unit_price < 0`,
    },
  ],
});
