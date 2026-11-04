// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Crypto, secrets, internal fields, schema and datasource routing, init"
 * section of `ObjectQL`: the bodies of `resolveDatasourceBinding` moved out of
 * `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link SecretsAndRoutingHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface SecretsAndRoutingHost {
  readonly _registry: ObjectQL['_registry'];
  readonly defaultDriver: ObjectQL['defaultDriver'];
  readonly drivers: ObjectQL['drivers'];
  readonly manifests: ObjectQL['manifests'];
  resolveDatasourceFromMapping: ObjectQL['resolveDatasourceFromMapping'];
}

/** The body of `ObjectQL#resolveDatasourceBinding`; the method's docblock there is its contract. */
export function resolveDatasourceBinding(this: Pick<SecretsAndRoutingHost, '_registry' | 'defaultDriver' | 'drivers' | 'manifests' | 'resolveDatasourceFromMapping'>, objectName: string): {
    datasource: string;
    via: 'explicit' | 'mapping' | 'lifecycle' | 'package' | 'default';
    /** Owning package, on `via: 'package'` only — for the debug line. */
    packageId?: string;
  } | undefined {
    const object = this._registry.getObject(objectName);

    // 1. Object's explicit datasource field (highest priority)
    if (object?.datasource && object.datasource !== 'default') {
      return { datasource: object.datasource, via: 'explicit' };
    }

    // 2. Check datasourceMapping rules
    //
    // A rule that MATCHES is a routing decision, not a hint (#4462). It used to
    // fall through to steps 3-5 whenever the named datasource had no live
    // driver, which put an object's rows in the DEFAULT store while every
    // signal said otherwise: boot succeeded, `/ready` answered 200, the
    // datasource name appeared nowhere in the log, and the write returned 201.
    // An operator who routes an object to Postgres and gets the URL wrong finds
    // out by going to look in Postgres and finding it empty.
    //
    // `default` is the one name that legitimately resolves onward: the default
    // driver keeps its NATURAL name (#3826), so `drivers.has('default')` is
    // false by construction and step 5 is how routing to it works.
    const mappedDatasource = this.resolveDatasourceFromMapping(objectName, object);
    if (mappedDatasource && mappedDatasource !== 'default') {
      return { datasource: mappedDatasource, via: 'mapping' };
    }

    // 3. Lifecycle-class separation (ADR-0057 §3.6): high-frequency
    // platform-generated data (telemetry / event) and the audit ledger move
    // to a dedicated 'telemetry' datasource when one is registered, so their
    // growth can never again pollute the business DB. `transient` stays on
    // the primary deliberately: those objects are user-session data, and
    // some (e.g. better-auth's sys_device_code) are also accessed outside
    // the engine — splitting their storage would split their brain.
    const lifecycleClass = (object as { lifecycle?: { class?: string } } | undefined)?.lifecycle?.class;
    if (
      lifecycleClass !== undefined &&
      ObjectQL.SYSTEM_LEDGER_LIFECYCLE_CLASSES.has(lifecycleClass) &&
      this.drivers.has(ObjectQL.LIFECYCLE_DATASOURCE)
    ) {
      return { datasource: ObjectQL.LIFECYCLE_DATASOURCE, via: 'lifecycle' };
    }

    // 4. Check package's defaultDatasource
    // Use the object's FQN name (from getObject) for ownership lookup
    const fqn = object?.name || objectName;
    const owner = this._registry.getObjectOwner(fqn);
    if (owner?.packageId) {
      const manifest = this.manifests.get(owner.packageId);
      const packageDatasource = manifest?.defaultDatasource;
      if (packageDatasource && packageDatasource !== 'default' && this.drivers.has(packageDatasource)) {
        return { datasource: packageDatasource, via: 'package', packageId: owner.packageId };
      }
    }

    // 5. Fallback to global default driver
    if (this.defaultDriver && this.drivers.has(this.defaultDriver)) {
      return { datasource: this.defaultDriver, via: 'default' };
    }

    return undefined;
  }
