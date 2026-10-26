/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { AuthOrganization } from '@object-ui/auth';

/**
 * The ONE projection of the active organization onto an action context's
 * spec-declared `org` key (objectui#10918).
 *
 * `@objectstack/spec` (`ui/action.zod.ts`) declares `${ctx.org.id}` in an
 * action `target` and lists the interpolation scope as `ctx.user.*`,
 * `ctx.org.*`, `ctx.recordId` and `ctx.selection`.
 * `ActionRunner.buildInterpolationContext` builds that `org` from the context
 * it is handed, so every console surface that mounts its own `ActionProvider`
 * has to put the organization there:
 *
 * - `hooks/useConsoleActionRuntime.tsx`, the shared runtime (the console's root
 *   provider, object views, SDUI pages and declared action bars);
 * - `views/RecordDetailView.tsx`, the record page's own provider.
 *
 * Both call this helper, so the two cannot drift into two shapes. It carries
 * the identity fields the platform's `OrganizationSchema` names (`id`, `slug`,
 * `name`), or `null` when no organization is active. `${ctx.org.id}` then
 * interpolates to an empty string, never a literal `null`.
 */
export function actionContextOrg(org: AuthOrganization | null | undefined) {
  return org ? { id: org.id, slug: org.slug, name: org.name } : null;
}
