// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The host of each facet of `SchemaRegistry`, built ONCE per registry (#30051):
 * what every stub of a facet hands that facet's bodies as `this`, in place of
 * a host literal built on every call. Each `FacetHost` below is filled by the
 * factory `SchemaRegistry`'s static block installs, the one place that can read
 * the class's private members; the host is built on the first call that needs
 * it and kept for the registry's life. A method goes as a closure that calls it
 * on the registry at call time, a field or accessor as a getter (and a setter
 * when a body assigns it), so a body reads and writes the registry exactly as
 * the per-call literal let it.
 *
 * Written by the #33949 split codemod (PR #34285, kept in its branch history,
 * not committed); it imports types only, so it forms no evaluation cycle
 * and is evaluated before the class whichever module loads first.
 * `index.ts` re-exports nothing from this module.
 */

import type { SchemaRegistry } from './registry.js';
import type { AppsHost } from './registry-apps.js';
import type { BareNamesHost } from './registry-bare-names.js';
import type { ItemsHost } from './registry-items.js';
import type { NamespacesAndClaimsHost } from './registry-namespaces-and-claims.js';
import type { ObjectRegistrationHost } from './registry-object-registration.js';
import type { PackageAddressingHost } from './registry-package-addressing.js';
import type { PackagesHost } from './registry-packages.js';
import type { PicklistsHost } from './registry-picklists.js';
import type { PlatformGlobalHost } from './registry-platform-global.js';
import type { RestoreHost } from './registry-restore.js';
import type { StorageHost } from './registry-storage.js';

/** One facet's host for each registry: built on first use, kept for the registry's life. */
export class FacetHost<H> {
  private readonly hosts = new WeakMap<SchemaRegistry, H>();
  private build: ((registry: SchemaRegistry) => H) | undefined;

  constructor(private readonly facet: string) {}

  /** Called once, from `SchemaRegistry`'s static block. */
  install(build: (registry: SchemaRegistry) => H): void {
    this.build = build;
  }

  /** The host of `registry`, built on first use. */
  of(registry: SchemaRegistry): H {
    let host = this.hosts.get(registry);
    if (host === undefined) {
      if (this.build === undefined) {
        throw new Error(`${this.facet}: SchemaRegistry has not installed its host factory`);
      }
      host = this.build(registry);
      this.hosts.set(registry, host);
    }
    return host;
  }
}

export const appsHost = new FacetHost<AppsHost>('AppsFacet');
export const bareNamesHost = new FacetHost<BareNamesHost>('BareNamesFacet');
export const itemsHost = new FacetHost<ItemsHost>('ItemsFacet');
export const namespacesAndClaimsHost = new FacetHost<NamespacesAndClaimsHost>('NamespacesAndClaimsFacet');
export const objectRegistrationHost = new FacetHost<ObjectRegistrationHost>('ObjectRegistrationFacet');
export const packageAddressingHost = new FacetHost<PackageAddressingHost>('PackageAddressingFacet');
export const packagesHost = new FacetHost<PackagesHost>('PackagesFacet');
export const picklistsHost = new FacetHost<PicklistsHost>('PicklistsFacet');
export const platformGlobalHost = new FacetHost<PlatformGlobalHost>('PlatformGlobalFacet');
export const restoreHost = new FacetHost<RestoreHost>('RestoreFacet');
export const storageHost = new FacetHost<StorageHost>('StorageFacet');
