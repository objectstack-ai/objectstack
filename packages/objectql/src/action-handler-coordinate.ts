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
 * The environment's own slot (ADR-0150 D1 bucket 4): the handlers the engine
 * plugin's authored-action resync registers (`metadata-service`) for
 * environment-authored rows whose name no code package ships. A resolved
 * environment holder (`actionHolderCoordinate`) dispatches here.
 */
export const ENVIRONMENT_ACTION_COORDINATE = '';

/**
 * [#31673, review 6729902179 F1] The slot of a handler registered with NO
 * owner: host code calling `engine.registerAction(object, name, fn)` (the
 * documented pattern a code package's target-bound actions use, e.g.
 * `examples/app-todo`). Kept apart from {@link ENVIRONMENT_ACTION_COORDINATE}
 * so a package call can reach host code without ever reaching an
 * environment-authored action's body. Not a package id: a manifest id is
 * reverse-domain and never parenthesised.
 */
export const HOST_ACTION_COORDINATE = '(host)';

/** The owner label the engine plugin's authored-action resync registers under. */
const AUTHORED_ACTION_OWNER = 'metadata-service';

/**
 * The package coordinate of a handler registered under `owner` (the
 * `packageName` argument of `ObjectQL#registerAction`):
 *
 *  - `app:<packageId>` (the runtime's `bindAppArtifactHandlers`) → that package;
 *  - `metadata-service` → {@link ENVIRONMENT_ACTION_COORDINATE}: an
 *    environment-authored action (the resync binds no row a code package
 *    ships, `isArtifactShippedAction`, except a declared override, which is
 *    bound at its base's coordinate instead);
 *  - none or `''` → {@link HOST_ACTION_COORDINATE}: host code;
 *  - any other owner (a plugin's id) → itself, as the one-holder rule names it
 *    ({@link handlerOwnerPackageId}).
 */
export function actionHandlerCoordinate(owner: string | undefined): string {
  if (owner === AUTHORED_ACTION_OWNER) return ENVIRONMENT_ACTION_COORDINATE;
  if (owner === undefined || owner === '') return HOST_ACTION_COORDINATE;
  return handlerOwnerPackageId(owner);
}

/**
 * [#31673] Is a handler at `coordinate`, registered under `owner`, one a call
 * naming a package with no handler of its own may fall back to? Host code
 * ({@link HOST_ACTION_COORDINATE}) and a plugin's handler are; a package's
 * (`app:<id>`) and the environment's ({@link ENVIRONMENT_ACTION_COORDINATE})
 * never are: those belong to another holder's declarations.
 */
export function isSharedHandlerCoordinate(coordinate: string, owner: string | undefined): boolean {
  if (coordinate === HOST_ACTION_COORDINATE) return true;
  if (coordinate === ENVIRONMENT_ACTION_COORDINATE || owner === undefined) return false;
  return handlerOwnerPackageId(owner) === owner;
}
