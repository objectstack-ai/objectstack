// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Summary indexes, related-record expansion, file and reference hydration"
 * section of `ObjectQL`: the bodies of `invalidateSummaryIndex`,
 * `buildSummaryIndex`, `ensureSummaryIndexes`, `getSummaryDescriptors`,
 * `summaryForeignKeyColumns`, `getOwnedSummaryDescriptors`,
 * `initializeSummaryFields`, `recomputeSummaries`, `expandRelatedRecords` moved
 * out of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link SummariesAndExpansionFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link SummariesAndExpansionHost}: exactly
 * the `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `summariesAndExpansionHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
 *
 * `ObjectQL` here is `ObjectQLStatics` (imported AS `ObjectQL`): forwarders to the
 * statics the bodies read, private ones included, which the class fills in a
 * static block; the class as a type is `ObjectQLClass`.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { REFERENCE_VALUE_TYPES, referenceCarrierOf, referenceTargetOf } from '@objectstack/spec/data';
import type { QueryAST, ServiceObject } from '@objectstack/spec/data';
import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { withTransientRetry } from '@objectstack/core';
import type { SummaryRecomputeFailure } from './summary-errors.js';
import { aggregateSummaryValue, summaryEmptySetValue } from './summary-aggregate.js';
import type { SummaryDescriptor } from './summary-aggregate.js';
import { ENGINE_WIRE_ONLY_SLOTS, WIRE_ONLY_CANONICAL_SHAPES } from './engine-top-level.js';
import { ObjectQLStatics as ObjectQL } from './engine.js';
import type { ObjectQL as ObjectQLClass } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link SummariesAndExpansionFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface SummariesAndExpansionHost {
  readonly _registry: ObjectQLClass['_registry'];
  buildSummaryIndex: ObjectQLClass['buildSummaryIndex'];
  ensureSummaryIndexes: ObjectQLClass['ensureSummaryIndexes'];
  expandRelatedRecords: ObjectQLClass['expandRelatedRecords'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQLClass;
  find: ObjectQLClass['find'];
  getOwnedSummaryDescriptors: ObjectQLClass['getOwnedSummaryDescriptors'];
  getSummaryDescriptors: ObjectQLClass['getSummaryDescriptors'];
  invalidateSummaryIndex: ObjectQLClass['invalidateSummaryIndex'];
  readonly logger: ObjectQLClass['logger'];
  serveReferenceNames: ObjectQLClass['serveReferenceNames'];
  summaryIndex: ObjectQLClass['summaryIndex'];
  summaryIndexByParent: ObjectQLClass['summaryIndexByParent'];
  summaryIndexRevision: ObjectQLClass['summaryIndexRevision'];
  readonly summaryRetryOptions: ObjectQLClass['summaryRetryOptions'];
  update: ObjectQLClass['update'];
}

/** The bodies of the "Summary indexes, related-record expansion, file and reference hydration" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class SummariesAndExpansionFacet {
  /** Invalidate the cached roll-up summary index (call when metadata changes). */
  static invalidateSummaryIndex(this: Pick<SummariesAndExpansionHost, 'summaryIndex' | 'summaryIndexByParent'>): void {
    this.summaryIndex = null;
    this.summaryIndexByParent = null;
  }

  /** Scan all registered objects for `summary` fields and index them BOTH ways
   *  — by the child object they aggregate and by the parent object that owns
   *  them — resolving the child→parent FK field. One scan, two views of the
   *  identical descriptor objects, so the two indexes can never disagree about
   *  which roll-ups exist.
   *
   *  [#9154] The registry read PROPAGATES. It used to be
   *  `try { (registry as any).getAllObjects?.() ?? [] } catch { [] }`, which
   *  answered a read that could not run with an invented *"no object declares a
   *  roll-up"* — the same shape #8895 ruled on (*discriminate or propagate*)
   *  and #9002 removed from the two delete-cascade seams, and there is no
   *  benign failure class to discriminate here either: an unreadable registry
   *  is never truthfully "no roll-ups". An empty index means
   *  {@link recomputeSummaries} recomputes nothing after every insert / update
   *  / delete, so every parent summary field keeps a stale value while every
   *  write reports success and nothing is logged.
   *
   *  Both halves of the swallow are gone, not just the `catch`: the optional
   *  call `?.()` absorbed a registry that does not implement `getAllObjects` at
   *  all — the same structural omission a test double really did ship, and one
   *  that is invisible precisely because it never throws. A plain call fails
   *  loudly on it.
   *
   *  ⚠️ This is a STRUCTURAL close, not a live defect: `SchemaRegistry`'s
   *  `getAllObjects()` is a walk over in-memory `Map`s calling `resolveObject()`
   *  — which returns `undefined` on every failure branch it models — over a
   *  fold that is spreads and comparisons. No I/O, no driver, no `throw` on the
   *  measured path. The pin lives in
   *  `engine-summary-index-registry-read-failure.test.ts`.
   *
   *  [#19082] The SECOND way this one function invented *"nothing to
   *  recompute"* — a different input, the same outcome. The child→parent FK
   *  was resolved by comparing the child field's `reference` carrier to the
   *  parent's name, so a carrier no reader can read (a non-string where
   *  `FieldSchema.reference` declares an optional string) compared false
   *  against every name, `fkField` stayed unset, and the `continue` below
   *  dropped a DECLARED roll-up out of both indexes with nothing logged.
   *
   *  ⛔ The fix is NOT a looser comparison — that would trade a silent
   *  stall for a MIS-MATCHED foreign key, which is more expensive. The
   *  carrier is read through the one arbiter and the skip now SAYS SO, at
   *  `error` (a persisted summary silently stops tracking its children while
   *  every write keeps reporting success — the durability class). Absence and
   *  every readable carrier behave exactly as before; the resolution rule
   *  itself is deliberately left where PR #18503's C2 boundary put it. Pinned
   *  in `engine-summary-index-unreadable-carrier.test.ts`, both directions. */
  static buildSummaryIndex(this: Pick<SummariesAndExpansionHost, '_registry' | 'logger'>): {
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

  /**
   * Ensure both roll-up indexes are present and current. Split out of
   * {@link getSummaryDescriptors} so the parent-side view (#5749) shares the
   * exact same staleness rule instead of re-deriving one.
   *
   * ## [#9154] A failed build leaves NO cache entry — *a poisoned cache entry
   * must not survive the read that poisoned it*
   *
   * This is the limb that made the swallow removed from
   * {@link buildSummaryIndex} worse than its two #9002 siblings. Those invented
   * an answer ONCE, per delete. Here the answer is MEMOIZED and stamped with the
   * registry's current `objectRevision` — so one failed read did not degrade one
   * write, it installed an empty index that every subsequent write then read as
   * a measured answer. And `objectRevision` moves only on a metadata MUTATION
   * (`registerObject`, `unregisterObject`, `unregisterObjectsByPackage`,
   * `removeObjectOverlay`, `invalidate`, `invalidateAll`, `reset`) — never on a
   * data write. A steady-state deployment performs none of those, so the
   * invented emptiness outlived its cause for the whole process lifetime,
   * ending only at a restart or at an unrelated publish. The failure was not
   * "briefly wrong"; it was wrong until an unrelated event.
   *
   * Two things hold the invariant, and both are load-bearing — do not reorder:
   *
   *  1. the build runs to completion into a LOCAL before anything is published
   *     to `this`, so a throw cannot leave a half-written pair of indexes, and
   *     the revision stamp is written LAST — an unstamped failure is retried on
   *     the very next call rather than being remembered as an answer;
   *  2. the `catch` below clears whatever was cached and resets the stamp before
   *     rethrowing. Behaviourally that is a no-op today (nothing reads the
   *     fields without coming through here first, and the stale entry would be
   *     rebuilt anyway) — it is here so the guarantee is stated in code instead
   *     of resting on the survey in (1). ⛔ It swallows nothing: the error is
   *     rethrown unchanged, and `engine-summary-index-registry-read-failure.test.ts`
   *     pins both the propagation and the retry.
   */
  static ensureSummaryIndexes(this: Pick<SummariesAndExpansionHost, '_registry' | 'buildSummaryIndex' | 'invalidateSummaryIndex' | 'summaryIndex' | 'summaryIndexByParent' | 'summaryIndexRevision'>): void {
    // Rebuild whenever the REGISTRY's object set has moved since the index was
    // built — not only when someone remembered to call
    // `invalidateSummaryIndex`. That single site (`registerApp`) is bypassed by
    // the runtime publish path, which registers straight into the registry
    // (`protocol.saveMetaItem` → `registry.registerObject`). A kernel that had
    // already done one write — publishing itself writes `sys_metadata` — held an
    // index built before the new object existed, so every child write of a
    // freshly published roll-up skipped the recompute and the parent read null
    // until the process restarted. That is exactly how an AI-built app's
    // "已完成任务数" shipped empty over correct metadata (cloud#970).
    const revision = (this._registry as unknown as { objectRevision?: number })?.objectRevision;
    const stale = typeof revision === 'number' && revision !== this.summaryIndexRevision;
    if (!this.summaryIndex || !this.summaryIndexByParent || stale) {
      let built: { byChild: Map<string, SummaryDescriptor[]>; byParent: Map<string, SummaryDescriptor[]> };
      try {
        built = this.buildSummaryIndex();
      } catch (err) {
        // [#9154] Nothing measured came back, so nothing is remembered — not
        // even the entry that was already here, which the staleness test above
        // has just judged out of date. The next call rebuilds from scratch.
        this.invalidateSummaryIndex();
        this.summaryIndexRevision = -1;
        throw err;
      }
      this.summaryIndex = built.byChild;
      this.summaryIndexByParent = built.byParent;
      if (typeof revision === 'number') this.summaryIndexRevision = revision;
    }
  }

  /** Roll-up descriptors for summaries that aggregate `childObject` — i.e. the
   *  ones a write to `childObject` must recompute. Semantics unchanged. */
  static getSummaryDescriptors(this: Pick<SummariesAndExpansionHost, 'ensureSummaryIndexes' | 'summaryIndex'>, childObject: string): SummaryDescriptor[] {
    this.ensureSummaryIndexes();
    return this.summaryIndex!.get(childObject) ?? [];
  }

  /** [#26950] The child-side foreign-key columns the roll-ups over
   *  `childObject` read: what a predicate write must read off its matched rows,
   *  before it writes, to hand {@link recomputeSummaries} the parents to
   *  recompute. Empty when no roll-up aggregates `childObject`. */
  static summaryForeignKeyColumns(this: Pick<SummariesAndExpansionHost, 'getSummaryDescriptors'>, childObject: string): string[] {
    return [...new Set(this.getSummaryDescriptors(childObject).map((desc) => desc.fkField))];
  }

  /** The body of `ObjectQL#getOwnedSummaryDescriptors`; the method's docblock there is its contract. */
  static getOwnedSummaryDescriptors(this: Pick<SummariesAndExpansionHost, 'ensureSummaryIndexes' | 'summaryIndexByParent'>, parentObject: string): SummaryDescriptor[] {
    this.ensureSummaryIndexes();
    return this.summaryIndexByParent!.get(parentObject) ?? [];
  }

  /**
   * Seed the roll-up `summary` fields a freshly-created row owns (#5749).
   *
   * `recomputeSummaries` only ever visits parents named by a child write, so a
   * parent that has NEVER had a child is never visited and its summary column
   * keeps whatever insert put there — `null`. Delete the last child and the
   * parent DOES get visited (via `previous`) and lands on 0. Same logical state,
   * two different values: `filter ["task_count","=",0]` silently skipped every
   * parent that never had a child, and so did sorting, GROUP BY and any formula
   * reading the field (null propagation).
   *
   * The fix is at the producer: write the empty-collection value at create time,
   * so `count`/`sum` start at 0 and only ever move to another number.
   * `min`/`max`/`avg` have no empty-set value and deliberately stay `null` —
   * {@link summaryEmptySetValue} is the single list both this and the recompute
   * fallback read.
   *
   * Author-supplied values are never overwritten. The `!= null` test matches
   * {@link applyFieldDefaults} exactly (#2706): on INSERT an explicit `null` is
   * "no value supplied", any real value — including a deliberate 0 or a seeded
   * count — is respected. Runs before the `beforeInsert` hooks for the same
   * reason defaults do, so a hook still has the final say.
   *
   * Existing rows are untouched: this is create-time only, so parents already
   * stored with `null` stay `null` until a child write recomputes them.
   */
  static initializeSummaryFields(this: Pick<SummariesAndExpansionHost, 'getOwnedSummaryDescriptors'>, object: string, record: any): any {
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

  /**
   * Recompute roll-up `summary` fields on parent records after a child write.
   * For each affected parent (the FK value on the changed/old child record), it
   * aggregates the child collection and writes the result onto the parent's
   * summary field. Runs in the caller's execution context — SYSTEM-ELEVATED,
   * see below — so it joins the same transaction (e.g. the cross-object batch)
   * when one is open.
   *
   * # Why the recompute is system-elevated (#7673)
   *
   * A roll-up is ENGINE-DERIVED state on the parent, not a caller write to it.
   * The permission decision that matters — may this caller write the CHILD —
   * has already been made by the time we get here; whether
   * `showcase_project.task_count` may be refreshed is not a question about the
   * caller's grant on `showcase_project`.
   *
   * Passing the caller's own context straight through made it one, and the
   * ordinary parent/child shape — a child more widely writable than its parent
   * (tasks, line items, comments, time entries) — broke on it in three
   * separate ways, all of them fail-open:
   *
   *   1. **A granted child write returned 500 after the row was written.** The
   *      parent update raised `PermissionDeniedError`, which this method
   *      recorded as a failure and the three call sites then threw as
   *      `SummaryRecomputeError` — mapped to a 500 by REST, on a write that had
   *      already COMMITTED. A client that retried created a duplicate row
   *      (#7673 / #7719, measured on `examples/app-showcase`: a plain member
   *      holding `showcase_task: create + read` 500'd on every POST and PATCH).
   *   2. **The aggregate was computed from the caller's VISIBLE subset.** Where
   *      the caller COULD write the parent, the recompute succeeded and stored
   *      an RLS-scoped count — a parent column silently rewritten to one
   *      reader's view of the child collection. A roll-up is a property of the
   *      parent, never of whoever happened to touch a child.
   *   3. **An author-declared `readonly: true` roll-up column was stripped.**
   *      The write-path read-only strip runs on `!context.isSystem`, and the
   *      recompute's payload is "caller supplied" from its point of view, so
   *      the summary silently never landed.
   *
   * Elevation is a `sudo()`-shaped derivative of the caller's context
   * (`{ ...execCtx, isSystem: true }`), NOT a bare `{ isSystem: true }`: the
   * open transaction handle, `tenantId` and `timezone` must survive, or the
   * recompute leaves the caller's transaction and stops being tenant-scoped.
   * That makes this the same posture the roll-up's two OTHER writers already
   * hold — `initializeSummaryFields` runs inside the engine's own insert, and
   * `backfillSummaryNulls` (#6063) elevates explicitly — so all three writers
   * of a summary column now agree about who owns it.
   *
   * What this does NOT do: it never widens what the caller may read or write.
   * The parent's own row stays governed by the caller's grants (a direct
   * `update` of the parent is refused exactly as before), the summary field
   * stays subject to the parent's FLS on read, and the only value this path can
   * move is the one the author DECLARED as a function of the child collection.
   */
  static async recomputeSummaries(this: Pick<SummariesAndExpansionHost, 'facade' | 'getSummaryDescriptors' | 'logger' | 'summaryRetryOptions' | 'update'>, childObject: string, records: any, previous: any, execCtx?: ExecutionContext): Promise<SummaryRecomputeFailure[]> {
    const descriptors = this.getSummaryDescriptors(childObject);
    if (descriptors.length === 0) return [];
    // The elevation described above. Built once per call, spread from the
    // caller's context so transaction / tenant / timezone ride along.
    const systemCtx = { ...(execCtx ?? {}), isSystem: true } as ExecutionContext;
    const recs = Array.isArray(records) ? records : records ? [records] : [];
    const prevs = Array.isArray(previous) ? previous : previous ? [previous] : [];
    const failures: SummaryRecomputeFailure[] = [];
    for (const desc of descriptors) {
      const ids = new Set<string>();
      for (const r of recs) { const v = r?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const p of prevs) { const v = p?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const parentId of ids) {
        try {
          // Retry a transient failure (a turso `fetch failed` on the parent
          // aggregate/update) with backoff — a network blip here used to leave
          // the parent summary silently stale (framework#3147).
          await withTransientRetry(async () => {
            // The aggregate — parent-FK match ANDed with the optional
            // per-summary filter, empty-set fallback included — is
            // `aggregateSummaryValue` (#6063). Behaviour unchanged; it simply
            // lives where the insert-time seed and the one-off NULL backfill
            // can read the identical computation instead of copying it.
            const value = await aggregateSummaryValue(this.facade, desc, parentId, systemCtx);
            await this.update(desc.parentObject, { id: parentId, [desc.summaryField]: value }, { context: systemCtx } as any);
          }, this.summaryRetryOptions);
        } catch (err) {
          // Retries exhausted (or a non-transient failure). Record it so the
          // caller can surface it — one parent's failure must not abort the
          // remaining parents' recompute.
          this.logger.warn('Roll-up summary recompute failed', {
            childObject, parentObject: desc.parentObject, parentId, field: desc.summaryField,
            error: (err as any)?.message,
          });
          failures.push({ childObject, parentObject: desc.parentObject, parentId, field: desc.summaryField, error: err });
        }
      }
    }
    return failures;
  }

  /**
   * Post-process expand: resolve lookup/master_detail fields by batch-loading related records.
   * 
   * This is a driver-agnostic implementation that uses secondary queries ($in batches)
   * to load related records, then injects them into the result set.
   * 
   * @param objectName - The source object name
   * @param records - The records returned by the driver
   * @param expand - The expand map from QueryAST (field name → nested QueryAST)
   * @param depth - Current recursion depth (0-based)
   * @returns Records with expanded lookup fields (IDs replaced by full objects)
   */
  static async expandRelatedRecords(this: Pick<SummariesAndExpansionHost, '_registry' | 'expandRelatedRecords' | 'find' | 'logger' | 'serveReferenceNames'>, objectName: string, records: any[], expand: Record<string, QueryAST>, depth: number = 0, execCtx?: ExecutionContext): Promise<any[]> {
    if (!records || records.length === 0) return records;
    if (depth >= ObjectQL.MAX_EXPAND_DEPTH) return records;

    const objectSchema = this._registry.getObject(objectName);
    // If no schema registered, skip expand — return raw data
    if (!objectSchema || !objectSchema.fields) return records;

    for (const [fieldName, nestedAST] of Object.entries(expand)) {
      // [#4371] The nested AST is caller-authored too: a wire spelling inside
      // `expand: { rel: { sort } }` used to be silently dropped exactly like
      // the top-level bag (this loop reads only canonical keys). Same
      // rejection, scoped to the four wire-only pairs — the nested shape is a
      // QueryAST, not an option bag, so the option-key gate does not apply.
      if (nestedAST && typeof nestedAST === 'object') {
        for (const slot of ENGINE_WIRE_ONLY_SLOTS) {
          for (const alias of slot.aliases) {
            if ((nestedAST as Record<string, unknown>)[alias] != null) {
              throw new Error(
                `expand['${fieldName}'] on '${objectName}' does not accept '${alias}': it is a wire ` +
                `spelling of '${slot.canonical}', folded by the RPC/protocol layer — a direct engine ` +
                `call bypasses that fold, so the value would be silently dropped, not applied. Pass ` +
                `'${slot.canonical}' (${WIRE_ONLY_CANONICAL_SHAPES[slot.canonical] ?? 'the canonical QueryAST shape'}) instead.`,
              );
            }
          }
        }
      }
      const fieldDef = objectSchema.fields[fieldName];

      // Skip if field not found or not a relationship type.
      //
      // `user` is a lookup specialized to sys_user and `tree` is a hierarchical
      // self-reference — both carry the same `reference` + id storage, so both
      // expand through this exact path (single or multiple).
      //
      // [#4226] The membership test is `REFERENCE_VALUE_TYPES` — the spec's own
      // list of types whose value "points at another record … the related record
      // object in expanded form" — rather than a hand-copied `!==` chain. The
      // chain had drifted: it omitted `tree`, so a `$expand` of a hierarchy
      // field returned the raw parent id and rendered as a bare placeholder,
      // while `field-value.zod.ts` and objectui's `EXPANDABLE_FIELD_TYPES` both
      // declared it expandable. Reading the shared set is what stops the
      // protocol's expand gate (which validates against the same set) from ever
      // admitting a field this loop then silently skips.
      //
      // [cloud#983] The TARGET comes from `referenceTargetOf` for that same
      // anti-drift reason. A raw `fieldDef.reference` read made `{ type:
      // 'user' }` (no `reference`) targetless here AND at the gate — but
      // `user`'s target is fixed BY THE TYPE (`sys_user`; `Field.user()` takes
      // no target argument), so the field was fully specified and the request
      // was refused `400 … declares no target object`. Both sides now ask the
      // one function what a reference field points at.
      if (!fieldDef) continue;
      if (!REFERENCE_VALUE_TYPES.has(fieldDef.type)) continue;
      const referenceObject = referenceTargetOf(fieldDef);
      if (!referenceObject) continue;
      // [#24358] ⛔ A reference into the stored-metadata-body family is never
      // expanded, at any depth and for any caller. The family's projection runs
      // at its doors and only for the object a request names, so this sub-read
      // would nest the stored body and its content hash unprojected under the
      // requested rows — material the family's own door withholds from the same
      // reader. The field keeps the stored id, the answer a reference the
      // caller may not expand gets (an unexposed target, #22661, or a refused
      // sub-read, below), so it says nothing about the row.
      if (isStoredMetadataBodyObject(referenceObject)) continue;

      // Collect all foreign key IDs from records (handle both single and multiple values)
      const allIds: any[] = [];
      for (const record of records) {
        const val = record[fieldName];
        if (val == null) continue;
        if (Array.isArray(val)) {
          allIds.push(...val.filter((id: any) => id != null));
        } else if (typeof val === 'object') {
          // Already expanded — skip
          continue;
        } else {
          allIds.push(val);
        }
      }

      // De-duplicate IDs
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length === 0) continue;

      // Batch-load related records using $in query
      try {
        // Constrain the batch to the collected FK ids. When the nested expand
        // AST carries its own `where`, AND-merge it via an explicit `$and`
        // group rather than spreading keys onto the id filter: a shallow spread
        // would clobber the `id` constraint (if the nested filter also keys
        // `id`) and is ambiguous when the nested filter is a top-level `$or` /
        // `$and`. The `$and` wrapper is correct for every FilterCondition shape.
        const idFilter = { id: { $in: uniqueIds } };
        const where = nestedAST.where
          ? { $and: [idFilter, nestedAST.where] }
          : idFilter;

        // [#2850] Resolve the referenced object through the engine's own read
        // path (`this.find`) rather than the raw driver, so the security
        // middleware applies the REFERENCED object's RLS + FLS to the expanded
        // batch — not merely tenant isolation. A single `find` over the
        // collected `id $in [...]` batch re-enters the middleware exactly once
        // (no N+1), preserving the batched load. `nestedAST.limit/offset` are
        // still intentionally NOT forwarded: this path batch-loads every
        // parent's related records in one query, so a *per-parent* limit/offset
        // can't be expressed — a global cap would silently drop records other
        // parents need. Paginate by querying the related object directly.
        //
        // The `__expandRead` marker (set here, never from client input —
        // `executionContext` is server-built) tells the security layer this is
        // an expansion sub-read. It does NOT relax that layer: since #7626 the
        // referenced object takes the FULL treatment — CRUD gate,
        // requiredPermissions, RLS and FLS — so you may expand only rows you
        // could have read directly. (#2850 shipped a waiver for "public"
        // referenced objects; it keyed on an axis almost no object declares and
        // never checked the caller's grants, so it disclosed private records to
        // callers the gate had already refused.) A refusal is caught below and
        // the bare FK id is retained, which is why the parent read still
        // succeeds. `expand` is intentionally omitted from this query so `find`
        // does not re-expand — nested relations recurse below under the depth
        // guard.
        //
        // [#7537] The join key is MACHINERY, not a caller-chosen column. This
        // sub-read's projection is forwarded from `nestedAST.fields`, and the
        // map built below is keyed on `rec.id` — so a nested projection that did
        // not name `id` returned rows carrying no `id`, built an EMPTY map, and
        // fell through the `recordMap.get(...) ?? val` injection, writing the
        // original foreign key back. The expansion was then indistinguishable
        // from never having been requested: `200`, and the field still holds a
        // valid-looking id.
        //
        // The failing spelling is the one the platform itself PRESCRIBES: both
        // `FIELD_NODE_OBJECT_FORM_REMOVED` and `QUERY_JOINS_REMOVED`
        // (`query.zod.ts`) tell authors migrating off the retired nested-select
        // object form and off `query.joins` to write
        // `expand: { owner: { object: 'user', fields: ['name'] } }`. Refusing the
        // mismatch would turn two retirement messages' own migration target into
        // an error, so the prescribed form is made to WORK instead: `id` is added
        // to the sub-read unconditionally and stripped back out of the emitted
        // nested record when the caller did not ask for it.
        //
        // `id` is the only join key there is, literally: `referenceTargetOf`
        // yields the target OBJECT and a reference field carries no
        // target-column metadata, so the batch filter above is `{ id: { $in } }`
        // by construction. There is no configurable key to add instead.
        //
        // Only a driver that honours a projection exactly could ever show this —
        // `SqlDriver` emits `builder.select(query.fields)` verbatim, while
        // `InMemoryDriver.projectFields` force-adds `id` to every projection,
        // which is why mock/in-memory suites could not reach the defect and a
        // better-sqlite3 QA run (#7463) could.
        const nestedFields = Array.isArray(nestedAST.fields) && nestedAST.fields.length > 0
          ? nestedAST.fields
          : undefined;
        const joinKeyRequested = !nestedFields || nestedFields.includes('id');
        const relatedRecords = await this.find(
          referenceObject,
          {
            where,
            // [commit 74155c735] The `as any` these two carried is gone: `find` takes the
            // author state now, and the parsed nodes a `QueryAST` holds are
            // valid author input (a present `order` is legal to write).
            ...(nestedAST.fields
              ? { fields: joinKeyRequested ? nestedAST.fields : [...nestedFields!, 'id'] }
              : {}),
            ...(nestedAST.orderBy ? { orderBy: nestedAST.orderBy } : {}),
            context: { ...(execCtx ?? {}), __expandRead: true } as ExecutionContext,
          },
        ) ?? [];

        // Build a lookup map: id → record
        const recordMap = new Map<string, any>();
        for (const rec of relatedRecords) {
          const id = rec.id;
          if (id != null) recordMap.set(String(id), rec);
        }

        // Recursively expand nested relations if present
        if (nestedAST.expand && Object.keys(nestedAST.expand).length > 0) {
          const expandedRelated = await this.expandRelatedRecords(
            referenceObject,
            relatedRecords,
            nestedAST.expand,
            depth + 1,
            execCtx,
          );
          // Rebuild map with expanded records
          recordMap.clear();
          for (const rec of expandedRelated) {
            const id = rec.id;
            if (id != null) recordMap.set(String(id), rec);
          }
        }

        // [#7537] Strip the join key back out when the caller did not name it.
        // It was added above for THIS function's own lookup, so the emitted
        // nested record carries exactly the columns the projection asked for —
        // the same contract a top-level `fields` gets. Deliberately AFTER the
        // recursive expand: that block rebuilds `recordMap` keyed on `rec.id`
        // and still needs the key present. Each related record is stripped once
        // here rather than per-parent, because one record object is injected
        // into every parent that points at it.
        if (!joinKeyRequested) {
          for (const rec of recordMap.values()) {
            if (rec && typeof rec === 'object') delete rec.id;
          }
        }

        // Inject expanded records back into the original result set
        for (const record of records) {
          const val = record[fieldName];
          if (val == null) continue;

          if (Array.isArray(val)) {
            record[fieldName] = val.map((id: any) => recordMap.get(String(id)) ?? id);
          } else if (typeof val !== 'object') {
            record[fieldName] = recordMap.get(String(val)) ?? val;
          }
          // If val is already an object, leave it as-is
        }
      } catch (e) {
        // Graceful degradation: if expand fails, keep original IDs
        this.logger.warn('Failed to expand relationship field; retaining foreign key IDs', {
          object: objectName,
          field: fieldName,
          reference: referenceObject,
          error: (e as Error).message,
        });
      }

      // [#29460] `referenceNameVisible` (ruling 6574398310, letter B): the ids
      // the caller's own expansion above left bare are asked whether the
      // caller was REFUSED them, and a refused target is served by its name
      // and id only. Every other value keeps the answer the loop gave it. See
      // {@link serveReferenceNames}.
      if ((fieldDef as { referenceNameVisible?: unknown }).referenceNameVisible === true) {
        await this.serveReferenceNames(objectName, records, fieldName, referenceObject, execCtx);
      }
    }

    return records;
  }
}
