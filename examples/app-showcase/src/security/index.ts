// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Security domain — the ADR-0090 Permission Model v2, end to end.
 *
 * Five concepts, one file each concern:
 *   • positions.ts        — flat distribution groups (who gets which sets)
 *   • permission-sets.ts  — capability (CRUD, FLS, RLS, depth, VAMA, system
 *                           permissions, tabs, everyone-suggestion, guest
 *                           capability, delegated-admin scope)
 *   • sharing-rules.ts    — record widening (criteria + BU-subtree recipients)
 *
 * The other two concepts live elsewhere by design: the OWD baseline
 * (`sharingModel` / `externalSharingModel`) is declared per-object in
 * src/data/objects/, and the business-unit tree is DATA (environment-owned,
 * seeded in src/data/seed/ as `sys_business_unit` rows), not metadata.
 *
 * The committed `access-matrix.json` next to objectstack.config.ts is the
 * ADR-0090 D6 snapshot gate: `objectstack compile` derives the
 * (permission set × object) matrix from these declarations and fails the
 * build on drift until the snapshot is regenerated with
 * `--update-access-matrix` — the snapshot's git diff is the review artifact.
 */

export {
  ContributorPosition,
  ManagerPosition,
  ExecPosition,
  AuditorPosition,
  OpsPosition,
  FieldOpsDelegatePosition,
  allPositions,
} from './positions.js';

export {
  ContributorPermissionSet,
  ManagerPermissionSet,
  ExecutivePermissionSet,
  AuditorPermissionSet,
  OpsPermissionSet,
  MemberDefaultPermissionSet,
  GuestPortalPermissionSet,
  FieldOpsDelegatePermissionSet,
  allPermissionSets,
} from './permission-sets.js';

export {
  RedProjectSharingRule,
  HighValueRedProjectRule,
  NewInquiryFieldOpsRule,
  ContributorTaskSharingRule,
  allSharingRules,
} from './sharing-rules.js';
