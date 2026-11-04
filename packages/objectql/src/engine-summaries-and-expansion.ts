// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Summary indexes, related-record expansion, file and reference hydration"
 * section of `ObjectQL`: the bodies of `buildSummaryIndex`,
 * `initializeSummaryFields` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link SummariesAndExpansionHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { referenceCarrierOf } from '@objectstack/spec/data';
import type { ServiceObject } from '@objectstack/spec/data';
import { summaryEmptySetValue } from './summary-aggregate.js';
import type { SummaryDescriptor } from './summary-aggregate.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface SummariesAndExpansionHost {
  readonly _registry: ObjectQL['_registry'];
  getOwnedSummaryDescriptors: ObjectQL['getOwnedSummaryDescriptors'];
  readonly logger: ObjectQL['logger'];
}

/** The body of `ObjectQL#buildSummaryIndex`; the method's docblock there is its contract. */
export function buildSummaryIndex(this: Pick<SummariesAndExpansionHost, '_registry' | 'logger'>): {
    byChild: Map<string, SummaryDescriptor[]>;
    byParent: Map<string, SummaryDescriptor[]>;
  } {
    const index = new Map<string, SummaryDescriptor[]>();
    const byParent = new Map<string, SummaryDescriptor[]>();
    const objects: ServiceObject[] = this._registry.getAllObjects();
    for (const parent of objects as any[]) {
      const fields = parent?.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
      for (const [summaryField, def] of Object.entries(fields)) {
        const d: any = def;
        if (d?.type !== 'summary' || !d.summaryOperations) continue;
        const so = d.summaryOperations;
        const childObject = so.object;
        const fn = so.function;
        if (!childObject || !fn) continue;
        // Resolve the FK on the child pointing back to this parent.
        let fkField: string | undefined = so.relationshipField;
        // [#19082] Candidate relation fields on the child whose `reference`
        // carrier no reader can read, spelled `<child>.<field>`. Collected
        // rather than thrown on — see the two comments below.
        const unreadableCarriers: string[] = [];
        if (!fkField) {
          const child = this._registry.getObject(childObject) as any;
          const cfields = child?.fields || {};
          for (const [cfName, cdef] of Object.entries(cfields)) {
            const cd: any = cdef;
            if (cd?.type !== 'master_detail' && cd?.type !== 'lookup') continue;
            // [#19082] The carrier is read through the ONE arbiter, the same
            // one {@link ObjectQL.planCascadeAtomicity} and
            // {@link ObjectQL.cascadeDeleteRelations} were routed through —
            // but its refusal is CAUGHT here instead of propagated, for a
            // reason those two seams do not have: this is a SCAN over every
            // relation field on the child, looking for the one that points
            // back. Letting the first unreadable carrier throw would hide a
            // perfectly readable sibling that IS the foreign key, turning a
            // roll-up that works today into a hard failure of every write.
            // The three answers stay distinct:
            //
            //  - ABSENCE (`undefined` / `null` / `''`) is unchanged and still
            //    silent — `referenceCarrierOf` answers `undefined` for all
            //    three, this `continue` skips the field, and a field that
            //    names no target is a legal thing to declare.
            //  - A READABLE carrier compares exactly as `cd.reference ===
            //    parent.name` compared it, so every roll-up that resolved
            //    before resolves now.
            //  - UNREADABILITY is recorded, and it is what the skip below
            //    stops being silent about.
            let carrier: string | undefined;
            try {
              carrier = referenceCarrierOf(cd, 'ObjectQL.buildSummaryIndex');
            } catch {
              unreadableCarriers.push(`${childObject}.${cfName}`);
              continue;
            }
            if (carrier === parent.name) {
              fkField = cfName;
              break;
            }
          }
        }
        if (!fkField) {
          // [#19082] The skip is unchanged; its SILENCE is what ends here.
          //
          // An unreadable carrier compares false against every name, so
          // `fkField` stayed unset and this `continue` dropped a DECLARED
          // roll-up out of both indexes with no diagnostic anywhere — the
          // second way this one function invents "nothing to recompute" (the
          // first, the registry read, is #9154 above). It is a durability
          // degradation by the repo's own test: every write keeps reporting
          // success while a persisted summary value silently stops tracking
          // its children, so it is an `error`, not a `warn`, and it owes both
          // the consequence and the fix in the line it prints.
          //
          // Said once per INDEX BUILD, never once per write:
          // {@link ensureSummaryIndexes} memoises the result against the
          // registry's `objectRevision`, which moves only on a metadata
          // mutation. And only the unreadable case speaks — a roll-up whose
          // child genuinely declares no relation field at all is a different
          // (and much louder at authoring time) condition, left exactly as it
          // was rather than widened into here.
          if (unreadableCarriers.length > 0) {
            const msg =
              `[summary-index] ${parent.name}.${summaryField} is NOT indexed and will NOT recompute: `
              + `its roll-up over '${childObject}' has no resolvable foreign key, because `
              + `${unreadableCarriers.length} candidate relation field(s) on '${childObject}' carry a `
              + `\`reference\` no reader can read (${unreadableCarriers.join(', ')}). `
              + `\`FieldSchema.reference\` is an optional STRING — the target object's name — and a `
              + `non-string carrier is refused by \`ObjectSchema.safeParse\`, so such a definition `
              + `reached this registry around the parse seam (a raw \`registerObject\`, or a metadata `
              + `row stored before that tightening). CONSEQUENCE: ${parent.name}.${summaryField} keeps `
              + `whatever value it holds now through EVERY insert / update / delete of '${childObject}', `
              + `while every one of those writes reports success and nothing else reports this. FIX: `
              + `spell the carrier as the target object name (reference: '${parent.name}') on the `
              + `child's master_detail/lookup field, or name the foreign key explicitly with `
              + `summaryOperations.relationshipField on ${parent.name}.${summaryField}.`;
            // Sanctioned logger shape (PR #9750): reach for `error`, fall back
            // to `warn` — ⛔ never an optional call like `logger.error?.()`,
            // which emits nothing against a sink that has no `error`.
            if (typeof this.logger.error === 'function') this.logger.error(msg);
            else this.logger.warn(msg);
          }
          continue; // can't resolve the relationship — skip
        }
        // Optional per-summary predicate: only child rows matching it are
        // aggregated (e.g. sum receipts where { status: 'received' }). ANDed with
        // the parent-FK match at recompute time. Ignore a non-object filter.
        const filter = so.filter && typeof so.filter === 'object' && !Array.isArray(so.filter)
          ? so.filter as Record<string, unknown>
          : undefined;
        const descriptor: SummaryDescriptor = {
          parentObject: parent.name, summaryField, childObject, fkField, fn, sourceField: so.field, filter,
        };
        const list = index.get(childObject) ?? [];
        list.push(descriptor);
        index.set(childObject, list);
        // Same descriptor, parent-side view. Only descriptors that made it this
        // far are indexed either way, so "seeded at insert" and "maintained by
        // recompute" are the same set by construction — a roll-up whose
        // relationship could not be resolved (the `continue` above) is left
        // untouched on both paths rather than seeded with a 0 nothing updates.
        const owned = byParent.get(parent.name) ?? [];
        owned.push(descriptor);
        byParent.set(parent.name, owned);
      }
    }
    return { byChild: index, byParent };
  }

/** The body of `ObjectQL#initializeSummaryFields`; the method's docblock there is its contract. */
export function initializeSummaryFields(this: Pick<SummariesAndExpansionHost, 'getOwnedSummaryDescriptors'>, object: string, record: any): any {
    const descriptors = this.getOwnedSummaryDescriptors(object);
    if (descriptors.length === 0) return record;
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    let out: Record<string, unknown> = record;
    for (const desc of descriptors) {
      const seed = summaryEmptySetValue(desc.fn);
      if (seed == null) continue; // min/max/avg — undefined on an empty set
      if (out[desc.summaryField] != null) continue; // author supplied a value
      if (out === record) out = { ...record };
      out[desc.summaryField] = seed;
    }
    return out;
  }
