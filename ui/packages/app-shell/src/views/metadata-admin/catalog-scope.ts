// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ENVIRONMENT scope of the metadata-admin pages — the Setup catalog
 * (objectui#7611, objectstack ADR-0131 D3/D7).
 *
 * ## Why a scope and not a page family
 *
 * ADR-0131 D3 gives positions and permission sets one home, the environment
 * registry, and D7 says the Setup pages list that registry. The ruling that
 * unblocked objectui#7611 says how: "Build it by reuse, not by new pages" — the
 * Setup catalog pages are the console's existing metadata-admin list and
 * editors, re-routed and re-gated for Setup. So the catalog is the same
 * `…/metadata/:type` route with one URL parameter, `scope=environment`:
 *
 *   - the LIST stops scoping to one project package (the Studio rule, under
 *     which a platform-shipped set such as `admin_full_access` is never
 *     listed) and lists every item the registry serves for the type, with its
 *     provenance;
 *   - the EDITORS add the Setup half beside the definition: who holds a
 *     permission set, who holds a position.
 *
 * The scope is addressable state (AGENTS.md #8), so it lives in the URL and
 * every link the pages emit carries it on: the item links, the create link,
 * the breadcrumb back to the list. The Setup navigation and the console's
 * legacy `system/*` URLs land on it.
 *
 * ⛔ It is a VIEW scope, never an authority: the server decides every write,
 * and the read-only gates read the caller's capabilities (`useCanAuthorMetadata`)
 * and the deployment's posture ({@link useWalledCatalogReadOnly}), not this
 * parameter.
 */

import { useAuth } from '@object-ui/auth';
import type { TenancyPosture } from '@object-ui/auth';
import { postureHasOrgWall, useTenancyPosture } from '../../hooks/useTenancyPosture.js';

/** The query parameter carrying the scope. Page-local to metadata-admin. */
export const CATALOG_SCOPE_PARAM = 'scope';

/** The one value it takes: the environment catalog Setup administers. */
export const ENVIRONMENT_SCOPE = 'environment';

/** Read-only view of a URL's query, as `useSearchParams` hands it out. */
interface QueryLike {
  get(name: string): string | null;
}

/** Is this URL the environment (Setup catalog) scope? */
export function isEnvironmentScope(search: QueryLike): boolean {
  return search.get(CATALOG_SCOPE_PARAM) === ENVIRONMENT_SCOPE;
}

/** `scope=environment`, ready to join into a query string. */
export const ENVIRONMENT_SCOPE_QUERY = `${CATALOG_SCOPE_PARAM}=${ENVIRONMENT_SCOPE}`;

/**
 * The query suffix a link on an environment-scope page appends so the next
 * page stays in that scope — `?scope=environment`, or `''` outside it.
 */
export function environmentScopeSuffix(search: QueryLike): string {
  return isEnvironmentScope(search) ? `?${ENVIRONMENT_SCOPE_QUERY}` : '';
}

/**
 * The catalog types Setup administers through this scope with an active
 * switch. Each name is also the activation ledger's `metadata_type` and the
 * activation door's `:type` (see `catalog-activation.ts`).
 *
 * `capability` is absent ON PURPOSE, and it is a catalog all the same. The
 * Capabilities page is this scope's list of the type,
 * `…/metadata/capability?scope=environment`: the capability registry (the
 * platform's curated capabilities, served since objectstack#22669, beside
 * every package-declared one), read-only because the served type entry offers
 * no runtime write channel. The capability picker lists the same registry
 * (objectui#7611). What a capability lacks is the switch: ADR-0126 §3 makes it
 * code-only, and the activation door refuses the type with `400`, so naming it
 * here would put a switch on that page that every click refuses.
 *
 * `sharing_rule` is here since objectstack ADR-0131 D6 charts declared sharing
 * rules under regime C (objectui#12982): a rule a package declares is switched
 * through the same door and ledger. It is not a security catalog type (below):
 * the wall's verdict on its switch is the door's, said as the server's
 * refusal, and the page lists declarations only (`sharing-rule-catalog.ts`).
 */
export const SETUP_CATALOG_TYPES = ['permission', 'position', 'sharing_rule'] as const;

/**
 * The security catalog: the metadata types whose items every organization
 * resolves BY NAME from the one environment registry (objectstack ADR-0131 D3).
 *
 * Restated, not imported: the server's list is `SECURITY_CATALOG_TYPES` in
 * `@objectstack/metadata-core`, a package this repository does not depend on,
 * and `@objectstack/spec` exports no such list. Nothing here re-derives the
 * two (AGENTS.md #9): a fourth catalog type added upstream is a server refusal
 * this list does not announce, and the page then offers a write the door
 * answers 403, shown as sent. The spellings are the console's own: the
 * metadata-admin routes carry the singular names `/meta/types` serves.
 */
const SECURITY_CATALOG_TYPES: readonly string[] = ['position', 'permission', 'capability'];

/**
 * objectui#12183 — is this catalog type read-only for this caller because the
 * deployment's tenancy wall makes the catalog the platform operator's?
 *
 * objectstack ADR-0131 D3, stage W (objectstack#22895): under `isolated` /
 * `group`, every door that writes a position, permission set or capability
 * asks `walledCatalogWriteVerdict`, which admits the engine itself and the
 * `PLATFORM_ADMIN` posture rung and refuses everyone else, whatever they hold
 * (`manage_metadata` included). Assignments are never judged. Under `single`,
 * or with no posture, it is inert.
 *
 * This reads the two facts the server publishes for that verdict, never a
 * client copy of it:
 *  - the posture, `features.tenancyPosture` (`useTenancyPosture`), which
 *    objectstack's auth config reads off the `tenancy` service the doors
 *    read;
 *  - the caller's rung, `user.isPlatformAdmin` on the session, which
 *    objectstack's session payload computes as `grants.posture ===
 *    'PLATFORM_ADMIN'` from the same resolution the doors' execution context
 *    carries. ⛔ Never `positions.includes('platform_admin')`: a tenant can
 *    write that name (see `useWorkspaceAdminStatus`).
 *
 * It does not read the environment scope: the server's verdict has no scope
 * input, and a package-door draft (`?package=`) is refused by the same door.
 * An unknown posture fails toward today's rendering; a session that never
 * published the flag reads as no operator standing.
 */
export function walledCatalogReadOnly(input: {
  type: string;
  posture: TenancyPosture | undefined;
  isPlatformOperator: boolean;
}): boolean {
  return (
    SECURITY_CATALOG_TYPES.includes(input.type)
    && postureHasOrgWall(input.posture)
    && !input.isPlatformOperator
  );
}

/** {@link walledCatalogReadOnly} for this session and this deployment. */
export function useWalledCatalogReadOnly(type: string): boolean {
  const posture = useTenancyPosture();
  const { user } = useAuth();
  return walledCatalogReadOnly({ type, posture, isPlatformOperator: user?.isPlatformAdmin === true });
}
