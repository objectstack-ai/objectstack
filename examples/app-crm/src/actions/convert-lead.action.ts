// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineAction } from '@objectstack/spec/ui';

/**
 * Row-level action on crm_lead — launches the Convert Lead screen flow wizard.
 * Shown as a button in the lead list row menu and in the lead record header.
 */
export const ConvertLeadAction = defineAction({
  name: 'crm_convert_lead',
  label: 'Convert Lead',
  icon: 'ArrowRightCircle',
  objectName: 'crm_lead',
  type: 'flow',
  target: 'crm_convert_lead_wizard',
  locations: ['list_item', 'record_header', 'record_more'],
  recordIdParam: 'recordId',
  // Conditional visibility (CEL): hide the action once the lead is already
  // converted — so the button disappears rather than the user clicking it and
  // hitting the flow's "already converted" guard screen. The flow keeps that
  // guard as a server-side backstop.
  //
  // The `has()` half guards the SPARSE action face (#8990): this action reaches
  // `list_item`, where the bound record is the row the view's `$select`
  // projected. Without it, a lead list that does not project `status` aborts
  // the predicate at key resolution (`No such key: status`) and the button
  // silently vanishes for every row. `has()` alone is the guard because the
  // operand is compared by bare equality against a literal — see
  // `materializeDeclaredFields` in `@objectstack/objectql` for the full rule
  // and for when the `!= null` half becomes load-bearing.
  visible: 'has(record.status) && record.status != "converted"',
});
