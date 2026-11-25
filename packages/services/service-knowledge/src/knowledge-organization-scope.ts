// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K8, item 9] The organization half of a knowledge document and of a
 * search: which organization a document assembled from a record belongs to,
 * and which organizations a caller's search hands the adapter
 * (`AdapterSearchOptions.organizationIds`).
 *
 * Neither is re-derived here. The posture is the deployment's EFFECTIVE one,
 * classified by `classifyAdmissionTenancyPosture` (`@objectstack/core`) from
 * the kernel's `tenancy` service — the reading the wall itself is handed, never
 * `OS_TENANCY_POSTURE` (ADR-0093 D4/D5). The caller's organizations are the
 * Layer 0 verdict `computeTenantLayer0Verdict` (`@objectstack/core`, ADR-0131
 * D8) answers for the source's object, over the organizations the execution
 * context carries (`tenantId`, `accessible_org_ids`, resolved by
 * `resolveAuthzContext`). So the ranking scope an adapter is handed is the
 * same organization set the wall gives the caller's own read of that object
 * (ADR-0105 D1: `isolated` → the active organization; `group` → every
 * organization the caller holds a membership in).
 *
 * The filter is a ranking scope only. The access decision stays the service's
 * re-read of every object-source hit as the caller (K8, item 9; ADR-0090 D10).
 */

import {
  computeTenantLayer0Verdict,
  isOutsideEveryOrganization,
  organizationIdOf,
} from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isTenancyDisabled } from '@objectstack/spec/data';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { declaredFields } from './knowledge-source-admission.js';

/**
 * How the service reads the deployment's effective tenancy posture: the
 * posture, `undefined` for a composition with no `tenancy` service (no wall
 * exists there, so it reads as `single`), and a throw for a `tenancy` service
 * that is registered but cannot be read. `KnowledgeServicePlugin` passes
 * `classifyAdmissionTenancyPosture` over the kernel's `tenancy` service.
 */
export type KnowledgeTenancyPostureResolver = () => Promise<TenancyPosture | undefined>;

/**
 * The organization of a document assembled from `record` (K8, item 9): the
 * record's `organization_id` under a walled posture (`group`, `isolated`), and
 * `undefined` under `single` (or no posture) and for a record that carries
 * none.
 */
export function documentOrganizationId(
  record: Record<string, unknown>,
  posture: TenancyPosture | undefined,
): string | undefined {
  if (posture === undefined || !postureEnforcesWall(posture)) return undefined;
  return organizationIdOf(record.organization_id) ?? undefined;
}

/**
 * The organizations a search of an `object` source over an object with
 * definition `schema` hands the adapter, for a caller with context `ctx`
 * (K8, item 9):
 *
 * - `undefined` — no filter: the `single` posture (or no posture), the system
 *   identity, and an object the wall does not scope (tenancy disabled, or no
 *   `organization_id` column), whose documents carry no organization.
 * - the active organization (`isolated`) or the deduplicated membership set
 *   (`group`), as the Layer 0 verdict names them;
 * - `[]` — the wall denies: no active organization under `isolated`, an empty
 *   membership set under `group`. Ranks nothing; never "no filter".
 *
 * An object whose definition the engine cannot give is read as one the wall
 * scopes (the wall's own fail-toward-isolation default).
 */
export function searchOrganizationIds(
  ctx: ExecutionContext,
  posture: TenancyPosture | undefined,
  schema: unknown,
): string[] | undefined {
  if (ctx.isSystem) return undefined;
  if (posture === undefined || !postureEnforcesWall(posture)) return undefined;
  const fields = declaredFields(schema);
  const verdict = computeTenantLayer0Verdict({
    tenancyPosture: posture,
    organizationId: ctx.tenantId,
    accessibleOrgIds: ctx.accessible_org_ids,
    outsideEveryOrganization: isOutsideEveryOrganization(ctx),
    objectHasOrgIdField: fields === undefined ? undefined : fields.some(([name]) => name === 'organization_id'),
    externalOrganizationScopeUndeclared: false,
    tenancyDisabled:
      isTenancyDisabled(schema)
      || (schema as { systemFields?: { tenant?: unknown } } | null | undefined)?.systemFields?.tenant === false,
    posturePermitsCrossTenant: false,
    isPlatformAdmin: false,
  });
  switch (verdict.kind) {
    case 'none':
      return undefined;
    case 'deny':
      return [];
    case 'organization':
      return [verdict.organizationId];
    case 'organizations':
      return [...verdict.organizationIds];
  }
}
