// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Registration seams, readable-ids security, formula and default permissions"
 * section of `ObjectQL`: the bodies of `refuseUncomposableReadableIdsClasses`,
 * `resolveFormulaRelated` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link SecurityResolversHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { referenceTargetOf } from '@objectstack/spec/data';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { describeReadableIdsLeaf, readableIdsRefusalError } from './filter-comparand-shape.js';
import type { ComposableReadableIdsSite } from './filter-comparand-shape.js';
import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import { undeclaredRelatedFields } from './engine-top-level.js';
import type { FormulaPlanEntry, FormulaRelated } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface SecurityResolversHost {
  readonly _registry: ObjectQL['_registry'];
  readonly formulaHopReads: ObjectQL['formulaHopReads'];
  resolveOneHopRelated: ObjectQL['resolveOneHopRelated'];
  uncomposableReadableIdsParent: ObjectQL['uncomposableReadableIdsParent'];
}

/** The body of `ObjectQL#refuseUncomposableReadableIdsClasses`; the method's docblock there is its contract. */
export function refuseUncomposableReadableIdsClasses(this: Pick<SecurityResolversHost, '_registry' | 'uncomposableReadableIdsParent'>, object: string, operation: string, sites: readonly ComposableReadableIdsSite[]): string[] {
    const firstSite = new Map<string, ComposableReadableIdsSite>();
    for (const site of sites) if (!firstSite.has(site.leaf.object)) firstSite.set(site.leaf.object, site);
    const refuse = (site: ComposableReadableIdsSite, why: string): Error => readableIdsRefusalError(
      object,
      `${operation}('${object}'): ${describeReadableIdsLeaf(site.at, site.leaf)}, and the engine composes no ` +
      `such leaf ${why}. The query was NOT run and no driver was asked. Read this class through its bounded ` +
      'probe, chosen before the leaf is written.',
    );
    const composable: string[] = [];
    for (const [parent, site] of firstSite) {
      // A parent the registry does not hold has no record anyone may read:
      // its leaf is answered `$in: []` without asking anything, and it is in
      // none of D5's classes.
      if (!this._registry.getObject(parent)) continue;
      const uncomposable = this.uncomposableReadableIdsParent(object, parent);
      if (uncomposable?.class === 'object-scoped-read-middleware') {
        throw refuse(site, `over '${parent}', whose rows an object-scoped read middleware narrows: that WHERE is ` +
          `built at read time and is no part of its read scope, so the composed leaf would be wider than a read of '${parent}'`);
      }
      if (uncomposable?.class === 'other-datasource') {
        throw refuse(site, `over '${parent}', which is bound to datasource '${String(uncomposable.parentDatasource)}' while '${object}' is ` +
          `bound to '${String(uncomposable.objectDatasource)}': no driver evaluates a subquery across two datasources`);
      }
      composable.push(parent);
    }
    return composable;
  }

/** The body of `ObjectQL#resolveFormulaRelated`; the method's docblock there is its contract. */
export async function resolveFormulaRelated(this: Pick<SecurityResolversHost, '_registry' | 'formulaHopReads' | 'resolveOneHopRelated'>, schema: any, plan: readonly FormulaPlanEntry[], rows: ReadonlyArray<Record<string, unknown> | undefined | null>, context: unknown, query?: EngineQueryOptions): Promise<FormulaRelated | undefined> {
    const wanted = new Map<string, Set<string>>();
    for (const entry of plan) {
      if (entry.hopConflict) continue;
      for (const [fk, named] of entry.hops ?? []) {
        let set = wanted.get(fk);
        if (!set) wanted.set(fk, (set = new Set()));
        for (const name of named) set.add(name);
      }
    }
    if (wanted.size === 0) return undefined;
    if (query && this.formulaHopReads.has(query)) {
      return `this object was itself read one hop through a reference by another object's formula, and a `
        + 'formula resolves ONE hop: a formula read this way does not read through a reference of its own '
        + '(a second hop). Store the value on this object as a field of its own to read it from there';
    }
    // [#24410] The read set per reference is the UNION of every formula's
    // columns, and the loader answers a whole reference `undeclared-field` when
    // any column of it is undeclared — so one formula's misspelt column nulled
    // every sibling reading through the same reference. The undeclared columns
    // are taken out of the shared read here and judged per formula
    // ({@link formulaHopScope}); the loader reads the declared rest.
    const fields = (schema?.fields ?? {}) as Record<string, unknown>;
    const undeclared = new Map<string, { object: string; fields: ReadonlySet<string> }>();
    for (const [fk, named] of wanted) {
      const target = referenceTargetOf(fields[fk]);
      // The loader's own verdicts stand for these: no target, or a hop into
      // the stored-metadata-body family, which is never read.
      if (!target || isStoredMetadataBodyObject(target)) continue;
      const declared = (this._registry.getObject(target) as { fields?: Record<string, unknown> } | undefined)?.fields;
      const missing = undeclaredRelatedFields(declared, named);
      if (missing.length === 0) continue;
      undeclared.set(fk, { object: target, fields: new Set(missing) });
      for (const name of missing) named.delete(name);
      if (named.size === 0) wanted.delete(fk);
    }
    const lookup = wanted.size > 0
      ? await this.resolveOneHopRelated(schema, wanted, rows, context, 'caller')
      : () => undefined;
    return { bindings: (row) => lookup(row), undeclared };
  }
