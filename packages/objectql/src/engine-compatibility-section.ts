// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Compatibility / convenience API" section of `ObjectQL`:
 * the bodies of `unregisterObject`, `getObject`, `getDriverByName`,
 * `getDriverForObject`, `dropObjectSchema`, `datasource`, `on`, `close`,
 * `create` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link CompatibilitySectionFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link CompatibilitySectionHost}: exactly
 * the `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `compatibilitySectionHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import type { HookContext, ServiceObject } from '@objectstack/spec/data';
import { StorageNameMapping } from '@objectstack/spec/system';
import type { IDataDriver } from '@objectstack/core';
import { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link CompatibilitySectionFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface CompatibilitySectionHost {
  readonly _registry: ObjectQL['_registry'];
  destroy: ObjectQL['destroy'];
  readonly drivers: ObjectQL['drivers'];
  getDriver: ObjectQL['getDriver'];
  getDriverForObject: ObjectQL['getDriverForObject'];
  getSchema: ObjectQL['getSchema'];
  registerHook: ObjectQL['registerHook'];
}

/** The bodies of the "Compatibility / convenience API" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class CompatibilitySectionFacet {
  /** The body of `ObjectQL#unregisterObject`; the method's docblock there is its contract. */
  static unregisterObject(this: Pick<CompatibilitySectionHost, '_registry'>, name: string, packageId?: string): void {
    if (packageId) {
      this._registry.unregisterObjectsByPackage(packageId);
    } else {
      // Remove from generic metadata as fallback
      this._registry.unregisterItem('object', name);
    }
  }

  /** The body of `ObjectQL#getObject`; the method's docblock there is its contract. */
  static getObject(this: Pick<CompatibilitySectionHost, 'getSchema'>, name: string): ServiceObject | undefined {
    return this.getSchema(name);
  }

  /** The body of `ObjectQL#getDriverByName`; the method's docblock there is its contract. */
  static getDriverByName(this: Pick<CompatibilitySectionHost, 'drivers'>, name: string): IDataDriver | undefined {
    return this.drivers.get(name);
  }

  /** The body of `ObjectQL#getDriverForObject`; the method's docblock there is its contract. */
  static getDriverForObject(this: Pick<CompatibilitySectionHost, 'getDriver'>, objectName: string): IDataDriver | undefined {
    try {
      return this.getDriver(objectName);
    } catch {
      return undefined;
    }
  }

  /** The body of `ObjectQL#dropObjectSchema`; the method's docblock there is its contract. */
  static async dropObjectSchema(this: Pick<CompatibilitySectionHost, '_registry' | 'getDriverForObject'>, objectName: string): Promise<void> {
    const obj = this._registry.getObject(objectName) as any;
    const driver = this.getDriverForObject(objectName);
    if (!driver || typeof (driver as any).dropTable !== 'function') return;
    const tableName = StorageNameMapping.resolveTableName(obj ?? ({ name: objectName } as any));
    await (driver as any).dropTable(tableName);
  }

  /** The body of `ObjectQL#datasource`; the method's docblock there is its contract. */
  static datasource(this: Pick<CompatibilitySectionHost, 'drivers'>, name: string): IDataDriver {
    const driver = this.drivers.get(name);
    if (!driver) {
      throw new Error(`[ObjectQL] Datasource '${name}' not found`);
    }
    return driver;
  }

  /** The body of `ObjectQL#on`; the method's docblock there is its contract. */
  static on(this: Pick<CompatibilitySectionHost, 'registerHook'>, event: string, objectName: string, handler: (ctx: HookContext) => Promise<void> | void, packageId?: string): void {
    this.registerHook(event, handler, { object: objectName, packageId });
  }

  /** The body of `ObjectQL#close`; the method's docblock there is its contract. */
  static async close(this: Pick<CompatibilitySectionHost, 'destroy'>): Promise<void> {
    return this.destroy();
  }

  /** The body of `ObjectQL#create`; the method's docblock there is its contract. */
  static async create(config: {
    datasources?: Record<string, IDataDriver>;
    objects?: Record<string, ServiceObject>;
    hooks?: Array<{ event: string; object: string; handler: (ctx: HookContext) => Promise<void> | void }>;
  }): Promise<ObjectQL> {
    const ql = new ObjectQL();

    // Register drivers
    if (config.datasources) {
      for (const [name, driver] of Object.entries(config.datasources)) {
        // Set driver name if not already set
        if (!driver.name) {
          (driver as any).name = name;
        }
        ql.registerDriver(driver, name === 'default');
      }
    }

    // Register objects
    if (config.objects) {
      for (const [_key, schema] of Object.entries(config.objects)) {
        ql.registerObject(schema);
      }
    }

    // Register hooks
    if (config.hooks) {
      for (const hook of config.hooks) {
        ql.on(hook.event, hook.object, hook.handler);
      }
    }

    // Initialize (connect drivers)
    await ql.init();

    return ql;
  }
}
