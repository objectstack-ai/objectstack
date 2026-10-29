// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineCapability } from '@objectstack/spec';

/**
 * The Pipeline dashboard's audience (ADR-0066 three-way separation; the worked
 * example is `examples/app-showcase/src/security/capabilities.ts`).
 *
 *   • DEFINED here, and collected on the stack's `capabilities` array.
 *   • GRANTED by `crm_sales_user` (`systemPermissions`), the one CRM set that
 *     reads `crm_opportunity` — the object behind `opportunity_metrics`, which
 *     every Pipeline widget reads.
 *   • REQUIRED by `pipeline_dashboard` and by the `nav_pipeline_dashboard`
 *     entry, with the same list on both.
 *
 * Without the gate, a member with no sales set was offered Analytics →
 * Pipeline and then refused every tile. The server enforces both
 * declarations: the dashboard read by name answers `audience-permission`, and
 * the app's navigation drops the entry.
 *
 * `scope: 'org'` because the grant is the set's only system permission: a
 * capability no declaration carries, or one declared `platform`, would put
 * `crm_sales_user` outside the organization boundary, so an organization
 * administrator could no longer assign it.
 */
export const ViewPipelineCapability = defineCapability({
  name: 'crm.view_pipeline',
  label: 'View Sales Pipeline',
  description: 'Open the CRM Pipeline dashboard, whose widgets read the opportunity pipeline.',
  scope: 'org',
  packageId: 'com.example.crm',
});

export const allCapabilities = [ViewPipelineCapability];
