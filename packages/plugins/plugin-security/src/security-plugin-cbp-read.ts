// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 2] The controlled-by-parent read derivation of `SecurityPlugin`,
 * moved out of `security-plugin.ts` whole: the ADR-0055 §1 master relation a
 * `controlled_by_parent` object derives its access from (with its two loud
 * reports, the unresolved master and the tolerated reference alias), the read
 * leaf composed from it (ADR-0139), and the chain refusal that cuts a cycle or
 * an over-deep chain to zero rows.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same derivation, the same cache, the same reports,
 * failing closed exactly where they did. The module-level declarations only
 * these bodies read moved with them, also unedited: `CBP_LEAF_READ_VERBS`,
 * `masterNotWritableRefusal`, and the imports below that `security-plugin.ts`
 * no longer needs. The write half of ADR-0055 (the master-write gate) is not
 * here; it stays in `security-plugin.ts` and reads this derivation through the
 * class's `resolveCbpRelation`, as before.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cut 1 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps every method — the published
 * `dist/*.d.ts` lists each one's name, docblock and position — and each body is
 * one literal of exactly the {@link CbpReadHost} members that method reads,
 * plus a `.call`. A method is handed over as a closure that calls it on the
 * plugin at call time, so a test double or spy set on the plugin is still the
 * one the body reaches, and the bodies that call one another (the derivation's
 * two reports, the read leaf's relation and chain refusal) do so through the
 * plugin, as before. Every function here is synchronous.
 *
 * Every field the bodies read goes as a GETTER, by the rule cut 1 set: none of
 * the three is declared `readonly`. `start()` assigns `ql` and `logger` after
 * construction, and `cbpRelCache` is a plain field the metadata watch clears in
 * place.
 *
 * Two declarations stay in `security-plugin.ts` and are read from there:
 *
 * - `CBP_MAX_CHAIN_DEPTH`, imported from it. ADR-0055 anchors that bound by
 *   symbol in `security-plugin.ts`, and the master-write gate there walks the
 *   same bound. The import is the one value binding this module takes from
 *   `security-plugin.ts`. It is read only inside function bodies, at call time,
 *   never while either module evaluates, so the two-way import is safe under
 *   ESM, and the published bundle holds one module.
 * - `CbpRelation`, named here through the class's own signature (below), so
 *   the interface keeps its one declaration beside the cache that holds it.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { CBP_MAX_CHAIN_DEPTH } from './security-plugin.js';
import { ReadableIds } from '@objectstack/spec/data';
// [ADR-0055 §1] The parse's own one-master judgement, asked of an object that
// reached the registry without the parse (see `resolveCbpRelation`).
import { controlledByParentMasterRefusal } from '@objectstack/spec/data';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import { masterGovernsRowWrites, OWD_DELEGATING_ROW_WRITES } from './platform-ownership-policies.js';

/**
 * [ADR-0139 D1] The engine verbs whose `where` may carry a `ReadableIds`
 * leaf — the engine's own `READABLE_IDS_READ_VERBS`. The read derivation
 * answers its leaf for these and nothing for a write verb's predicate: a
 * predicate write is narrowed to the rows the read door returns for the
 * caller's own predicate ({@link SecurityPlugin.readableRowsScopeForPredicateWrite},
 * where the leaf composes) and judged per master by the 2.8 gate
 * ({@link SecurityPlugin.assertControlledByParentWrite}, a verdict, never a
 * scope), so no master set is composed into a write's predicate.
 */
const CBP_LEAF_READ_VERBS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/**
 * [ADR-0055 §1] {@link CbpRelation.masterNotWritable} for a resolved relation:
 * the parse's refusal of its one master reference, judged on that one def,
 * else `null`. `controlledByParentMasterRefusal` reads `readonly === true` and
 * `system === true` on it, so the flags and the sentence are spelled once, in
 * the parse, and never re-derived here.
 */
function masterNotWritableRefusal(object: string, fk: string, def: unknown): string | null {
  const refusal = controlledByParentMasterRefusal(object, OWD_DELEGATING_ROW_WRITES, { [fk]: def });
  return refusal?.shape === 'master-not-writable' ? refusal.message : null;
}

/**
 * A `controlled_by_parent` object's resolved master relation, as the class
 * declares it: the `CbpRelation` interface stays in `security-plugin.ts`
 * beside `cbpRelCache` and the write gate that read it, and the moved bodies
 * name it exactly as they did.
 */
type CbpRelation = NonNullable<ReturnType<SecurityPlugin['resolveCbpRelation']>>;

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. Every field here is a
 * getter on the host; see the module header.
 */
export interface CbpReadHost {
  readonly cbpRelCache: SecurityPlugin['cbpRelCache'];
  readonly logger: SecurityPlugin['logger'];
  readonly ql: SecurityPlugin['ql'];
  controlledByParentChainRefusal: SecurityPlugin['controlledByParentChainRefusal'];
  reportCbpMasterUnresolved: SecurityPlugin['reportCbpMasterUnresolved'];
  reportRejectedReferenceAlias: SecurityPlugin['reportRejectedReferenceAlias'];
  resolveCbpRelation: SecurityPlugin['resolveCbpRelation'];
}

/** The body of `SecurityPlugin#resolveCbpRelation`; the method's docblock there is its contract. */
export function resolveCbpRelation(
  this: Pick<CbpReadHost, 'cbpRelCache' | 'ql' | 'reportCbpMasterUnresolved' | 'reportRejectedReferenceAlias'>,
  object: string,
): CbpRelation | null {
  if (this.cbpRelCache.has(object)) return this.cbpRelCache.get(object) ?? null;
  let rel: CbpRelation | null = null;
  const schema = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(object) : null;
  const fields = schema?.fields;
  const entries: Array<[string, any]> = Array.isArray(fields)
    ? fields.map((f: any) => [f?.name, f] as [string, any])
    : fields && typeof fields === 'object'
      ? (Object.entries(fields) as Array<[string, any]>)
      : [];
  // ── The reference spelling: TOLERANT HERE, and deliberately so ───────────
  //
  // `@objectstack/spec` declares `reference` as the ONLY relationship
  // spelling, and `FieldSchema` REJECTS `reference_to` / `referenceTo` with
  // *"Did you mean `reference_to` → `reference`?"* (#11567, "one key, one
  // answer"). Two sibling readers were narrowed to canonical-only on that
  // ruling — `refOf` in `packages/lint/src/validate-security-posture.ts`
  // (which records its reasoning in full) and `refOf` in
  // `packages/lint/src/data-model-rules.ts`. This reader is the DELIBERATE
  // INVERSE of both, and the asymmetry is the answer rather than an
  // oversight (maintainer ruling, 2026-08-30):
  //
  //   • Those two read a stack that WENT THROUGH the parse, so the alias
  //     cannot legitimately reach them — narrowing there costs nothing and
  //     the schema names the real defect (the alias key) itself.
  //   • This one reads `ql.getSchema()`, i.e. the `SchemaRegistry`, and a
  //     raw `registerObject` SKIPS Zod by design (#3896 — the registry's own
  //     header names those doors). So here the alias is genuinely REACHABLE.
  //   • And here a miss is not a quiet wrong answer, it is a DENIAL.
  //     `resolveCbpRelation` returning null is FAIL-CLOSED: the read leg
  //     answers `RLS_DENY_FILTER` (zero rows for every non-admin
  //     caller) and the write leg throws `MasterDetailRelationMissingError`.
  //     Narrowing this reader would take a raw-registered, alias-spelled
  //     `controlled_by_parent` object from "access derived from its master"
  //     to "everything denied, and writes throw" — an availability outage on
  //     a population that provably exists, not a spelling correction.
  //
  // So the tolerance STAYS, and is made LOUD instead: the alias still
  // resolves — no deployment loses access — and the author hears about it,
  // once per object, through `reportRejectedReferenceAlias` below. ⛔ Do not
  // narrow this in place. Narrowing is only honest behind a migration that
  // sweeps stored / raw-registered metadata first, and that is a separate
  // card rather than a rider on the one that made this loud.
  //
  // `refKey` exists so the diagnostic and the resolution cannot disagree
  // about WHICH key was read: `ref` is derived from it rather than spelling
  // the `??` chain a second time. The mirror is exact for every shape either
  // call site can observe — `??` falls through on null/undefined only, which
  // is what `!= null` tests. The one difference is unobservable: with EVERY
  // spelling present-but-null the old chain evaluated to `null` and this
  // returns `undefined`, and both call sites below take `ref` as a
  // truthiness test or read it only after one (`pick` requires `ref(f)`, and
  // `String(ref(def))` runs only on what `pick` returned). Pinned in
  // `controlled-by-parent-reference-alias.test.ts`.
  const REFERENCE_SPELLINGS = ['reference', 'reference_to', 'referenceTo'] as const;
  const refKey = (f: any) => REFERENCE_SPELLINGS.find((k) => f?.[k] != null);
  const ref = (f: any) => {
    const k = refKey(f);
    return k === undefined ? undefined : f[k];
  };
  // [ADR-0055 §1 · #23100 ruling B] Exactly one required `master_detail`
  // naming a reference — see the docblock. `required === true` is the spec's
  // own type for the key and the lint's reading of it.
  const candidates = entries.filter(([, f]) => f?.type === 'master_detail' && f?.required === true && ref(f));
  const found = candidates.length === 1 ? candidates[0] : undefined;
  if (!found && masterGovernsRowWrites(schema)) {
    this.reportCbpMasterUnresolved(object, entries, candidates.map(([k]) => String(k)));
  }
  if (found) {
    const def = found[1];
    // Resolved from the SAME field def the relation itself came from, and
    // from the same `refKey`, so the report can never name a different field
    // or a different key than the one that actually answered.
    const spelling = refKey(def);
    if (spelling !== undefined && spelling !== 'reference') {
      this.reportRejectedReferenceAlias(object, String(found[0]), spelling, String(ref(def)));
    }
    rel = {
      fk: String(found[0]),
      master: String(ref(def)),
      // [#8688] A MIRROR of `validateRecord`'s insert-mode gate in
      // `@objectstack/objectql` (`record-validator.ts`): it walks every
      // declared field but skips provenance-flagged ones outright
      // (`if (def.system || def.readonly) continue;`) before the required
      // check is reached, and the check itself is `def.required && isMissing`.
      // So this predicate must track that gate literally, not approximate it
      // — it is the licence for the guard to stand down, and every shape it
      // reports `true` for is a shape validation provably refuses.
      //
      // `master_detail` + `required` are the resolver's own predicate above
      // (since #23100 nothing else resolves), so they always hold here; they
      // stay spelled out so this licence reads as the validator's test it
      // mirrors and cannot widen if the resolver ever changes.
      omissionRefusedByValidation:
        def?.type === 'master_detail' && !!def?.required && !def?.readonly && !def?.system,
      // [#25095] From the same def, asked of the parse's own predicate.
      masterNotWritable: masterNotWritableRefusal(object, String(found[0]), def),
    };
  }
  this.cbpRelCache.set(object, rel);
  return rel;
}

/** The body of `SecurityPlugin#reportCbpMasterUnresolved`; the method's docblock there is its contract. */
export function reportCbpMasterUnresolved(
  this: Pick<CbpReadHost, 'logger'>,
  object: string,
  entries: ReadonlyArray<readonly [string, any]>,
  requiredMasters: readonly string[],
): void {
  const optionalMasters = entries
    .filter(([, f]) => f?.type === 'master_detail' && f?.required !== true)
    .map(([k]) => String(k));
  const requiredLookups = entries
    .filter(([, f]) => f?.type === 'lookup' && f?.required === true)
    .map(([k]) => String(k));
  const why =
    requiredMasters.length > 1
      ? `it declares ${requiredMasters.length} required master_detail fields (${requiredMasters.join(', ')}) ` +
        'and derives its master from exactly one'
      : [
          'it declares no required master_detail field',
          ...(optionalMasters.length > 0
            ? [`master_detail without required: true: ${optionalMasters.join(', ')} (add required: true)`]
            : []),
          ...(requiredLookups.length > 0
            ? [
                `required lookup: ${requiredLookups.join(', ')} (a lookup derives no access — declare the ` +
                  "master as type: 'master_detail', or give the object its own sharingModel)",
              ]
            : []),
        ].join('; ');
  this.logger.warn?.(
    `[security/controlled-by-parent] object "${object}" declares sharingModel 'controlled_by_parent' but ` +
      `resolves no master relation — ${why}. Every read of it is DENIED and every write refused ` +
      '(422 INVALID_METADATA): ADR-0055 §1 derives the master from exactly one master_detail field declared ' +
      'required: true, and from nothing else. A non-required master_detail and a required lookup no longer ' +
      'derive access.',
    { object, requiredMasters, optionalMasters, requiredLookups },
  );
}

/** The body of `SecurityPlugin#reportRejectedReferenceAlias`; the method's docblock there is its contract. */
export function reportRejectedReferenceAlias(
  this: Pick<CbpReadHost, 'logger'>,
  object: string,
  field: string,
  alias: string,
  master: string,
): void {
  // The tag is a resolvable NAME, not a tracker id: this string reaches
  // operators and generated surfaces, and `#NNNN` means nothing to any of
  // them (`check:doc-authoring`). The anchor for a reader who CAN resolve it
  // is this comment — the ruling is #11567, and git history keeps it.
  this.logger.warn?.(
    `[security/reference-spelling] object "${object}": its controlled_by_parent master relation resolved ` +
      `only from the REJECTED alias \`${alias}\` on field "${field}" — \`reference\` is the one ` +
      'relationship spelling @objectstack/spec declares, and this object reached the registry ' +
      'without being parsed (a raw registerObject skips Zod by design). Access is UNAFFECTED: ' +
      'this reader keeps accepting the alias precisely so no deployment loses access, and the ' +
      'relation still derives from the master. Rename the key to `reference` — every parsed ' +
      'authoring path already refuses this shape, so the two answers disagree until you do.',
    { object, field, alias, master },
  );
}

/** The body of `SecurityPlugin#computeControlledByParentFilter`; the method's docblock there is its contract. */
export function computeControlledByParentFilter(
  this: Pick<CbpReadHost, 'controlledByParentChainRefusal' | 'logger' | 'ql' | 'resolveCbpRelation'>,
  object: string,
  /** The engine verb the answer is composed onto; a write verb answers `null` (ADR-0139 D1). */
  operation: string,
  context: any,
): Record<string, unknown> | null {
  if (!this.ql || !context?.userId) return null;
  const schema = typeof this.ql.getSchema === 'function' ? this.ql.getSchema(object) : null;
  const sharingModel = schema?.sharingModel ?? schema?.security?.sharingModel;
  if (sharingModel !== 'controlled_by_parent') return null;
  if (!CBP_LEAF_READ_VERBS.has(operation)) return null;

  const rel = this.resolveCbpRelation(object);
  // No resolvable master: the deny sentinel, by reference (ADR-0139 D2 step 2).
  if (!rel) return RLS_DENY_FILTER;

  // [ADR-0055 amendment] Chain guards, over the registry, BEFORE the leaf is
  // written. Both answer with the empty master set — the same shape the
  // #5386 sharing-resolution failure answered with, and the same posture: a
  // chain this derivation cannot resolve denies, because the alternative
  // ("no restriction") is the defect being fixed, and the other alternative
  // (the engine's refusal of the same chain) is a 500 for a declared shape.
  const refusal = this.controlledByParentChainRefusal(object, rel);
  if (refusal?.kind === 'cycle') {
    this.logger.error?.(
      `[security] controlled_by_parent derivation found a CYCLE resolving '${object}' ` +
        `(chain: ${refusal.chain.join(' -> ')}) — denying (fail-closed: a chain the derivation ` +
        `cannot resolve admits no child rather than leaving it unrestricted)`,
    );
    return { [rel.fk]: { $in: [] } };
  }
  if (refusal?.kind === 'depth') {
    this.logger.error?.(
      `[security] controlled_by_parent derivation exceeded the chain depth bound ` +
        `(${CBP_MAX_CHAIN_DEPTH}) resolving '${object}' ` +
        `(chain: ${refusal.chain.join(' -> ')}) — denying (fail-closed: a chain the derivation ` +
        `cannot resolve admits no child rather than leaving it unrestricted)`,
    );
    return { [rel.fk]: { $in: [] } };
  }
  return { [rel.fk]: { $in: ReadableIds.of(rel.master) } };
}

/** The body of `SecurityPlugin#controlledByParentChainRefusal`; the method's docblock there is its contract. */
export function controlledByParentChainRefusal(
  this: Pick<CbpReadHost, 'ql' | 'resolveCbpRelation'>,
  object: string,
  rel: CbpRelation,
): { kind: 'cycle' | 'depth'; chain: string[] } | null {
  const chain: string[] = [object];
  let master = rel.master;
  for (;;) {
    if (chain.includes(master)) return { kind: 'cycle', chain: [...chain, master] };
    const schema = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(master) : null;
    const model = schema?.sharingModel ?? schema?.security?.sharingModel;
    if (model !== 'controlled_by_parent') return null;
    if (chain.length >= CBP_MAX_CHAIN_DEPTH) return { kind: 'depth', chain: [...chain, master] };
    chain.push(master);
    const next = this.resolveCbpRelation(master);
    if (!next) return null;
    master = next.master;
  }
}
