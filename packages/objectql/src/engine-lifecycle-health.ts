// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 3] The lifecycle health bodies of `ObjectQL` —
 * `checkDriversHealth` (ping every registered driver, each check bounded by a
 * timeout: framework#3756) and `resolvePrimaryDatasource` (which datasource
 * holds this deployment's platform system objects, the #13408 criterion) —
 * moved out of `engine.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same default timeout and unref'd timer, the same healthy
 * verdict for a driver with no `checkHealth()`, the same voters and the same
 * four refusals.
 *
 * What stays in the class: `init`, whose return type is inferred, so moving
 * its body would re-infer the published `.d.ts` through this module.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method as
 * `engine-datasource-routing.ts` applies it. The class keeps every method —
 * the published `.d.ts` lists each one's name, signature, docblock and
 * position — and each body is one literal of exactly the
 * {@link LifecycleHealthHost} members that method reads, plus a `.call`. A
 * method is handed over as a closure that calls it on the engine at call
 * time, so a test double or spy set on the instance is still the one the body
 * reaches: `resolvePrimaryDatasource` reaches `isSystemLedgerObject` and
 * `resolveDatasourceBinding` through the engine, exactly as before.
 *
 * The fields the bodies read (`drivers`, `_registry`) go as GETTERS, so each
 * read happens when the body makes it: `registerDriver` and the eviction path
 * change the driver map, and a body sees whatever is installed at the moment
 * it reads, as it did.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import { PLATFORM_PROVIDED_OBJECT_NAMES } from '@objectstack/spec/system';
import type { ObjectQL } from './engine.js';
import type { DriverHealth, PrimaryDatasourceVerdict } from './driver-connect-errors.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member
 * the class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface LifecycleHealthHost {
  readonly drivers: ObjectQL['drivers'];
  readonly _registry: ObjectQL['_registry'];
  isSystemLedgerObject: ObjectQL['isSystemLedgerObject'];
  resolveDatasourceBinding: ObjectQL['resolveDatasourceBinding'];
}

/** The body of `ObjectQL#checkDriversHealth`; the method's docblock there is its contract. */
export async function checkDriversHealth(
  this: Pick<LifecycleHealthHost, 'drivers'>,
  opts?: { timeoutMs?: number },
): Promise<DriverHealth[]> {
  const timeoutMs = opts?.timeoutMs ?? 2_000;

  return Promise.all(
    Array.from(this.drivers, async ([driverName, driver]): Promise<DriverHealth> => {
      if (typeof driver.checkHealth !== 'function') {
        return { driverName, healthy: true, skipped: true };
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const healthy = await Promise.race([
          Promise.resolve(driver.checkHealth()),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`checkHealth did not settle within ${timeoutMs}ms`)),
              timeoutMs,
            );
            // Never hold the event loop open for a probe.
            (timer as { unref?: () => void }).unref?.();
          }),
        ]);
        return healthy
          ? { driverName, healthy: true }
          : { driverName, healthy: false, error: 'checkHealth() returned false' };
      } catch (e) {
        return {
          driverName,
          healthy: false,
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
}

/** The body of `ObjectQL#resolvePrimaryDatasource`; the method's docblock there is its contract. */
export function resolvePrimaryDatasource(
  this: Pick<LifecycleHealthHost, '_registry' | 'isSystemLedgerObject' | 'resolveDatasourceBinding' | 'drivers'>,
): PrimaryDatasourceVerdict {
  const byDatasource = new Map<string, number>();
  for (const objectName of PLATFORM_PROVIDED_OBJECT_NAMES) {
    // Not registered in THIS deployment (OSS runtime vs cloud, plugins not
    // installed) — no evidence either way, so it does not vote.
    if (!this._registry.getObject(objectName)) continue;
    // ADR-0057 §3.6: deliberately off the primary. See the header.
    if (this.isSystemLedgerObject(objectName)) continue;

    const binding = this.resolveDatasourceBinding(objectName);
    // A registered platform object that routes NOWHERE is a broken
    // deployment, not a quiet abstention: there is no binding and no default
    // driver, so no answer about "the primary" can be true.
    if (!binding) return { resolved: false, reason: 'system-object-unbound' };

    byDatasource.set(binding.datasource, (byDatasource.get(binding.datasource) ?? 0) + 1);
  }

  if (byDatasource.size === 0) return { resolved: false, reason: 'no-system-objects-registered' };
  if (byDatasource.size > 1) {
    return {
      resolved: false,
      reason: 'system-objects-split',
      candidates: [...byDatasource.keys()].sort(),
    };
  }

  const [[datasource, witnesses]] = [...byDatasource];
  // Steps 1-2 of the resolution order answer with a name even when nothing is
  // registered under it (that is deliberate — `getDriver` throws loudly on
  // it). A readiness probe cannot use such a name: `checkDriversHealth()`
  // reports only REGISTERED drivers, so an unregistered primary would be
  // absent from the unhealthy list and read as healthy — the silent
  // don't-drain the ruling forbids.
  if (!this.drivers.has(datasource)) {
    return { resolved: false, reason: 'no-driver-registered', candidates: [datasource] };
  }
  return { resolved: true, datasource, witnesses };
}
