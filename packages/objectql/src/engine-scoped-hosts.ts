// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30052 codemod] The host of each facet of `ObjectRepository` and `ScopedContext`,
 * built ONCE per instance: what every stub of a facet hands that facet's
 * bodies as `this`. Each host below is filled by the factory its class's
 * static block installs, the one place that can read the class's private
 * members; the host is built on the first call that needs it and kept for
 * the instance's life. A method goes as a closure that calls it on the
 * instance at call time, a field or accessor as a getter (and a setter when
 * a body assigns it), so a body reads and writes the instance exactly as
 * the method did.
 *
 * Written by `scripts/codemod-split-engine.mjs` (its second pass). It imports
 * types only, so it forms no evaluation cycle and is evaluated before the
 * classes whichever module loads first. `index.ts` re-exports nothing from
 * this module.
 */

import type { ObjectRepository, ScopedContext } from './engine.js';
import type { ObjectRepositoryHost } from './engine-object-repository.js';
import type { ScopedContextHost } from './engine-scoped-context.js';

/** One facet's host for each instance of its class: built on first use, kept for the instance's life. */
export class InstanceHost<E extends object, H> {
  private readonly hosts = new WeakMap<E, H>();
  private build: ((instance: E) => H) | undefined;

  constructor(private readonly facet: string, private readonly owner: string) {}

  /** Called once, from the owning class's static block. */
  install(build: (instance: E) => H): void {
    this.build = build;
  }

  /** The host of `instance`, built on first use. */
  of(instance: E): H {
    let host = this.hosts.get(instance);
    if (host === undefined) {
      if (this.build === undefined) {
        throw new Error(`${this.facet}: ${this.owner} has not installed its host factory`);
      }
      host = this.build(instance);
      this.hosts.set(instance, host);
    }
    return host;
  }
}

export const objectRepositoryHost = new InstanceHost<ObjectRepository, ObjectRepositoryHost>('ObjectRepositoryFacet', 'ObjectRepository');
export const scopedContextHost = new InstanceHost<ScopedContext, ScopedContextHost>('ScopedContextFacet', 'ScopedContext');
