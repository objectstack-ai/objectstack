/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Does an organization still have environments that reference its slug?
 * (objectui#11720)
 *
 * ## Why the settings page asks
 *
 * The organization settings form saves through better-auth's
 * `POST /organization/update`. The framework guards that door
 * (`beforeUpdateOrganization` in plugin-auth's `auth-manager.ts`): a NEW slug
 * is refused with `403` while any `sys_environment` row of the organization is
 * neither `archived` nor `failed`. On a cloud control plane every organization
 * is born with a production environment, so from framework 17.7.0 on every
 * owner's slug edit on that form was refused. The refusal is right: renaming a
 * cloud slug moves every environment's subdomain, which only cloud's own
 * orchestrated rename does, never this door.
 *
 * So the form stops offering the edit exactly when the guard would refuse it,
 * and this module answers the guard's own question, from the guard's own
 * input: the organization's `sys_environment` rows, counted the way the guard
 * counts them.
 *
 * ## The three answers, and which one locks the field
 *
 * - `present`: at least one row whose `status` is not a retired one. Only this
 *   answer locks the field, because only this answer is evidence.
 * - `none`: the read answered and no row counts.
 * - `unknown`: the read did not answer in the declared shape (a non-2xx, a
 *   network failure, a body outside the envelope). The field stays editable
 *   and the server keeps deciding, which is the guard's own posture: it lets
 *   the update through when its environment read fails.
 *
 * ## A single-environment runtime is not asked
 *
 * A runtime whose config serves `singleEnvironment: true` (the CLI's
 * `os serve` / `objectstack dev` arm serves it through
 * `Serve.RUNTIME_CONFIG_OPTIONS`) has no `sys_environment` object to read:
 * `@objectstack/spec` lists that object in `CLOUD_PROVIDED_OBJECT_NAMES`,
 * "contributed by the CLOUD runtime ... They do not exist in a
 * single-environment OSS runtime", and nothing in the framework defines it. The
 * guard's own read cannot count a row there either. So this module answers
 * `unknown` there WITHOUT a request: the answer the read would have given, with
 * the request bound to fail removed (objectui#7476's rule).
 *
 * ⚠️ Every other runtime with no `sys_environment` object (a multi-environment
 * host that is not a cloud control plane) still answers the read with an
 * error, once per owner visit to the settings page. That request is the
 * remaining cost: no served signal says "this host has no environment
 * registry", and the organization pages render outside the console's data
 * layer, so the metadata registry that could say "this deployment has no such
 * object" is not available here (see `useObjectPresence`). The answer is
 * `unknown`, and the page behaves exactly as it did before this module existed.
 *
 * ## The wire, read in one dialect
 *
 * `GET /api/v1/data/sys_environment` with the canonical `filter` and `select`
 * transport params (`HttpFindQueryParamsSchema` in `@objectstack/spec`). The
 * framework's data domain answers a list with
 * `{ success: true, data: { object, records, total?, hasMore? } }`
 * (`FindDataResponseSchema` inside the dispatcher's success envelope). Only
 * that shape is read; a bare body is a producer contract violation and reads
 * as `unknown`, never as a second accepted dialect (AGENTS.md #0.1).
 *
 * Module-private: nothing outside the organization pages imports it.
 */

import { createAuthenticatedFetch } from '@object-ui/auth';
import { getRuntimeConfig } from '../../../runtime-config.js';

/** What the read can say about the organization's environments. */
export type OrgEnvironmentPresence = 'present' | 'none' | 'unknown';

/**
 * The statuses the framework guard does not count. Mirrors the predicate in
 * `beforeUpdateOrganization`, which is the authority this module follows; the
 * environment list's `useEnvironmentEntitlements` mirrors the same pair.
 */
const RETIRED_ENVIRONMENT_STATUSES: ReadonlySet<string> = new Set(['archived', 'failed']);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Read whether `organizationId` has an environment the slug guard counts.
 *
 * Never rejects: every failure resolves to `unknown`. On a single-environment
 * runtime it answers `unknown` without a request (see the module header).
 */
export async function readOrgEnvironmentPresence(
  organizationId: string,
  fetchImpl: FetchLike = createAuthenticatedFetch(),
): Promise<OrgEnvironmentPresence> {
  if (getRuntimeConfig().singleEnvironment === true) return 'unknown';
  const base = ((import.meta.env.VITE_SERVER_URL as string | undefined) || '').replace(/\/+$/, '');
  const params = new URLSearchParams({
    filter: JSON.stringify({ organization_id: organizationId }),
    select: 'status',
  });
  try {
    const res = await fetchImpl(`${base}/api/v1/data/sys_environment?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 'unknown';
    const body = (await res.json().catch(() => null)) as
      | { success?: unknown; data?: { records?: unknown } }
      | null;
    if (!body || body.success !== true) return 'unknown';
    const records = body.data?.records;
    if (!Array.isArray(records)) return 'unknown';
    const counted = records.some((row) => {
      const status = (row as { status?: unknown } | null)?.status;
      // A row without a status counts, as it does in the guard.
      return !RETIRED_ENVIRONMENT_STATUSES.has(typeof status === 'string' ? status : '');
    });
    return counted ? 'present' : 'none';
  } catch {
    return 'unknown';
  }
}
