// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Crypto, secrets, internal fields, schema and datasource routing, init"
 * section of `ObjectQL`: the bodies of `setCryptoProvider`, `getKeyedDigest`,
 * `onCryptoProviderChange`, `setTenancyPostureProvider`, `getSchema`,
 * `resolveObjectName`, `judgeFilter`, `isSystemLedgerObject`,
 * `resolveDatasourceBinding`, `resolveEffectiveDatasource`,
 * `resolveMappedDatasource` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link SecretsAndRoutingFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link SecretsAndRoutingHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `secretsAndRoutingHost` in `engine-facet-hosts.ts`, built
 * once per engine by the class's static block. Methods go as closures that
 * call them on the engine at call time, so a subclass override or an instance
 * spy is still the one reached; fields and accessors go as GETTERS, read when
 * the body reads them, as they were on the class, and a field a body assigns
 * goes with a SETTER that assigns it on the engine.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import type { EngineQueryOptions, ServiceObject } from '@objectstack/spec/data';
import type { EngineFilterJudgement, EngineFilterJudgementOptions, ICryptoProvider } from '@objectstack/spec/contracts';
import { StorageNameMapping } from '@objectstack/spec/system';
import { objectNotFoundError } from '@objectstack/core';
import { judgeWhereAdmission } from './engine-top-level.js';
import { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link SecretsAndRoutingFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface SecretsAndRoutingHost {
  readonly _registry: ObjectQL['_registry'];
  cryptoProvider: ObjectQL['cryptoProvider'];
  readonly cryptoProviderListeners: ObjectQL['cryptoProviderListeners'];
  readonly defaultDriver: ObjectQL['defaultDriver'];
  readonly drivers: ObjectQL['drivers'];
  readonly logger: ObjectQL['logger'];
  readonly manifests: ObjectQL['manifests'];
  readonly relatedSchemaOf: ObjectQL['relatedSchemaOf'];
  resolveDatasourceBinding: ObjectQL['resolveDatasourceBinding'];
  resolveDatasourceFromMapping: ObjectQL['resolveDatasourceFromMapping'];
  resolveObjectName: ObjectQL['resolveObjectName'];
  tenancyPostureProvider: ObjectQL['tenancyPostureProvider'];
}

/** The bodies of the "Crypto, secrets, internal fields, schema and datasource routing, init" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class SecretsAndRoutingFacet {
  /** The body of `ObjectQL#setCryptoProvider`; the method's docblock there is its contract. */
  static setCryptoProvider(this: Pick<SecretsAndRoutingHost, 'cryptoProvider' | 'cryptoProviderListeners' | 'logger'>, provider: ICryptoProvider): void {
    this.cryptoProvider = provider;
    this.logger.info('CryptoProvider configured for secret fields');
    // A listener is a re-arm, never part of this call's contract: one that
    // throws must not fail the host's composition root, and must not stop the
    // listeners behind it from re-arming.
    for (const listener of [...this.cryptoProviderListeners]) {
      try {
        listener();
      } catch (err) {
        this.logger.warn('CryptoProvider registration listener failed', {
          error: (err as Error)?.message ?? String(err),
        });
      }
    }
  }

  /** The body of `ObjectQL#getKeyedDigest`; the method's docblock there is its contract. */
  static getKeyedDigest(this: Pick<SecretsAndRoutingHost, 'cryptoProvider'>): ((plain: string) => Promise<string>) | undefined {
    const provider = this.cryptoProvider;
    return provider ? (plain: string) => provider.keyedDigest(plain) : undefined;
  }

  /** The body of `ObjectQL#onCryptoProviderChange`; the method's docblock there is its contract. */
  static onCryptoProviderChange(this: Pick<SecretsAndRoutingHost, 'cryptoProviderListeners'>, listener: () => void): () => void {
    this.cryptoProviderListeners.add(listener);
    return () => {
      this.cryptoProviderListeners.delete(listener);
    };
  }

  /** The body of `ObjectQL#setTenancyPostureProvider`; the method's docblock there is its contract. */
  static setTenancyPostureProvider(this: Pick<SecretsAndRoutingHost, 'tenancyPostureProvider'>, provider: () => string | undefined): void {
    this.tenancyPostureProvider = provider;
  }

  /** The body of `ObjectQL#getSchema`; the method's docblock there is its contract. */
  static getSchema(this: Pick<SecretsAndRoutingHost, '_registry'>, objectName: string): ServiceObject | undefined {
    return this._registry.getObject(objectName);
  }

  /**
   * Resolve any object identifier to the physical storage name used by drivers.
   *
   * Accepts the canonical short name (e.g., 'account') or, for explicit
   * cross-package disambiguation, the canonical object name (e.g., 'account'). The result is
   * the physical table name derived via `StorageNameMapping.resolveTableName`.
   *
   * One name space with the data door: the target resolves ONLY through the
   * registry. A name the registry does not resolve is refused with the door's
   * own `OBJECT_NOT_FOUND` 404 (`objectNotFoundError`), never handed to the
   * driver as a raw table name. Before this, every in-process guard keyed by a
   * registered object name could be stepped around by naming the target some
   * other way, and an in-process caller (a sandboxed body, an action handler,
   * a hook) read what the door refused to serve.
   *
   * Platform code that must address storage without a registry entry has a
   * declared path a body cannot reach: the driver itself
   * (`datasource(name)`, `getDriverForObject(name)`), held by host code only.
   */
  static resolveObjectName(this: Pick<SecretsAndRoutingHost, '_registry'>, name: string): string {
    const schema = this._registry.getObject(name);
    if (schema) {
      return StorageNameMapping.resolveTableName(schema);
    }
    throw objectNotFoundError(name);
  }

  /** The body of `ObjectQL#judgeFilter`; the method's docblock there is its contract. */
  static judgeFilter(this: Pick<SecretsAndRoutingHost, '_registry' | 'relatedSchemaOf' | 'resolveObjectName'>, objectName: string, where: EngineQueryOptions['where'], options?: EngineFilterJudgementOptions): EngineFilterJudgement {
    const object = this._registry.getObject(objectName) ? this.resolveObjectName(objectName) : objectName;
    return judgeWhereAdmission(
      object,
      options?.operation ?? 'find',
      where,
      this._registry.getObject(object),
      options?.context,
      this.relatedSchemaOf,
    );
  }

  /**
   * Is `objectName` an append-only system ledger? — the #5351 carve-out's
   * discriminator, and deliberately a property of the object's DECLARATION
   * (`lifecycle.class`) rather than of the deployment's routing.
   *
   * Why the declaration and not "was it routed by step 3": an audit ledger
   * pinned to its own datasource by an explicit `datasource:` binding, or by a
   * `datasourceMapping` rule, is the same append-only compliance ledger with
   * the same reason to be carved out — the routing mechanism is an operator's
   * choice, the class is the author's statement about what the data IS. Judging
   * by the mechanism would make the carve-out depend on which of three
   * equivalent configurations a deployment happened to use.
   */
  static isSystemLedgerObject(this: Pick<SecretsAndRoutingHost, '_registry'>, objectName: string): boolean {
    const lifecycleClass = (
      this._registry.getObject(objectName) as { lifecycle?: { class?: string } } | undefined
    )?.lifecycle?.class;
    return lifecycleClass !== undefined && ObjectQL.SYSTEM_LEDGER_LIFECYCLE_CLASSES.has(lifecycleClass);
  }

  /**
   * WHERE does `objectName`'s data live, and WHICH step decided — the single
   * implementation of the resolution order documented on {@link getDriver}.
   *
   * Split out for #5288 so the order exists exactly once. It had two readers
   * with two different answers: `getDriver` (all five steps) and every caller
   * that only needed the NAME, which read `object.datasource` — step 1 of five.
   * A second, shorter copy of a routing order is the failure
   * `resolveMappedDatasource` (#4462) was extracted to prevent, and it fails the
   * same way: silently, in whichever direction the copy is short.
   *
   * Steps 1-2 answer even when the named datasource has no registered driver:
   * they are BINDINGS, and `getDriver` stops there (it throws rather than
   * falling through — #4462). Steps 3-5 answer only when their driver is
   * registered, because that registration is what turns each of them on.
   *
   * `undefined` means nothing routes the object anywhere: no binding, and no
   * global default driver to fall back to.
   */
  static resolveDatasourceBinding(this: Pick<SecretsAndRoutingHost, '_registry' | 'defaultDriver' | 'drivers' | 'manifests' | 'resolveDatasourceFromMapping'>, objectName: string): {
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

  /** The body of `ObjectQL#resolveEffectiveDatasource`; the method's docblock there is its contract. */
  static resolveEffectiveDatasource(this: Pick<SecretsAndRoutingHost, 'resolveDatasourceBinding'>, objectName: string): string | undefined {
    const binding = this.resolveDatasourceBinding(objectName);
    return binding && binding.via !== 'default' ? binding.datasource : undefined;
  }

  /** The body of `ObjectQL#resolveMappedDatasource`; the method's docblock there is its contract. */
  static resolveMappedDatasource(this: Pick<SecretsAndRoutingHost, '_registry' | 'resolveDatasourceFromMapping'>, objectName: string): string | null {
    return this.resolveDatasourceFromMapping(objectName, this._registry.getObject(objectName));
  }
}
