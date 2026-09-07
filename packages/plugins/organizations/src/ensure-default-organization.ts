// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ensureDefaultOrganization — multi-org flavour of the default-org bootstrap.
 *
 * The helper itself moved to `@objectstack/plugin-auth` (ADR-0081 D1: the
 * open member-management basics own it — single-org mode runs it too, from
 * AuthPlugin). This wrapper keeps the multi-org semantics this plugin always
 * had by injecting the per-org seed-ownership handoff step
 * (`claimOrgSeedOwnership`), which belongs to the org seed pipeline here,
 * not to the basics.
 *
 * See the plugin-auth helper for the full strategy documentation.
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
