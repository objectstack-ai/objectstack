// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Access control → Positions and permissions: the environment
 * directory, moved out of Studio (ADR-0084, amendment of 2026-11-26
 * "Placements, and what moves to Setup"; question 5 of that amendment, ruled).
 *
 * The directory lists the environment catalog's types (positions,
 * capabilities, permission sets, sharing rules: `ENVIRONMENT_AREA_TYPES`)
 * across every package, and each type's list in the environment scope. Setup
 * holds what is global; Studio develops one package. An item listed here still
 * opens in Studio (ADR-0146 D1), on the editor the environment scope uses
 * (`/studio/~all/metadata/TYPE/NAME?scope=environment`): an environment item
 * is edited by name, and it may belong to no package.
 *
 * Pure addresses only, so the routing rules are pinned without a render.
 */

import { CATALOG_SCOPE_PARAM, ENVIRONMENT_SCOPE } from '../metadata-admin/catalog-scope.js';
import { ENVIRONMENT_AREA_TYPES } from '../metadata-admin/metadataAreaHost.js';
import {
  STUDIO_ALL_PACKAGES_SEGMENT,
  studioMetadataAreaAddress,
  studioMetadataAreaRoot,
} from '../studio-design/studioAddress.js';
import { ACCESS_DIRECTORY_CAPABILITY, ACCESS_DIRECTORY_PATH } from './accessDirectoryRef.js';

export {
  ACCESS_DIRECTORY_CAPABILITY,
  ACCESS_DIRECTORY_PATH,
  ACCESS_DIRECTORY_REF,
  SETUP_ACCESS_CAPABILITY,
  holdsSetupAccess,
} from './accessDirectoryRef.js';

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Whether a capability set admits the Setup page: the same reading of
 * {@link ACCESS_DIRECTORY_CAPABILITY} Studio's entry gate makes
 * (`holdsStudioAccess` in the console), so the page is never wider than the
 * Studio gate it replaces (objectstack#37565).
 */
export function holdsAccessDirectoryCapability(systemPermissions: readonly string[] | undefined): boolean {
  return Array.isArray(systemPermissions) && systemPermissions.includes(ACCESS_DIRECTORY_CAPABILITY);
}

/** Whether a type is one the directory lists. */
export function isAccessDirectoryType(type: string): boolean {
  return ENVIRONMENT_AREA_TYPES.includes(type);
}

/**
 * The directory, or one type's list in the environment scope. `type` is the
 * type's name, not encoded.
 */
export function accessDirectoryPath(type?: string): string {
  if (!type) return ACCESS_DIRECTORY_PATH;
  return `${ACCESS_DIRECTORY_PATH}/${encodeURIComponent(type)}?${CATALOG_SCOPE_PARAM}=${ENVIRONMENT_SCOPE}`;
}

function decodedSegments(rest: string): string[] | null {
  try {
    return rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
}

/**
 * Where an address of Studio's cross-package leg (`/studio/~all/metadata/…`)
 * belongs now, or `null` when it stays in Studio. Read after the leg's own
 * redirect has settled it on the leg (`areaLocationRedirect`).
 *
 *  - the leg's root is the directory: the Setup page, the query kept;
 *  - a list of one of the directory's types in the environment scope is that
 *    type's list on the Setup page, the query kept;
 *  - anything else (an item, a create, a history, the cross-package list of a
 *    type outside the environment scope) stays: those open in Studio.
 *
 * `rest` is the path below the leg's root as the URL spells it (encoded), `''`
 * at the root; `search` is the URL's query, with or without its `?`.
 */
export function studioAllLegSetupRedirect(rest: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const segments = decodedSegments(rest);
  if (!segments) return null;
  if (segments.length === 0) return withQuery(ACCESS_DIRECTORY_PATH, params);
  if (segments.length !== 1 || !isAccessDirectoryType(segments[0])) return null;
  if (params.get(CATALOG_SCOPE_PARAM) !== ENVIRONMENT_SCOPE) return null;
  return withQuery(`${ACCESS_DIRECTORY_PATH}/${encodeURIComponent(segments[0])}`, params);
}

/**
 * {@link studioAllLegSetupRedirect} for a whole Studio address (path, query,
 * fragment), for a caller that has built one: the address itself when it is
 * not on the cross-package leg or stays in Studio, else the Setup page's.
 */
export function studioAddressAfterSetupMove(address: string): string {
  const root = studioMetadataAreaRoot(STUDIO_ALL_PACKAGES_SEGMENT);
  const hashAt = address.indexOf('#');
  const hash = hashAt === -1 ? '' : address.slice(hashAt);
  const beforeHash = hashAt === -1 ? address : address.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const search = queryAt === -1 ? '' : beforeHash.slice(queryAt);
  if (path !== root && !path.startsWith(`${root}/`)) return address;
  const moved = studioAllLegSetupRedirect(path.slice(root.length).replace(/^\/+/, ''), search);
  return moved ? `${moved}${hash}` : address;
}

/**
 * Where an address below the Setup page belongs, or `null` when the page
 * serves it: the directory, and a directory type's list in the environment
 * scope.
 *
 *  - a directory type's list without the environment scope gets it (and loses
 *    `?package=`, which the environment scope never binds);
 *  - a list of another type is the cross-package list, which stays in Studio;
 *  - an item, a create or a history opens in Studio, on the same path below
 *    the cross-package leg, the query kept (ADR-0146 D1).
 */
export function accessDirectoryLocation(rest: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const segments = decodedSegments(rest);
  if (!segments) return ACCESS_DIRECTORY_PATH;
  if (segments.length === 0) return null;
  const studio = () =>
    studioMetadataAreaAddress(STUDIO_ALL_PACKAGES_SEGMENT, rest.replace(/^\/+|\/+$/g, ''), { query: params });
  if (segments.length > 1 || !isAccessDirectoryType(segments[0])) return studio();
  if (params.get(CATALOG_SCOPE_PARAM) === ENVIRONMENT_SCOPE) return null;
  params.delete('package');
  params.set(CATALOG_SCOPE_PARAM, ENVIRONMENT_SCOPE);
  return withQuery(`${ACCESS_DIRECTORY_PATH}/${encodeURIComponent(segments[0])}`, params);
}
