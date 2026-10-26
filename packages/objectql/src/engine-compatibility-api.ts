// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 8] The compatibility-API bodies of `ObjectQL` (the methods
 * that match the legacy `@objectql/core` interface), moved out of
 * `engine.ts` whole: `registerObject` (a single definition into the
 * registry, field names filled from their keys), `getConfigs` (the
 * registered objects as a name-to-config map), `introspectDatasource` (a
 * datasource's live remote schema, ADR-0015), `syncSchemas` (every
 * registered object's storage synced to its driver, a federated object bound
 * without DDL), `syncObjectSchema` (the same for one object, on demand) and
 * `removePackage` (a package's hooks, actions and objects removed).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same registry calls, the same two refusals before
 * introspection, the same federated routing, the same durability ERROR when a
 * schema sync fails, and the same removal order. Each method's docblock stays
 * on the method in `engine.ts`, which is still the contract.
 *
 * What stays in the class: `getDriverByName`, because ADR-0096 cites it by
 * `engine.ts#getDriverByName`; `create`, a static factory; `createContext`,
 * which hands the engine itself to `ScopedContext`, a value `engine.ts`
 * defines (moving it would import the engine at run time); and
 * `unregisterObject`, `getObject`, `getDriverForObject`,
 * `dropObjectSchema`, `datasource`, `on` and `close`, whose bodies are no
 * longer than the host literal moving them would cost.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method as
 * `engine-execute-transactions.ts` applies it. The class keeps all six
 * methods — every one is public, and the published `.d.ts` lists each one's
 * name, signature and position — and each body is one literal of exactly the
 * {@link CompatibilityApiHost} members that method reads, plus a `.call`.
 * The fields the bodies read (`_registry`, `drivers`, `hooks`, `logger`)
 * go as GETTERS, so each read happens when the body makes it, as it did. The
 * methods they call (`getDriverForObject`, `removeActionsByPackage`) go as
 * late-bound closures over the instance, so a double or spy set on the engine
 * is still the one a call reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import type { IntrospectedSchema as SpecIntrospectedSchema } from '@objectstack/spec/contracts';
import { StorageNameMapping } from '@objectstack/spec/system';
import { isFederatedObject } from './federated-object.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface CompatibilityApiHost {
  readonly _registry: ObjectQL['_registry'];
  readonly drivers: ObjectQL['drivers'];
  readonly hooks: ObjectQL['hooks'];
  readonly logger: ObjectQL['logger'];
  getDriverForObject: ObjectQL['getDriverForObject'];
  removeActionsByPackage: ObjectQL['removeActionsByPackage'];
}

/** The body of `ObjectQL#registerObject`; the method's docblock there is its contract. */
export function registerObject(
  this: Pick<CompatibilityApiHost, '_registry'>,
  schema: ServiceObject,
  packageId: string = '__runtime__',
  namespace?: string,
): string {
  // Auto-assign field names from keys
  if (schema.fields) {
    for (const [key, field] of Object.entries(schema.fields)) {
      if (field && typeof field === 'object' && !('name' in field)) {
        (field as any).name = key;
      }
    }
  }
  return this._registry.registerObject(schema, packageId, namespace);
}

/** The body of `ObjectQL#getConfigs`; the method's docblock there is its contract. */
export function getConfigs(this: Pick<CompatibilityApiHost, '_registry'>): Record<string, ServiceObject> {
  const result: Record<string, ServiceObject> = {};
  const objects = this._registry.getAllObjects();
  for (const obj of objects) {
    if (obj.name) {
      result[obj.name] = obj;
    }
  }
  return result;
}

/** The body of `ObjectQL#introspectDatasource`; the method's docblock there is its contract. */
export async function introspectDatasource(
  this: Pick<CompatibilityApiHost, 'drivers'>,
  datasource: string,
): Promise<SpecIntrospectedSchema> {
  const driver = this.drivers.get(datasource);
  if (!driver) {
    throw new Error(`[ObjectQL] Datasource '${datasource}' has no registered driver to introspect.`);
  }
  if (typeof driver.introspectSchema !== 'function') {
    throw new Error(`[ObjectQL] Driver for datasource '${datasource}' does not support introspectSchema().`);
  }
  return driver.introspectSchema();
}

/** The body of `ObjectQL#syncSchemas`; the method's docblock there is its contract. */
export async function syncSchemas(
  this: Pick<CompatibilityApiHost, '_registry' | 'getDriverForObject' | 'logger'>,
): Promise<void> {
  const allObjects = this._registry.getAllObjects();
  for (const obj of allObjects) {
    const driver = this.getDriverForObject(obj.name);
    if (!driver) continue;
    // [#21777] Same predicate and same treatment as the boot sync. The remote
    // owns this object's schema, so `syncSchema` would be refused
    // (`ExternalSchemaModeViolationError` on an external-schema datasource).
    // Logging that refusal at the #4632 ERROR below was a false durability
    // alarm, because nothing was meant to be created. The DDL-free binding
    // still runs, because an object registered at runtime has no other way
    // to its remote table: without it every read resolves to a table named
    // after the object.
    if (isFederatedObject(obj)) {
      if (typeof (driver as any).registerExternalObject !== 'function') {
        this.logger.debug('Driver does not support registerExternalObject, skipping external object', {
          object: obj.name,
          driver: (driver as any).name,
        });
        continue;
      }
      try {
        await (driver as any).registerExternalObject(obj);
        this.logger.debug('Federated object is not a DDL target — bound to its remote table without DDL', {
          object: obj.name,
          driver: (driver as any).name,
        });
      } catch (e: unknown) {
        this.logger.warn('Failed to register external object metadata', {
          object: obj.name,
          driver: (driver as any).name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      continue;
    }
    const tableName = StorageNameMapping.resolveTableName(obj);
    if (typeof (driver as any).syncSchemasBatch === 'function' && (driver as any).supports?.batchSchemaSync) {
      // Already handled per-driver below; skip individual call
    }
    if (typeof (driver as any).syncSchema === 'function') {
      try {
        await (driver as any).syncSchema(tableName, obj);
      } catch (e: unknown) {
        // #4632 — this catch used to be empty, with the comment "log
        // suppressed to avoid noise on already-synced tables". Suppressing an
        // already-synced no-op is not what it did: `syncSchema` is required to
        // be idempotent (see this method's doc comment), so a driver that
        // reaches this catch did NOT sync. The only callers are runtime
        // installs — marketplace plugin install, template seeding — which go
        // on to INSERT into a table this failure means does not exist, and
        // then report the install as successful. Nothing that claims to be
        // persisted afterwards is.
        this.logger.error(
          `Schema sync FAILED for object '${obj.name}' — its table/collection was NOT created or altered, yet the object is ` +
            `registered and will be written to: those writes will fail, or drop the columns that were never created. ` +
            `Any seeding or install step that continues past this point is not durable. ` +
            `Fix the driver error below, then re-run the install/sync.`,
          e as Error,
          { object: obj.name, tableName, driver: (driver as any)?.name },
        );
      }
    }
  }
}

/** The body of `ObjectQL#syncObjectSchema`; the method's docblock there is its contract. */
export async function syncObjectSchema(
  this: Pick<CompatibilityApiHost, '_registry' | 'getDriverForObject'>,
  objectName: string,
): Promise<void> {
  const obj = this._registry.getObject(objectName) as any;
  if (!obj) return;
  const driver = this.getDriverForObject(objectName);
  if (!driver) return;
  // Federated (external) object (ADR-0015): register read metadata WITHOUT DDL
  // (its remote schema is owned externally). This is what an app's onEnable
  // calls after registering a late external driver so coercion maps + the
  // physical-table mapping exist for queries. See SqlDriver.registerExternalObject.
  if (isFederatedObject(obj)) {
    if (typeof (driver as any).registerExternalObject === 'function') {
      await (driver as any).registerExternalObject(obj);
    }
    return;
  }
  if (typeof (driver as any).syncSchema !== 'function') return;
  const tableName = StorageNameMapping.resolveTableName(obj);
  await (driver as any).syncSchema(tableName, obj);
}

/** The body of `ObjectQL#removePackage`; the method's docblock there is its contract. */
export function removePackage(
  this: Pick<CompatibilityApiHost, 'hooks' | 'removeActionsByPackage' | '_registry'>,
  packageId: string,
): void {
  // Remove hooks
  for (const [key, handlers] of this.hooks.entries()) {
    const filtered = handlers.filter(h => h.packageId !== packageId);
    if (filtered.length !== handlers.length) {
      this.hooks.set(key, filtered);
    }
  }
  // Remove actions
  this.removeActionsByPackage(packageId);
  // Remove objects
  this._registry.unregisterObjectsByPackage(packageId, true);
}
