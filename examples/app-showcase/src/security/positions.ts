// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Positions — the DISTRIBUTION layer of the ADR-0090 permission model.
 *
 * A position is a flat, job-shaped group (岗位): it answers "who gets which
 * permission sets" and nothing else. Deliberately NO hierarchy here — the
 * visibility tree is the business-unit tree (see `business-units` in
 * src/data/seed/), and the manager chain is `sys_user.manager_id`
 * (ADR-0090 D3; the old `parent` field on positions never existed at runtime).
 *
 * Two positions are BUILT-IN and never declared by an app: `everyone`
 * (implicitly held by every authenticated member — the tenant baseline,
 * ADR-0090 D5) and `guest` (implicitly held by anonymous visitors,
 * ADR-0090 D9). Packages target them by SUGGESTING bindings (`isDefault` on a
 * permission set), never by declaring or writing to them.
 */

import { definePosition } from '@objectstack/spec/identity';

/** Works tasks on their own projects — the rank-and-file position. */
export const ContributorPosition = definePosition({
  name: 'contributor',
  label: 'Contributor',
  description: 'Works tasks on their own projects.',
});

/** Runs a unit: depth-scoped visibility over the unit's private records. */
export const ManagerPosition = definePosition({
  name: 'manager',
  label: 'Project Manager',
  description: 'Manages projects and the contributors on them.',
});

/** Org-wide read for reporting — depth-based (`readScope: org`), not VAMA. */
export const ExecPosition = definePosition({
  name: 'exec',
  label: 'Executive',
  description: 'Read-all visibility for reporting.',
});

/** Compliance: View-All bypass (VAMA) — reads everything, changes nothing. */
export const AuditorPosition = definePosition({
  name: 'auditor',
  label: 'Auditor',
  description: 'Compliance read-only view across private records (viewAllRecords).',
});

/** Back-office: system permissions, Modify-All repairs, the Operations app. */
export const OpsPosition = definePosition({
  name: 'ops',
  label: 'Operations',
  description: 'Back-office operations — Setup access, announcement repairs, Operations app.',
});

/**
 * Delegated administrator of the Field Operations subtree (ADR-0090 D12).
 * The capability itself lives on the `showcase_field_ops_delegate` permission
 * set (`adminScope`); this position is just how an admin hands it out.
 */
export const FieldOpsDelegatePosition = definePosition({
  name: 'field_ops_delegate',
  label: 'Field Ops Delegate Admin',
  description: 'Scoped administration of the Field Operations business-unit subtree.',
});

/**
 * Client-facing coordinator (#9308 fixture 4). Reads projects to write the
 * client briefs they publish by share link — and is the app's demonstration
 * that a permission set can WITHHOLD a field's READ, not just its write: the
 * bound set masks the three budget figures outright.
 */
export const ClientLiaisonPosition = definePosition({
  name: 'client_liaison',
  label: 'Client Liaison',
  description: 'Prepares and publishes client-facing project briefs; cannot see internal budget figures.',
});

/**
 * External client audience — a position for external client principals.
 * External principals evaluate against each object's `externalSharingModel`
 * dial (ADR-0090 D11); this position is how the admin marks a user as
 * belonging to that audience.
 */
export const ClientPortalUserPosition = definePosition({
  name: 'client_portal_user',
  label: 'Client Portal User',
  description: 'External client admitted to the Client Portal.',
});

/**
 * Approval-routing positions (会签 / quorum demos). The `approval` flow nodes
 * in src/automation/flows route to `{ type: 'position', value: 'finance' | 'legal' }`
 * (Invoice Dual Sign-off → finance AND legal; High-Value Committee Quorum →
 * manager + finance + legal, 2-of-3). Without these declared — and without a
 * holder assigned (see src/security/seed-approval-demo.ts) — those requests
 * resolve to an empty approver slate and wait forever, so the marquee v16
 * approval features could not be demonstrated out of the box.
 *
 * They carry no permission-set binding: they exist purely to route approvals,
 * so a holder gets no extra data access from holding one.
 */
export const FinancePosition = definePosition({
  name: 'finance',
  label: 'Finance',
  description: 'Finance sign-off authority on invoices and high-value expenses (approval routing only).',
});

export const LegalPosition = definePosition({
  name: 'legal',
  label: 'Legal',
  description: 'Legal sign-off authority on invoices and high-value expenses (approval routing only).',
});

export const allPositions = [
  ContributorPosition,
  ManagerPosition,
  ExecPosition,
  AuditorPosition,
  OpsPosition,
  FieldOpsDelegatePosition,
  ClientLiaisonPosition,
  ClientPortalUserPosition,
  FinancePosition,
  LegalPosition,
];
