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

export const allPositions = [
  ContributorPosition,
  ManagerPosition,
  ExecPosition,
  AuditorPosition,
  OpsPosition,
  FieldOpsDelegatePosition,
];
