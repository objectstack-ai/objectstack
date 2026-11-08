// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, #31673] The package coordinate of an action HANDLER — the
 * package half of the engine's `(package, objectName, name)` key, read off the
 * owner label a handler is registered under. Its own module, free of the
 * package-scoped resolver, because the engine (`engine-actions.ts`) is part of
 * the lean `./core` entry, which never imports `@objectstack/metadata-protocol`
 * (ADR-0076 D2). The declaration half is `action-package-addressing.ts`.
 */

import { handlerOwnerPackageId } from './bare-name-one-holder.js';

/**
 * The coordinate of a handler registered with no package, by the engine
 * plugin's authored-action resync (`metadata-service`, an environment-authored
 * row whose name no code package ships), or by host code: the environment's
 * own slot (ADR-0150 D1 bucket 4).
 */
export const ENVIRONMENT_ACTION_COORDINATE = '';

/** The owner label the engine plugin's authored-action resync registers under. */
const AUTHORED_ACTION_OWNER = 'metadata-service';

/**
 * The package coordinate of a handler registered under `owner` (the
 * `packageName` argument of `ObjectQL#registerAction`):
 *
 *  - `app:<packageId>` (the runtime's `bindAppArtifactHandlers`) → that package;
 *  - none, `''` or `metadata-service` → {@link ENVIRONMENT_ACTION_COORDINATE}:
 *    host code, or an environment-authored action (the resync binds no row a
 *    code package ships, `isArtifactShippedAction`, except a declared
 *    override, which is bound at its base's coordinate instead);
 *  - any other owner (a plugin's id) → itself, as the one-holder rule names it
 *    ({@link handlerOwnerPackageId}).
 */
export function actionHandlerCoordinate(owner: string | undefined): string {
  if (owner === undefined || owner === '' || owner === AUTHORED_ACTION_OWNER) return ENVIRONMENT_ACTION_COORDINATE;
  return handlerOwnerPackageId(owner);
}
