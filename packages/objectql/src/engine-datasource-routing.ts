// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 2] The datasource-routing bodies of `ObjectQL` — `getDriver`
 * (the name the routing order decides on, turned into a driver, with the
 * diagnosis when that driver is missing: #4462, framework#3828),
 * `resolveDatasourceFromMapping` (first matching `datasourceMapping` rule
 * wins) and `matchPattern` (the rules' glob match) — moved out of `engine.ts`
 * whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same debug lines emitted at the decision they describe, the
 * same three refusals for a binding with no driver, the same priority sort and
 * rule ladder, the same escaped glob.
 *
 * What stays in the class: `resolveDatasourceBinding`, the routing order
 * itself, because the liveness ledgers in `packages/spec/liveness/` and an ADR
 * cite it by `engine.ts#resolveDatasourceBinding` as the reader of
 * `object.datasource` and `manifest.defaultDatasource`; its two public faces
 * `resolveEffectiveDatasource` and `resolveMappedDatasource`, and
 * `isSystemLedgerObject`, whose bodies are shorter than the host literal
 * moving them would cost; `setDatasourceMapping`; and the two public statics.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method as
 * `engine-validation-messages.ts` applies it. The class keeps every method —
 * the published `.d.ts` lists each one's name, docblock and position — and
 * each body is one literal of exactly the {@link DatasourceRoutingHost}
 * members that method reads, plus a `.call`; `matchPattern` reads no member,
 * takes no host and is called directly. A method is handed over as a closure
 * that calls it on the engine at call time, so a test double or spy set on the
 * instance is still the one the body reaches: `getDriver` reaches
 * `resolveDatasourceBinding`, and `resolveDatasourceFromMapping` reaches
 * `matchPattern`, through the engine, exactly as before.
 *
 * The fields the bodies read (`drivers`, `logger`, `unavailableDatasources`,
 * `datasourceMapping`) go as GETTERS, so each read happens when the body makes
 * it: `setDatasourceMapping` replaces the rule array and `registerDriver`
 * changes the driver map, and a body sees whatever is installed at the moment
 * it reads, as it did.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import type { IDataDriver } from '@objectstack/core';
import type { ObjectQL } from './engine.js';
import { DatasourceUnavailableError } from './driver-connect-errors.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member
 * the class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface DatasourceRoutingHost {
  readonly drivers: ObjectQL['drivers'];
  readonly logger: ObjectQL['logger'];
  readonly unavailableDatasources: ObjectQL['unavailableDatasources'];
  readonly datasourceMapping: ObjectQL['datasourceMapping'];
  resolveDatasourceBinding: ObjectQL['resolveDatasourceBinding'];
  matchPattern: ObjectQL['matchPattern'];
}

/** The body of `ObjectQL#getDriver`; the method's docblock there is its contract. */
export function getDriver(
  this: Pick<DatasourceRoutingHost, 'resolveDatasourceBinding' | 'drivers' | 'logger' | 'unavailableDatasources'>,
  objectName: string,
): IDataDriver {
  const binding = this.resolveDatasourceBinding(objectName);

  if (binding) {
    const driver = this.drivers.get(binding.datasource);
    if (driver) {
      // Debug lines kept at the DECISION they describe, but emitted here so
      // the resolver stays free of side effects: it also answers the public
      // {@link resolveEffectiveDatasource} probe, which must be able to name
      // a datasource without logging a routing event that never happened.
      if (binding.via === 'mapping') {
        this.logger.debug('Resolved datasource from mapping', {
          object: objectName,
          datasource: binding.datasource
        });
      } else if (binding.via === 'package') {
        this.logger.debug('Resolved datasource from package manifest', {
          object: objectName,
          package: binding.packageId,
          datasource: binding.datasource
        });
      }
      return driver;
    }

    // Only steps 1 and 2 reach here. Steps 3-5 answer ONLY when their driver
    // is registered (that registration is what opts the deployment into
    // lifecycle separation / a package default / a global default at all), so
    // a binding they produce always resolves.
    //
    // The datasource layer may have recorded WHY this one has no driver —
    // refused by the host policy, or failed to connect under
    // OS_ALLOW_DRIVER_CONNECT_FAILURE (framework#3828). Saying so beats
    // sending the reader hunting for a typo that isn't there.
    const unavailable = this.unavailableDatasources.get(binding.datasource);
    if (unavailable) {
      throw new DatasourceUnavailableError(
        binding.datasource,
        objectName,
        unavailable.kind,
        unavailable.publicDetail,
      );
    }
    if (binding.via === 'mapping') {
      throw new Error(
        `[ObjectQL] Datasource '${binding.datasource}' mapped for object '${objectName}' is not registered. ` +
        `A datasourceMapping rule routes this object to it, so falling back to the default store would ` +
        `write the object's data to a different database than the one it declares. Fix the datasource ` +
        `configuration, or remove the mapping rule.`,
      );
    }
    // No record: nothing ever tried to connect this name, so it is genuinely
    // undeclared (or misspelled). Unchanged message — there is nothing to add.
    throw new Error(`[ObjectQL] Datasource '${binding.datasource}' configured for object '${objectName}' is not registered.`);
  }

  throw new Error(`[ObjectQL] No driver available for object '${objectName}'`);
}

/** The body of `ObjectQL#resolveDatasourceFromMapping`; the method's docblock there is its contract. */
export function resolveDatasourceFromMapping(
  this: Pick<DatasourceRoutingHost, 'datasourceMapping' | 'matchPattern'>,
  objectName: string,
  object?: any
): string | null {
  if (!this.datasourceMapping || this.datasourceMapping.length === 0) {
    return null;
  }

  // Sort rules by priority if any have priority set
  const sortedRules = [...this.datasourceMapping].sort((a, b) => {
    const aPriority = a.priority ?? 1000;
    const bPriority = b.priority ?? 1000;
    return aPriority - bPriority;
  });

  for (const rule of sortedRules) {
    // 1. Match by namespace
    if (rule.namespace && object?.namespace === rule.namespace) {
      return rule.datasource;
    }

    // 2. Match by package ID
    if (rule.package && object?.packageId === rule.package) {
      return rule.datasource;
    }

    // 3. Match by object name pattern (glob-style)
    if (rule.objectPattern && this.matchPattern(objectName, rule.objectPattern)) {
      return rule.datasource;
    }

    // 4. Default fallback rule
    if (rule.default) {
      return rule.datasource;
    }
  }

  return null;
}

/** The body of `ObjectQL#matchPattern`; the method's docblock there is its contract. */
export function matchPattern(objectName: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
    .replace(/\*/g, '.*')                   // * → .*
    .replace(/\?/g, '.');                   // ? → .

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(objectName);
}
