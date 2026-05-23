// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';

/**
 * Quote Line Item
 *
 * Individual line on a Quote. Quotes generated from an Opportunity typically
 * clone its OpportunityLineItems into QuoteLineItems so pricing can diverge
 * after the quote is sent without affecting the underlying opportunity.
 */
export const QuoteLineItem = ObjectSchema.create({
  name: 'quote_line_item',
  label: 'Quote Line Item',
  pluralLabel: 'Quote Line Items',
  icon: 'package',
  description: 'A single product line on a Quote',

  trackHistory: true,
  shareModel: 'controlled-by-parent',

  compactLayout: ['product', 'quantity', 'unit_price', 'total_price'],

  fields: {
    quote: Field.lookup('quote', {
      label: 'Quote',
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
    }),

    unit_price: Field.currency({
      label: 'Sales Price',
      required: true,
    }),

    discount: Field.percent({
      label: 'Discount %',
      scale: 2,
      min: 0,
      max: 100,
      defaultValue: 0,
    }),

    subtotal: Field.formula({
      label: 'Subtotal',
      expression: P`record.quantity * record.unit_price * (1 - record.discount / 100)`,
    }),

    tax_rate: Field.percent({
      label: 'Tax Rate %',
      scale: 2,
      min: 0,
      max: 100,
      defaultValue: 0,
    }),

    total_price: Field.formula({
      label: 'Total',
      expression: P`record.subtotal * (1 + record.tax_rate / 100)`,
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
