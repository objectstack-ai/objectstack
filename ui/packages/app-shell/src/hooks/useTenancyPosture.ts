/**
 * useTenancyPosture — the deployment's tenancy posture (framework ADR-0105 D1),
 * read from the public auth config's `features.tenancyPosture`.
 *
 * Under `group` posture the active organization is only the WRITE target —
 * reads span every organization the member belongs to (the server enforces
 * `organization_id IN accessible_org_ids`; the client never filters for
 * security). Components use this hook to key the group-only affordances:
 * write-context labeling on the org switcher, the create-form target-org
 * badge, and org attribution columns in default list views.
 *
 * Returns `undefined` until the config resolves, and stays `undefined` when
 * the server doesn't report a posture (older server) or reports an
 * unrecognized value — so every group affordance fails toward today's
 * rendering. The auth client caches the config fetch behind one promise, so
 * concurrent mounts share a single request.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@object-ui/auth';
import type { TenancyPosture } from '@object-ui/auth';

const POSTURES: readonly TenancyPosture[] = ['single', 'group', 'isolated'];

/**
 * The postures that put an organization wall in force — ADR-0105's
 * `postureEnforcesWall`, which is `true` for `group` and `isolated` and `false`
 * for `single`. This is what "organization context is active" means to the
 * console: under `single` the wall is inert, so an organization is not a scope
 * the user is inside and the chrome must not imply one.
 *
 * ## Why the rule is restated here instead of imported
 *
 * `@objectstack/spec/security` exports the predicate, and importing it would be
 * the drift-proof spelling — but measured with the repo's esbuild, adding that
 * subpath to a graph that already holds the whole spec root entry costs
 * **+237 KB** minified (1271.8 → 1509.1 KB): its schema modules are not shared
 * with the entries the console already reaches, and nothing tree-shakes them
 * (`@objectstack/spec` declares no `sideEffects`). The consumers here are the
 * top bar — the eager closure that `apps/console/vite.config.ts`'s
 * `assertLazyLinterStaysLazy` guard exists to keep lean — so a quarter megabyte
 * on every page load to spell one three-value predicate is the wrong trade.
 *
 * The drift risk that import would have removed is paid for at test time
 * instead: `__tests__/tenancyPostureWall.parity.test.ts` imports the spec's
 * real `postureEnforcesWall` and `TENANCY_POSTURES` and asserts this function
 * agrees for every posture the protocol declares — so a posture added or
 * reclassified upstream fails CI here rather than silently rendering the wrong
 * chrome. Tests are not bundled; that assertion is free.
 */
export function postureHasOrgWall(posture: TenancyPosture | undefined): boolean {
  return posture === 'group' || posture === 'isolated';
}

export function useTenancyPosture(): TenancyPosture | undefined {
  const { getAuthConfig } = useAuth();
  const [posture, setPosture] = useState<TenancyPosture | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getAuthConfig?.()
      .then((cfg) => {
        if (cancelled) return;
        const reported = cfg?.features?.tenancyPosture;
        if (reported && (POSTURES as readonly string[]).includes(reported)) {
          setPosture(reported);
        }
      })
      .catch(() => {
        /* config unavailable — leave undefined, group affordances stay off */
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

  return posture;
}
