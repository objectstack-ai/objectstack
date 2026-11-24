// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The
 * "Logging control, object storage and generic metadata storage" section of
 * `SchemaRegistry`: the bodies of `log`, `warn`, `debug`, `openObjectEntry`,
 * `closeObjectEntry`, `setInitialDisabledPackageIds`, `onPackageEnabled`,
 * `announcePackageEnabled`, `onPackageUninstalled`,
 * `announcePackageUninstalled` moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link StorageFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link StorageHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `storageHost` in
 * `registry-facet-hosts.ts`, built once per registry by the class's static
 * block. Methods go as closures that call them on the registry at call time, so
 * a subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * registry.
 *
 * The module imports `registry.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { parseFQN } from './registry-top-level.js';
import type { ObjectContributor } from './registry-top-level.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link StorageFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface StorageHost {
  readonly _logLevel: SchemaRegistry['_logLevel'];
  initialDisabledPackageIds: SchemaRegistry['initialDisabledPackageIds'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  readonly objectKeysByShortName: SchemaRegistry['objectKeysByShortName'];
  readonly packageEnabledListeners: SchemaRegistry['packageEnabledListeners'];
  readonly packageUninstalledListeners: SchemaRegistry['packageUninstalledListeners'];
}

/** The bodies of the "Logging control, object storage and generic metadata storage" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class StorageFacet {
  /** The body of `SchemaRegistry#log`; the method's docblock there is its contract. */
  static log(this: Pick<StorageHost, '_logLevel'>, msg: string): void {
    if (this._logLevel === 'silent' || this._logLevel === 'error' || this._logLevel === 'warn') return;
    console.log(msg);
  }

  /**
   * [#14553] A diagnostic an operator filters FOR — emitted at every level down
   * to `warn`, silent only where the deployment has asked for silence
   * (`error`, `silent`).
   *
   * The level ladder is `debug < info < warn < error < silent`, so this is the
   * mirror of {@link log}: that one speaks only ABOVE `warn` and is therefore
   * the wrong channel for anything a `warn`-level deployment must not miss.
   * `OS_REGISTRY_LOG=warn` is what the objectql vitest config selects and what
   * a quiet production boot selects, and a relocation nobody can see there was
   * the defect this method exists to end.
   */
  static warn(this: Pick<StorageHost, '_logLevel'>, msg: string): void {
    if (this._logLevel === 'silent' || this._logLevel === 'error') return;
    console.warn(msg);
  }

  /**
   * Debug-only diagnostic: emitted solely when `logLevel === 'debug'`, so it
   * stays out of the default (`'info'`) boot log. Use for expected-but-noisy
   * housekeeping — e.g. re-registration on a metadata rebuild / HMR reload,
   * which looks like an error (`console.warn`) but is a normal path (#3420).
   */
  static debug(this: Pick<StorageHost, '_logLevel'>, msg: string): void {
    if (this._logLevel !== 'debug') return;
    console.debug(msg);
  }

  /**
   * [#10945] The ONLY writer of a new `objectContributors` key. Returns the
   * contributor list for `fqn`, creating an empty one — and indexing it under
   * its short name — on first use.
   *
   * A choke point rather than a discipline: the short-name index is maintained
   * inside the same statement that adds the key, so no future caller can add a
   * contributor list and forget the index half.
   */
  static openObjectEntry(this: Pick<StorageHost, 'objectContributors' | 'objectKeysByShortName'>, fqn: string): ObjectContributor[] {
    const existing = this.objectContributors.get(fqn);
    if (existing) return existing;

    const contributors: ObjectContributor[] = [];
    this.objectContributors.set(fqn, contributors);
    const { shortName } = parseFQN(fqn);
    const keys = this.objectKeysByShortName.get(shortName);
    // Append, never replace: `matches[0]` is first-registered-wins, and both
    // containers are appended to here in the same order, so the index array is
    // `objectContributors`' key order narrowed to this short name.
    if (keys) keys.push(fqn);
    else this.objectKeysByShortName.set(shortName, [fqn]);
    return contributors;
  }

  /**
   * [#10945] The ONLY remover of an `objectContributors` key — the mirror of
   * {@link openObjectEntry}. A no-op when the key is not registered, so removal
   * stays idempotent.
   *
   * Empty short-name buckets are deleted rather than left behind: a retained
   * empty array would make {@link resolveObjectKey}'s index hit and its FQN
   * fallback disagree for a name that is both (a legacy `<ns>__<name>` key
   * removed while a plain key of the same short name is still registered).
   */
  static closeObjectEntry(this: Pick<StorageHost, 'objectContributors' | 'objectKeysByShortName'>, fqn: string): void {
    if (!this.objectContributors.delete(fqn)) return;
    const { shortName } = parseFQN(fqn);
    const keys = this.objectKeysByShortName.get(shortName);
    if (!keys) return;
    const idx = keys.indexOf(fqn);
    if (idx !== -1) keys.splice(idx, 1);
    if (keys.length === 0) this.objectKeysByShortName.delete(shortName);
  }

  /** The body of `SchemaRegistry#setInitialDisabledPackageIds`; the method's docblock there is its contract. */
  static setInitialDisabledPackageIds(this: Pick<StorageHost, 'initialDisabledPackageIds'>, ids: Iterable<string>): void {
    this.initialDisabledPackageIds = new Set(ids);
  }

  /** The body of `SchemaRegistry#onPackageEnabled`; the method's docblock there is its contract. */
  static onPackageEnabled(this: Pick<StorageHost, 'packageEnabledListeners'>, listener: (packageId: string) => void): () => void {
    this.packageEnabledListeners.add(listener);
    return () => { this.packageEnabledListeners.delete(listener); };
  }

  /** Tell every {@link onPackageEnabled} listener. Never throws: the enable has happened, and a failing listener is logged at `error`. */
  static announcePackageEnabled(this: Pick<StorageHost, 'packageEnabledListeners'>, id: string): void {
    for (const listener of this.packageEnabledListeners) {
      try {
        listener(id);
      } catch (err) {
        console.error(
          `[Registry] package "${id}" was enabled, but a listener bringing state derived from it current failed `
            + `(${(err as Error)?.message ?? err}) — that state may still read as it did while the package was disabled.`,
        );
      }
    }
  }

  /** The body of `SchemaRegistry#onPackageUninstalled`; the method's docblock there is its contract. */
  static onPackageUninstalled(this: Pick<StorageHost, 'packageUninstalledListeners'>, listener: (packageId: string) => void): () => void {
    this.packageUninstalledListeners.add(listener);
    return () => { this.packageUninstalledListeners.delete(listener); };
  }

  /**
   * Tell every {@link onPackageUninstalled} listener. Never throws: the
   * uninstall has already happened, so a throwing listener must not read as a
   * refused one to the door that called {@link uninstallPackage}. It is logged
   * at `error` instead, because that listener's state now disagrees with this
   * registry while everything looks healthy.
   */
  static announcePackageUninstalled(this: Pick<StorageHost, 'packageUninstalledListeners'>, id: string): void {
    for (const listener of this.packageUninstalledListeners) {
      try {
        listener(id);
      } catch (err) {
        console.error(
          `[Registry] package "${id}" was uninstalled, but a listener keeping state keyed by its id failed to drop it `
            + `(${(err as Error)?.message ?? err}) — that state still names the package until the next restart, `
            + 'while the registry no longer does. Restart the runtime to bring the two back in line.',
        );
      }
    }
  }
}
