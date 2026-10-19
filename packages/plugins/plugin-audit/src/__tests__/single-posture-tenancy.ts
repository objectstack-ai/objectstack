// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `single` posture's Default Organization, for suites that boot the audit
 * writer without AuthPlugin.
 *
 * [ADR-0131 D9; ruling 6257510973 item 3, Q3 A] The activity mirror writes a
 * row only when an organization is derivable — the record's, the session's,
 * or the `tenancy` service's Default Organization under `single` — and never a
 * NULL one. A deployment's AuthPlugin registers that service; a suite that
 * boots ObjectQL and the audit writer alone has none, so with org-less records
 * and sessions it would model a wall and write no activity at all. These two
 * helpers give such a suite the composition it means: a `single` deployment.
 */

import type { Plugin } from '@objectstack/core';

/** The Default Organization these suites' activity rows carry. */
export const DEFAULT_ORGANIZATION_ID = 'org_default';

/** `AuditWriterOptions.getDefaultOrganizationId`, as AuditPlugin wires it under `single`. */
export const singlePostureDefaultOrganization = async (): Promise<string> => DEFAULT_ORGANIZATION_ID;

/** The `tenancy` service AuthPlugin registers under `single`, reduced to the one method the audit writer asks. */
export function singlePostureTenancy(): Plugin {
  return {
    name: 'test.single-posture-tenancy',
    async init(ctx) {
      ctx.registerService('tenancy', { defaultOrgId: singlePostureDefaultOrganization });
    },
  } as Plugin;
}
