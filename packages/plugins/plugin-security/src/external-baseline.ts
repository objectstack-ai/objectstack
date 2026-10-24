// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling of record 6355206139, letter B] The human baseline a context
 * resolves, named in one place for the three readers that must agree on it:
 * the data plane's permission-set resolution
 * (`security-plugin-permission-sets.ts`), the explainer's grant attribution
 * (`explain-engine.ts`), and the metadata plane's describe fallback
 * (`SecurityPlugin#resolveFallbackPermissionSets`).
 *
 * An EXTERNAL member — a holder of `org_external`, the projection of
 * `sys_member.role = external` — is not handed the deployment's member
 * baseline (`member_default`, an app's `isDefault` set). Its baseline is
 * `external_default`: its own identity rows, and data only through explicit
 * grants. Every other human gets the configured, composed baseline. An agent's
 * ceiling is decided by its caller, never here.
 */

import { BUILTIN_IDENTITY_ORG_EXTERNAL } from '@objectstack/spec';
import { EXTERNAL_DEFAULT_PERMISSION_SET } from './objects/default-permission-sets.js';

/** Does a principal holding `positions` belong to the organization's external population? */
export function holdsExternalPosition(positions: unknown): boolean {
  return Array.isArray(positions) && positions.includes(BUILTIN_IDENTITY_ORG_EXTERNAL);
}

/**
 * The baseline set names a HUMAN holding `positions` resolves: `[external_default]`
 * for an external, `configured` (the composed `security.baselinePermissionSets`)
 * for everyone else.
 */
export function humanBaselineFor(positions: unknown, configured: readonly string[]): string[] {
  return holdsExternalPosition(positions) ? [EXTERNAL_DEFAULT_PERMISSION_SET] : [...configured];
}
