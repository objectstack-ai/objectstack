// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The host of each facet of `ObjectQL`, built ONCE per engine (#30051):
 * what every stub of a facet hands that facet's bodies as `this`, in place of
 * a host literal built on every call. Each `FacetHost` below is filled by the
 * factory `ObjectQL`'s static block installs, the one place that can read
 * the class's private members; the host is built on the first call that needs
 * it and kept for the engine's life. A method goes as a closure that calls it
 * on the engine at call time, a field or accessor as a getter (and a setter
 * when a body assigns it), so a body reads and writes the engine exactly as
 * the per-call literal let it.
 *
 * Written by `scripts/codemod-split-engine.mjs`; it imports types only, so it forms no
 * evaluation cycle and is evaluated before the class whichever module loads
 * first. `index.ts` re-exports nothing from this module.
 */

import type { ObjectQL } from './engine.js';
import type { ActionsHost } from './engine-actions.js';
import type { CascadePlanningHost } from './engine-cascade-planning.js';
import type { CompatibilitySectionHost } from './engine-compatibility-section.js';
import type { DefaultsAndAutonumbersHost } from './engine-defaults-and-autonumbers.js';
import type { DeleteAndAggregateHost } from './engine-delete-and-aggregate.js';
import type { FindHost } from './engine-find.js';
import type { HooksAndFunctionsHost } from './engine-hooks-and-functions.js';
import type { InsertHost } from './engine-insert.js';
import type { MiddlewareAndContextHost } from './engine-middleware-and-context.js';
import type { MigrationStateHost } from './engine-migration-state.js';
import type { ReferencesAndMasterDetailHost } from './engine-references-and-master-detail.js';
import type { RegistrationHost } from './engine-registration.js';
import type { SecretsAndRoutingHost } from './engine-secrets-and-routing.js';
import type { SecurityResolversHost } from './engine-security-resolvers.js';
import type { SummariesAndExpansionHost } from './engine-summaries-and-expansion.js';
import type { TransactionsSectionHost } from './engine-transactions-section.js';

/** One facet's host for each engine: built on first use, kept for the engine's life. */
export class FacetHost<H> {
  private readonly hosts = new WeakMap<ObjectQL, H>();
  private build: ((engine: ObjectQL) => H) | undefined;

  constructor(private readonly facet: string) {}

  /** Called once, from `ObjectQL`'s static block. */
  install(build: (engine: ObjectQL) => H): void {
    this.build = build;
  }

  /** The host of `engine`, built on first use. */
  of(engine: ObjectQL): H {
    let host = this.hosts.get(engine);
    if (host === undefined) {
      if (this.build === undefined) {
        throw new Error(`${this.facet}: ObjectQL has not installed its host factory`);
      }
      host = this.build(engine);
      this.hosts.set(engine, host);
    }
    return host;
  }
}

export const actionsHost = new FacetHost<ActionsHost>('ActionsFacet');
export const cascadePlanningHost = new FacetHost<CascadePlanningHost>('CascadePlanningFacet');
export const compatibilitySectionHost = new FacetHost<CompatibilitySectionHost>('CompatibilitySectionFacet');
export const defaultsAndAutonumbersHost = new FacetHost<DefaultsAndAutonumbersHost>('DefaultsAndAutonumbersFacet');
export const deleteAndAggregateHost = new FacetHost<DeleteAndAggregateHost>('DeleteAndAggregateFacet');
export const findHost = new FacetHost<FindHost>('FindFacet');
export const hooksAndFunctionsHost = new FacetHost<HooksAndFunctionsHost>('HooksAndFunctionsFacet');
export const insertHost = new FacetHost<InsertHost>('InsertFacet');
export const middlewareAndContextHost = new FacetHost<MiddlewareAndContextHost>('MiddlewareAndContextFacet');
export const migrationStateHost = new FacetHost<MigrationStateHost>('MigrationStateFacet');
export const referencesAndMasterDetailHost = new FacetHost<ReferencesAndMasterDetailHost>('ReferencesAndMasterDetailFacet');
export const registrationHost = new FacetHost<RegistrationHost>('RegistrationFacet');
export const secretsAndRoutingHost = new FacetHost<SecretsAndRoutingHost>('SecretsAndRoutingFacet');
export const securityResolversHost = new FacetHost<SecurityResolversHost>('SecurityResolversFacet');
export const summariesAndExpansionHost = new FacetHost<SummariesAndExpansionHost>('SummariesAndExpansionFacet');
export const transactionsSectionHost = new FacetHost<TransactionsSectionHost>('TransactionsSectionFacet');
