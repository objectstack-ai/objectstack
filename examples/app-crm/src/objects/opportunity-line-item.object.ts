// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';

/**
 * Opportunity Line Item — the product/quantity detail rows of an Opportunity.
 *
 * This is the canonical master-detail "header + line items" shape (mirrors the
 * showcase Invoice ↔ InvoiceLine pair): an opportunity is quoted together with
 * the products on it, entered in ONE atomic transaction. So the back-pointer
 * `opportunity` field declares `inlineEdit: 'grid'` — every standard New/Edit
 * Opportunity form (and the lead-conversion wizard's Opportunity step) renders
 * an editable line-item grid, and the parent `Opportunity.line_total` rolls the
 * line amounts up server-side.
 */
export const OpportunityLineItem = ObjectSchema.create({
  name: 'crm_opportunity_line_item',
  // [ADR-0090 D1/D4] Master-detail child: record access follows the parent
  // opportunity (the D7 publish linter requires the baseline to be declared).
  sharingModel: 'controlled_by_parent',
  label: 'Line Item',
  pluralLabel: 'Line Items',
  icon: 'list',
  description: 'A single product line on an opportunity quote.',

  fields: {
    opportunity: Field.masterDetail('crm_opportunity', {
      label: 'Opportunity',
      required: true,
      deleteBehavior: 'cascade',
      // Thin, high-volume product rows → the editable grid form factor.
      inlineEdit: 'grid',
      inlineTitle: 'Products',
      inlineAmountField: 'amount',
    }),
    product: Field.text({
      label: 'Product',
      required: true,
      maxLength: 200,
    }),
    quantity: Field.number({
      label: 'Qty',
      required: true,
      min: 1,
      defaultValue: 1,
    }),
    unit_price: Field.currency({
      label: 'Unit Price',
      min: 0,
    }),
    // Amount = Qty × Unit Price. Kept as a *stored* currency column (so the
    // parent Opportunity.line_total summary can roll it up — summary aggregation
    // reads stored columns, not on-read formula fields), but the `expression`
    // makes the line-item grid render it READ-ONLY and recompute it live
    // client-side as quantity/unit_price change, then persist the computed
    // value. The server stores the client-sent value as-is. (Mirrors the
    // showcase InvoiceLine.amount pattern.)
    amount: Field.currency({
      label: 'Amount',
      min: 0,
      expression: cel`record.quantity * record.unit_price`,
    }),
  },
});
