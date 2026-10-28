// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 2] The controlled-by-parent master relation of `SecurityPlugin`,
 * moved out of `security-plugin.ts` whole: the ADR-0055 §1 derivation of the
 * one master a `controlled_by_parent` object takes its access from, with its
 * two loud reports (the unresolved master and the tolerated reference alias).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same derivation, the same cache, the same reports,
 * failing closed exactly where they did. The one module-level declaration only
 * these bodies read moved with them, also unedited: `masterNotWritableRefusal`,
 * with the two imports below that `security-plugin.ts` no longer needs. Both
 * consumers of the relation stay in `security-plugin.ts` and read it through
 * the class's `resolveCbpRelation`, as before: the read leaf
 * (`computeControlledByParentFilter`, ADR-0139) with its chain refusal, and the
 * master-write gate.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cut 1 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps every method — the published
 * `dist/*.d.ts` lists each one's name, docblock and position — and each body is
 * one literal of exactly the {@link CbpRelationHost} members that method reads,
 * plus a `.call`. A method is handed over as a closure that calls it on the
 * plugin at call time, so a test double or spy set on the plugin is still the
 * one the body reaches, and the derivation reaches its two reports through the
 * plugin, as before. Every function here is synchronous.
 *
 * Every field the bodies read goes as a GETTER, by the rule cut 1 set: none of
 * the three is declared `readonly`. `start()` assigns `ql` and `logger` after
 * construction, and `cbpRelCache` is a plain field the metadata-change
 * invalidation clears in place.
 *
 * `CbpRelation` keeps its one declaration in `security-plugin.ts`, beside the
 * cache that holds it and the consumers that read it; this module names it
 * through the class's own signature (below). The import of `SecurityPlugin` is
 * type-only, so there is no runtime import cycle, and nothing re-exports this
 * module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
// [ADR-0055 §1] The parse's own one-master judgement, asked of an object that
// reached the registry without the parse (see `resolveCbpRelation`).
import { controlledByParentMasterRefusal, controlledByParentOwnerMayEdit } from '@objectstack/spec/data';
import { masterGovernsRowWrites, OWD_DELEGATING_ROW_WRITES } from './platform-ownership-policies.js';

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
 * beside `cbpRelCache` and the consumers that read it, and the moved bodies
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
export interface CbpRelationHost {
  readonly cbpRelCache: SecurityPlugin['cbpRelCache'];
  readonly logger: SecurityPlugin['logger'];
  readonly ql: SecurityPlugin['ql'];
  reportCbpMasterUnresolved: SecurityPlugin['reportCbpMasterUnresolved'];
  reportOwnerMayEditWithoutOwnerColumn: SecurityPlugin['reportOwnerMayEditWithoutOwnerColumn'];
  reportRejectedReferenceAlias: SecurityPlugin['reportRejectedReferenceAlias'];
}

/**
 * [ADR-0055 §3 amendment] The column {@link CbpRelation.ownerMayEdit} compares
 * the caller against: the registry's injected per-record owner
 * (`resolveInjectedSystemColumns`' `owner` anchor, which `applySystemFields`
 * writes into the registered schema's field map under `ownership: 'user'`, the
 * default), or an author's own field of that name, which the registry lets
 * win. One spelling, the sharing service's `OWNER_FIELD` and the platform's
 * "My records" scope read the same column.
 */
const OWNER_COLUMN = 'owner_id';

/** The body of `SecurityPlugin#resolveCbpRelation`; the method's docblock there is its contract. */
export function resolveCbpRelation(
  this: Pick<CbpRelationHost, 'cbpRelCache' | 'ql' | 'reportCbpMasterUnresolved' | 'reportOwnerMayEditWithoutOwnerColumn' | 'reportRejectedReferenceAlias'>,
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
  // [ADR-0055 §3 amendment] Resolved HERE, on the same schema the relation
  // came from, so the opt-in and the relation can never describe two objects.
  // Judged only for an object whose relation resolves: an opt-in on an object
  // that derives no master is moot — every write of it is refused anyway.
  const optedIn = found !== undefined && controlledByParentOwnerMayEdit(schema);
  const hasOwnerColumn = entries.some(([key]) => key === OWNER_COLUMN);
  if (optedIn && !hasOwnerColumn) this.reportOwnerMayEditWithoutOwnerColumn(object);
  const ownerMayEdit = optedIn && hasOwnerColumn;
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
      // [ADR-0055 §3 amendment · ruling 6398566164] The opt-in, read through
      // the spec's one reader, and only where the schema carries the column
      // it names — see {@link CbpRelation.ownerMayEdit}.
      ownerMayEdit,
    };
  }
  this.cbpRelCache.set(object, rel);
  return rel;
}

/** The body of `SecurityPlugin#reportCbpMasterUnresolved`; the method's docblock there is its contract. */
export function reportCbpMasterUnresolved(
  this: Pick<CbpRelationHost, 'logger'>,
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

/** The body of `SecurityPlugin#reportOwnerMayEditWithoutOwnerColumn`; the method's docblock there is its contract. */
export function reportOwnerMayEditWithoutOwnerColumn(
  this: Pick<CbpRelationHost, 'logger'>,
  object: string,
): void {
  this.logger.warn?.(
    `[security/controlled-by-parent] object "${object}" declares sharing.controlledByParent.ownerMayEdit: true ` +
      `but carries no ${OWNER_COLUMN} column (ownership is 'business_unit', 'org' or 'none', or the object is ` +
      'platform-managed), so the opt-in names nobody: every write of its rows keeps requiring edit access to ' +
      "the master (ADR-0055 §3). Declare ownership: 'user' (the default) so the rows carry an owner, or delete " +
      'the key.',
    { object },
  );
}

/** The body of `SecurityPlugin#reportRejectedReferenceAlias`; the method's docblock there is its contract. */
export function reportRejectedReferenceAlias(
  this: Pick<CbpRelationHost, 'logger'>,
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
