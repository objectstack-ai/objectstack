// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ensureDefaultOrganization — the walled-posture default-org bootstrap with the
 * per-org seed-ownership handoff (`claimOrgSeedOwnership`) injected.
 *
 * The helper itself lives in `@objectstack/plugin-auth` (cloud ADR-0081 D1).
 * `OrganizationsPlugin` no longer calls this wrapper: it calls plugin-auth's
 * `createEnsureDefaultOrganizationOnce` with the same handoff injected, which
 * decides the owner bind once (ADR-0093 D7). This wrapper is kept for
 * existing importers only.
 */

import {
  ensureDefaultOrganization as ensureDefaultOrganizationBase,
  type EnsureDefaultOrganizationResult,
} from '@objectstack/plugin-auth';
import { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';

interface EnsureOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
}

export type { EnsureDefaultOrganizationResult };

/**
 * Ensure the platform admin has a Default Organization to operate in,
 * then hand the org's seeded rows to them. Idempotent (stable slug
 * `default` + the admin's existing memberships short-circuit).
 *
 * [#23354] The handoff re-owns only rows the org's seed replay reported
 * landing on, read from the kernel's `seed-settlement` service. This wrapper
 * holds no kernel, so it has no such reading and hands over no row: an
 * unowned row it cannot name as seeded keeps no owner (ADR-0138 D1).
 * `OrganizationsPlugin` binds the reading for the gated bootstrap below.
 *
 * @deprecated Use `createEnsureDefaultOrganizationOnce({ claimSeedOwnership:
 * claimOrgSeedOwnership })` from `@objectstack/plugin-auth`. Called directly,
 * this re-binds an owner whose membership was removed and re-runs the seed
 * handoff on every call; the gated factory decides the bind once
 * (ADR-0093 D7).
 */
export async function ensureDefaultOrganization(
  ql: any,
  options: EnsureOptions = {},
): Promise<EnsureDefaultOrganizationResult> {
  return ensureDefaultOrganizationBase(ql, {
    ...options,
    claimSeedOwnership: claimOrgSeedOwnership,
  });
}
