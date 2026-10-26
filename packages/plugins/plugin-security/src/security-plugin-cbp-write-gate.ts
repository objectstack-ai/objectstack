// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 3] The controlled-by-parent write gate of `SecurityPlugin`,
 * moved out of `security-plugin.ts` whole: the ADR-0055 §3 master-write check
 * the write path runs at step 2.8 and the `security` service serves
 * (`checkControlledByParentWrite`), the gate itself, its walk up a chain of
 * controlled-by-parent masters, the master set a predicate write reaches, and
 * the master-row edit verdict every leg ends in.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same legs, the same refusals, failing closed
 * exactly where they did. The module-level declarations only these bodies read
 * moved with them, also unedited: `MASTER_EDIT_DENIAL_LEG` (the weak map that
 * names a refusal's leg), `controlledByParentWriteOutcomeOf` and
 * `writesMasterReference`, with the imports below that `security-plugin.ts` no
 * longer needs. The relation the gate judges by stays the class's
 * `resolveCbpRelation` (`security-plugin-cbp-relation.ts`), read through the
 * plugin as before.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 and 2 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps every method — the published
 * `dist/*.d.ts` lists each one's name, docblock and position — and each body is
 * one literal of exactly the {@link CbpWriteGateHost} members that method
 * reads, plus a `.call`. A method is handed over as a closure that calls it on
 * the plugin at call time, so a test double or spy set on the plugin is still
 * the one the body reaches, and the bodies that call one another (the check
 * and the gate, the gate and its chain walk, each leg and the master-row
 * verdict) do so through the plugin, as before.
 *
 * Every function here is async, and every method that hands its body over
 * drops `async` and returns the moved function's own promise. Building the
 * host reads no field and runs no getter, and calling an async function never
 * throws synchronously, so a caller awaits a promise that settles exactly as
 * the old method's did.
 *
 * The two fields the bodies read go as GETTERS, by the rule cut 1 set: neither
 * is declared `readonly`. `start()` assigns `ql` after construction, and tests
 * replace `permissionEvaluator` on a constructed plugin. Each read happens when
 * the body makes it, after any `await`, as before.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * Five module-level values the bodies read stay where they are, exported from
 * `security-plugin.ts` and imported here by value:
 *
 * - `CBP_MAX_CHAIN_DEPTH`, which ADR-0055 anchors by symbol in that file, and
 *   which the read derivation's chain refusal there walks too.
 * - `requiredCapsForOperation`, which `packages/spec/liveness/object.json`
 *   anchors by symbol in that file, and which the CRUD gate reads too.
 * - `PREDICATE_WRITE_READABLE_ID_CAP`, `predicateWriteReadableCapError` and
 *   `copyOfCallerPredicate`, which `readableRowsScopeForPredicateWrite` there
 *   shares with the predicate-write master set here.
 *
 * Each is read only inside a function body, at call time, never while either
 * module evaluates, so the two-way import is safe under ESM, and the published
 * bundle holds one module. `index.ts` re-exports only `SecurityPlugin`, so the
 * five exports do not reach the package's surface. `CbpRelation` keeps its one
 * declaration in `security-plugin.ts`; this module names it through the
 * class's own signature (below).
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import {
  CBP_MAX_CHAIN_DEPTH,
  copyOfCallerPredicate,
  PREDICATE_WRITE_READABLE_ID_CAP,
  predicateWriteReadableCapError,
  readUnlessRefused,
  requiredCapsForOperation,
} from './security-plugin.js';
import { withoutOperationPrivateKeys } from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import {
  resolveEngineDeleteDispatch,
  resolveEngineUpdateDispatch,
  type EngineDeleteDispatchInput,
  type EngineUpdateDispatchData,
} from '@objectstack/metadata-core';
import type { ControlledByParentWriteDenialLeg, ControlledByParentWriteOutcome } from '@objectstack/spec/contracts';
import {
  PermissionDeniedError,
  MasterDetailRelationMissingError,
  DetailRecordNotFoundError,
  MasterReferenceMissingError,
  MasterReferenceNotWritableError,
} from './errors.js';
import { isPlatformOwnershipFloorPolicy } from './platform-ownership-policies.js';

/**
 * [ADR-0055] Which leg of the master-detail write check a refusal came from,
 * keyed by the refusal itself. Written at the one place a refusal is built
 * (`masterEditDenied`, inside {@link SecurityPlugin.assertControlledByParentWrite})
 * and read only by {@link controlledByParentWriteOutcomeOf}, so the served
 * member ({@link SecurityPlugin.checkControlledByParentWrite}) names the leg
 * without parsing the refusal's prose, and the refusal the write path throws
 * keeps its envelope byte for byte: a weak map adds no property to the error,
 * so nothing new can reach a response body or a log line.
 */
const MASTER_EDIT_DENIAL_LEG = new WeakMap<PermissionDeniedError, ControlledByParentWriteDenialLeg>();

/**
 * [ADR-0055 §3 amendment] The stored column the owner leg of
 * {@link assertControlledByParentWrite} compares the caller against: the
 * platform's injected per-record owner, the same `owner_id` the relation
 * resolver confirmed the schema carries before it set
 * {@link CbpRelation.ownerMayEdit} (`security-plugin-cbp-relation.ts`).
 */
const OWNER_COLUMN = 'owner_id';

/**
 * [ADR-0055] The master-detail write check's own outcome, read off what
 * {@link SecurityPlugin.assertControlledByParentWrite} threw. `null` when the
 * throw is not one of its outcomes: a store fault, or a refusal of the CONTEXT
 * rather than of the master. Those are rejections, and the caller rethrows them
 * unchanged, so a datasource outage keeps its `503` and is never reported as a
 * verdict about the record (`ControlledByParentWriteOutcome`).
 *
 * The three non-verdict classes map one to one onto the `unresolvable` reasons:
 * each is thrown only for the record the caller addressed, never for a master
 * above it (an unresolvable ancestor is the `master_chain` leg, a refusal).
 */
function controlledByParentWriteOutcomeOf(e: unknown): ControlledByParentWriteOutcome | null {
  if (e instanceof PermissionDeniedError) {
    const leg = MASTER_EDIT_DENIAL_LEG.get(e);
    return leg ? { outcome: 'deny', leg } : null;
  }
  if (e instanceof MasterDetailRelationMissingError) {
    return { outcome: 'unresolvable', reason: 'master_detail_relation_missing' };
  }
  if (e instanceof DetailRecordNotFoundError) return { outcome: 'unresolvable', reason: 'record_not_found' };
  if (e instanceof MasterReferenceMissingError) return { outcome: 'unresolvable', reason: 'master_reference_missing' };
  return null;
}

/**
 * [ADR-0055 §1] Does this write set the master reference `fk`? An insert sets
 * every field of the rows it creates, so always, single or batch and whatever
 * its body names. An update sets it when its body carries the key as an own
 * property, whatever the value, `null` included; an upsert reaches the gate as
 * one of those two. A delete, and every other write the gate judges, sets no
 * field.
 */
function writesMasterReference(operation: string, data: unknown, fk: string): boolean {
  if (operation === 'insert') return true;
  if (operation !== 'update') return false;
  const carries = (row: unknown) =>
    row != null && typeof row === 'object' && !Array.isArray(row) && Object.prototype.hasOwnProperty.call(row, fk);
  return Array.isArray(data) ? data.some(carries) : carries(data);
}

/**
 * A `controlled_by_parent` object's resolved master relation, as the class
 * declares it: the `CbpRelation` interface stays in `security-plugin.ts`
 * beside `cbpRelCache` and the read derivation that fills it, and the moved
 * bodies name it exactly as they did.
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
export interface CbpWriteGateHost {
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  assertControlledByParentChainEditable: SecurityPlugin['assertControlledByParentChainEditable'];
  assertControlledByParentWrite: SecurityPlugin['assertControlledByParentWrite'];
  assertMasterRowEditable: SecurityPlugin['assertMasterRowEditable'];
  checkAuthoredRowWrite: SecurityPlugin['checkAuthoredRowWrite'];
  collectRLSPolicies: SecurityPlugin['collectRLSPolicies'];
  computeRlsFilter: SecurityPlugin['computeRlsFilter'];
  controlledByParentPredicateWriteMasters: SecurityPlugin['controlledByParentPredicateWriteMasters'];
  declaresControlledByParent: SecurityPlugin['declaresControlledByParent'];
  delegatorOwnWriteFloorOptions: SecurityPlugin['delegatorOwnWriteFloorOptions'];
  extractSingleId: SecurityPlugin['extractSingleId'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  readRowById: SecurityPlugin['readRowById'];
  resolveCbpRelation: SecurityPlugin['resolveCbpRelation'];
  resolveOperationPrincipals: SecurityPlugin['resolveOperationPrincipals'];
  resolveSharingCanEdit: SecurityPlugin['resolveSharingCanEdit'];
  resolveSharingWriteVerdict: SecurityPlugin['resolveSharingWriteVerdict'];
}

/** The body of `SecurityPlugin#checkControlledByParentWrite`; the method's docblock there is its contract. */
export async function checkControlledByParentWrite(
  this: Pick<CbpWriteGateHost, 'assertControlledByParentWrite' | 'declaresControlledByParent' | 'resolveOperationPrincipals'>,
  object: string,
  recordId: string,
  context?: any,
): Promise<ControlledByParentWriteOutcome> {
  if (context?.isSystem) return { outcome: 'allow' };
  const { permissionSets, delegatorSets, delegatorContext } = await this.resolveOperationPrincipals(
    'update',
    object,
    context,
  );
  if (!this.declaresControlledByParent(object)) return { outcome: 'not_applicable' };
  // A by-id update as step 2.8 sees it: one id, addressed by `where`, under the
  // caller's own context (the delegation link, when present, rides on it — the
  // master's floor exclusion reads it there on both passes).
  const opCtx = { object, operation: 'update', options: { where: { id: recordId } }, context };
  try {
    await this.assertControlledByParentWrite(permissionSets, object, 'update', opCtx, context);
    if (delegatorSets) {
      await this.assertControlledByParentWrite(delegatorSets, object, 'update', opCtx, delegatorContext);
    }
  } catch (e) {
    const outcome = controlledByParentWriteOutcomeOf(e);
    if (outcome) return outcome;
    throw e;
  }
  return { outcome: 'allow' };
}

/** The body of `SecurityPlugin#assertControlledByParentWrite`; the method's docblock there is its contract. */
export async function assertControlledByParentWrite(
  this: Pick<CbpWriteGateHost, 'assertControlledByParentChainEditable' | 'controlledByParentPredicateWriteMasters' | 'declaresControlledByParent' | 'extractSingleId' | 'readRowById' | 'resolveCbpRelation'>,
  permissionSets: PermissionSet[],
  object: string,
  operation: string,
  opCtx: any,
  context: any,
): Promise<void> {
  if (!this.declaresControlledByParent(object)) return;

  // [#7474] The AUTHORIZATION verdicts — and ONLY those. Three of this gate's
  // conditions really do mean "you may not write this detail because you may
  // not edit its master", and they keep `403 PERMISSION_DENIED` and this
  // exact sentence. The other three conditions (broken master_detail
  // declaration / missing row / null master FK) are not verdicts at all and
  // throw their own errors below — see `./errors.ts` for the ruling and the
  // reasoning behind each code.
  // [commit 61713314e] Split into a FACTORY plus the `never`-returning thrower it backs.
  // Both spell the same sentence, from one place. The factory exists because
  // TypeScript's control-flow analysis does not narrow through a `const` arrow
  // that returns `never` — the same reason the `!rel` branch below throws
  // directly rather than routing through the helper — and the chain walk needs
  // real narrowing after each of its refusals.
  //
  // [ADR-0055] Each refusal also names its LEG — the closed vocabulary the
  // served member (`checkControlledByParentWrite`) reports. It is recorded
  // beside the error ({@link MASTER_EDIT_DENIAL_LEG}), never on it, so the
  // envelope this path throws is unchanged.
  const masterEditDenied = (
    leg: ControlledByParentWriteDenialLeg,
    reason: string,
    recordId?: unknown,
  ): PermissionDeniedError => {
    const denial = new PermissionDeniedError(
      `[Security] Access denied: ${operation} on '${object}' requires edit access to its master record (${reason})`,
      { operation, object, recordId },
    );
    MASTER_EDIT_DENIAL_LEG.set(denial, leg);
    return denial;
  };
  const denyMasterEdit = (leg: ControlledByParentWriteDenialLeg, reason: string, recordId?: unknown): never => {
    throw masterEditDenied(leg, reason, recordId);
  };

  const rel = this.resolveCbpRelation(object);
  // A metadata defect, not an access verdict: the object declares that its
  // access is derived from a master and gives us no master to derive it from.
  // Thrown rather than routed through a `never`-returning helper so the
  // narrowing is real — the non-null assertions this branch used to need
  // (`rel!.fk`) were the load-bearing half of the same defect.
  if (!rel) throw new MasterDetailRelationMissingError(object, operation);
  // [ADR-0055 §1 · #25095] Also a metadata defect, and answered before any
  // master is asked: a declaration the parse refuses because its one master
  // reference is not writable ({@link CbpRelation.masterNotWritable}). Every
  // write that sets that reference is refused, for every caller the gate
  // judges: an insert (single or batch), and an update whose body carries
  // the key. A delete, and an update that leaves the key alone, take the
  // path below as before, so the rows already stored keep their master.
  if (rel.masterNotWritable !== null && writesMasterReference(operation, opCtx.data, rel.fk)) {
    throw new MasterReferenceNotWritableError(object, operation, rel.masterNotWritable);
  }

  // [ADR-0055 §3 · #25044] Every master the write involves is asked, not one
  // of them. A body that names a master reference involves that master too,
  // so once the masters `judged` (the stored ones) have been asked, the SAME
  // walk is asked of the body's — unless it is one of them, which would ask
  // one master twice. Read as an OWN property, never through the prototype
  // chain. A body without the key names no master and leaves this question
  // nothing to ask about.
  //
  // [ADR-0055 §1 · #25049] A body WITH the key and a null value names no
  // master either, but it is not silent: on an update it empties the
  // reference the row's access derives from. That is the empty-master
  // condition the branch below answers for an insert, answered by the same
  // rule — handed to required-field validation where it provably judges the
  // same field ({@link CbpRelation.omissionRefusedByValidation}: its update
  // pass refuses a required field the body sets to null), and refused here
  // otherwise, before anything is written. An insert never reaches here
  // with an empty master: the branch below has answered it.
  const askBodyNamedMaster = async (judged: readonly unknown[]): Promise<void> => {
    const data = opCtx.data;
    if (data == null || typeof data !== 'object' || Array.isArray(data)) return;
    if (!Object.prototype.hasOwnProperty.call(data, rel.fk)) return;
    const named = (data as Record<string, unknown>)[rel.fk];
    if (named == null) {
      if (operation !== 'update' || rel.omissionRefusedByValidation) return;
      throw new MasterReferenceMissingError(object, operation, rel.fk);
    }
    if (judged.includes(named)) return;
    await this.assertControlledByParentChainEditable(
      permissionSets, object, rel, named, context, opCtx, masterEditDenied, denyMasterEdit,
    );
  };

  // Resolve the master id: from the incoming body on insert, else from the
  // target row (read as system — we only need its FK value).
  let masterId: unknown;
  let detailRecordId: unknown;
  /** The stored detail row a by-id write addresses, for the owner leg below; `null` on every other shape. */
  let detailRow: Record<string, unknown> | null = null;
  if (operation === 'insert') {
    const data = opCtx.data;
    if (Array.isArray(data)) {
      // [ADR-0055 §3 · #25049] A BATCH create: one body per row, and the
      // middleware chain runs once for all of them, so every master the rows
      // name is asked here — the same walk a single create runs, once per
      // master, in row order — before anything is written. A row is read
      // exactly as a single create's body is read below. A row that names no
      // master is left to the empty-master branch, which this batch then
      // meets exactly as it did before (`masterId` stays undefined for an
      // array): it stands down where required-field validation judges each
      // such row, and refuses the batch whole otherwise.
      const asked: unknown[] = [];
      for (const row of data as unknown[]) {
        const rowMasterId = row && typeof row === 'object' && !Array.isArray(row) ? (row as any)[rel.fk] : undefined;
        if (rowMasterId == null || asked.includes(rowMasterId)) continue;
        asked.push(rowMasterId);
        await this.assertControlledByParentChainEditable(
          permissionSets, object, rel, rowMasterId, context, opCtx, masterEditDenied, denyMasterEdit,
        );
      }
    }
    masterId = data && typeof data === 'object' && !Array.isArray(data) ? (data as any)[rel.fk] : undefined;
  } else {
    const targetId = this.extractSingleId(opCtx);
    if (targetId == null) {
      // [#25012] No single target row. Either the engine refuses this shape
      // itself before anything is written (its `reject` verdict — nothing to
      // judge here), or it is the engine's predicate path, read from the
      // engine's own dispatch predicates exactly as the write doors read them
      // ({@link addressedPredicateWrite}), and every master the write would
      // write details under is judged by the same walk a by-id write runs.
      const predicatePath =
        operation === 'update'
          ? opCtx.data != null &&
            typeof opCtx.data === 'object' &&
            resolveEngineUpdateDispatch(opCtx.data as EngineUpdateDispatchData, opCtx.options).kind === 'multi'
          : operation === 'delete' &&
            resolveEngineDeleteDispatch(opCtx.options as EngineDeleteDispatchInput | undefined).kind === 'multi';
      if (!predicatePath) return;
      const predicateMasters = await this.controlledByParentPredicateWriteMasters(object, operation, rel, opCtx);
      for (const predicateMasterId of predicateMasters) {
        await this.assertControlledByParentChainEditable(
          permissionSets, object, rel, predicateMasterId, context, opCtx, masterEditDenied, denyMasterEdit,
        );
      }
      // [#25044] A write that selects no row the caller can read writes
      // nothing, so it involves no master — the body's included.
      if (predicateMasters.length > 0) await askBodyNamedMaster(predicateMasters);
      return;
    }
    detailRecordId = targetId;
    const row = await this.readRowById(object, targetId, { isSystem: true });
    if (!row) throw new DetailRecordNotFoundError(object, operation, targetId);
    masterId = row[rel.fk];
    detailRow = row;
  }
  if (masterId == null) {
    // [#8688] CONDITIONAL stand-down — maintainer ruling of 2026-08-15.
    //
    // An insert that omits the master FK is a missing required field, and the
    // platform answers those `400 VALIDATION_FAILED` with `fields[]` — which
    // is what lets a form highlight the offending input. This gate answered
    // the same condition `422 MISSING_REQUIRED_FIELD` with no `fields[]` and
    // a `[Security]` prefix, because it runs in the middleware chain OUTSIDE
    // the executor that calls `validateRecord`, so it short-circuited
    // validation on the one field it shares with it. Standing down hands the
    // condition back to the subsystem that owns it; the envelope is then the
    // same one the very same field already gets when it is present but
    // unresolvable.
    //
    // ⛔ The hand-over is CONDITIONAL, and the condition is not ceremony:
    // `validateRecord` skips provenance-flagged fields before the required
    // check (`if (def.system || def.readonly) continue;`) and never sees a
    // field that is not `required` at all. For those three declarable shapes
    // — no `required`; `required` + `readonly`; `required` + `system` — this
    // gate is the ONLY thing refusing the insert, and an unconditional
    // stand-down was measured to mint a detail row with a null master FK:
    // unmatchable by the `controlled_by_parent` read filter (`fk IN
    // (readable masters)`), so readable by nobody, and answering `422` on
    // every later by-id write through the stored-row leg below. The residual
    // envelope asymmetry is confined to exactly those shapes.
    //
    // [#8959 → #25095] "Confined" is now a closed publish-time bound. Both
    // legs of the 2026-08-16 ruling (recorded in commit 8abada3ba) have
    // landed — the builder force (#9138, `forceCbpMasterDetailRequired`) and
    // the lint's `error` tier for all three shapes (#9139,
    // `relationship/master-detail-required` in
    // `packages/lint/src/data-model-rules.ts`) — and the parse refuses all
    // three at every door that parses (`controlledByParentMasterRefusal`: a
    // missing `required` since #23100 ruling B, `readonly` / `system` on the
    // one master since #25092). They reach the runtime only through a door
    // that does not parse, and there no insert of theirs gets this far:
    //   • no `required` — `resolveCbpRelation` resolves only a required
    //     `master_detail`, so the object meets the `!rel` 422 above;
    //   • `required` + `readonly` and `required` + `system` — every insert,
    //     with or without a master in its body, is refused above
    //     ({@link CbpRelation.masterNotWritable}, ruling 6345869077).
    //
    // What still reaches this branch for the two flagged shapes is the
    // stored-row shape below. The freeze is no less binding for it: it is
    // what keeps an omitted master refused if either refusal above ever
    // moves.
    //
    // ⛔ [#9137] FREEZE NOTE — maintainer ruling (commit 8abada3ba), Direction 4,
    // "immediately": until the two legs above both land, this `if` is the
    // SOLE ENFORCEMENT POINT for the same three authorable
    // `controlled_by_parent` master-reference shapes — `master_detail` with no
    // `required`; `required: true` + `readonly`; `required: true` + `system`.
    // They are the last three of the five measured shapes behind that ruling,
    // and exactly the three shapes `record-validator.ts` skips before its
    // required check ever runs: `validateRecord()` opens BOTH of its field
    // loops with `if (def.system || def.readonly) continue;` — the
    // `mode === 'insert'` branch, over `Object.entries(fields)`, and the
    // `else` update branch, over `Object.entries(data)`.
    // `record-validator.ts` never throws on any of them, so nothing
    // downstream of this gate would refuse the insert either.
    //
    // ⛔ Cite those two loops by SYMBOL, never by line number. The `:993`
    // and `:1003` positions this note carried until now had both rotted
    // onto an unrelated docblock: an anchor that still RESOLVES never
    // announces that it moved, so the reader lands on unrelated prose and
    // has to decide whether this note describes code that no longer exists.
    // These anchors are this freeze note's only evidence pointer.
    //
    // Do NOT move this gate, weaken it, or stand it down further for these
    // three shapes — concretely: do not widen `omissionRefusedByValidation`
    // (declared above) to admit any of them, and do not otherwise make this
    // `if` return for them. This is not a hypothetical to pre-empt: the
    // absent-master insert route #8688 proposed has ALREADY LANDED, and
    // landed correctly narrowed to exactly the one shape validation covers —
    // the `if (operation === 'insert' && rel.omissionRefusedByValidation)
    // return;` two lines below IS that landing. The freeze is about not
    // WIDENING an already-conditional stand-down, not about blocking a change
    // that has not happened. Standing this gate down for any of the three
    // would mint a detail row whose master FK is null — a row the
    // `controlled_by_parent` read filter (`fk IN (readable masters)`) can
    // never match, so unreadable by anyone, and answering `422
    // MISSING_REQUIRED_FIELD` on every later by-id write forever after, since
    // no payload the caller could send would restore a field the request
    // never carried in the first place.
    //
    // Only the INSERT shape hands over. The stored-row shape (a by-id write
    // whose persisted FK is null) keeps its 422: the caller sent no such
    // field, so a `fields[]` naming it would name a field that was never in
    // the request, and there is no payload the caller could send to fix it.
    // [#25049] An update whose BODY empties the reference is the insert
    // shape's twin — the caller did send the field — and is answered by the
    // same rule, in `askBodyNamedMaster` above.
    if (operation === 'insert' && rel.omissionRefusedByValidation) return;
    throw new MasterReferenceMissingError(object, operation, rel.fk, detailRecordId);
  }

  // [ADR-0055 §3 amendment · ruling 6398566164] The OWNER of a detail row
  // updates it with READ access to the master, when the detail opts in
  // (`sharing.controlledByParent.ownerMayEdit: true`, carried on the
  // relation as {@link CbpRelation.ownerMayEdit}). Salesforce's "the owner of
  // an activity always has full access to it" under Activities OWD =
  // Controlled by Parent, narrowed to the ruling's verb: every other caller,
  // and every other shape of write, keeps the §3 rule below.
  //
  // Four conditions, each a boundary of the ruling and each fail-closed:
  //
  //  • a by-id UPDATE — the stored row was read above (`detailRow`). An
  //    insert has no row to own; a delete is not the ruled verb (deleting a
  //    child is still answered by the master); a predicate (`multi: true`)
  //    update judges every master of the rows it selects and has no single
  //    row whose owner could be asked, so it returned above, unchanged;
  //  • NOT delegated — read off `opCtx.context`, the one envelope both passes
  //    of a delegated write share (ADR-0090 D10, as the master-row leg reads
  //    it): an on-behalf-of write keeps the master-edit rule on the agent's
  //    pass AND the delegator's, exactly as it keeps both floors;
  //  • the CALLER is the row's owner — the stored row's `owner_id` (the
  //    platform's injected per-record owner, the column the relation resolver
  //    confirmed the schema carries) is the caller's own `userId`. A row with
  //    no owner, or another's, admits nobody here;
  //  • the caller can READ the master row — asked of the read door itself
  //    under the caller's own context, the same probe the by-id pre-image
  //    gate uses, so the answer is the one a direct read of the master gives:
  //    the master's object grant, its row-level and sharing scope, and, for a
  //    master that is itself `controlled_by_parent`, the chain the engine
  //    composes for its read (ADR-0139 D6). A hidden row and a refused read
  //    (a declared 4xx) are one answer, "not readable" (#7505,
  //    {@link readUnlessRefused}); a store fault propagates as raised, never
  //    as a verdict.
  //
  // What the leg does NOT change: the detail's own object-level `update`
  // grant (gate ①, judged before this middleware step) and its own row-level
  // policies (step 2.7, judged before this step, where an authored
  // `owner_id == current_user.id` update policy decides as authored) still
  // run; the sharing service's verdict on the detail is unchanged; and a body
  // that re-points the master reference still asks EDIT on the master it
  // names (`askBodyNamedMaster`): the owner may change their row, not move it
  // under a master they cannot edit. A body naming the stored master names no
  // new master and is not asked again.
  //
  // When any condition fails the write takes the §3 walk below and, refused,
  // carries the walk's own sentence — the owner leg adds no envelope of its
  // own, so nothing new reaches a response body.
  if (
    operation === 'update' &&
    detailRow !== null &&
    rel.ownerMayEdit &&
    !opCtx?.context?.onBehalfOf?.userId &&
    context?.userId != null &&
    detailRow[OWNER_COLUMN] != null &&
    String(detailRow[OWNER_COLUMN]) === String(context.userId)
  ) {
    const masterRead = await readUnlessRefused(() => this.readRowById(rel.master, masterId, context));
    if (!masterRead.refused && masterRead.value != null) {
      await askBodyNamedMaster([masterId]);
      return;
    }
  }

  await this.assertControlledByParentChainEditable(
    permissionSets, object, rel, masterId, context, opCtx, masterEditDenied, denyMasterEdit,
  );
  // [#25044] An insert's master was read from its body, so it is the one
  // just asked and is not asked again.
  await askBodyNamedMaster([masterId]);
}

/** The body of `SecurityPlugin#assertControlledByParentChainEditable`; the method's docblock there is its contract. */
export async function assertControlledByParentChainEditable(
  this: Pick<CbpWriteGateHost, 'assertMasterRowEditable' | 'declaresControlledByParent' | 'readRowById' | 'resolveCbpRelation'>,
  permissionSets: PermissionSet[],
  object: string,
  rel: CbpRelation,
  masterId: unknown,
  context: any,
  opCtx: any,
  masterEditDenied: (leg: ControlledByParentWriteDenialLeg, reason: string, recordId?: unknown) => PermissionDeniedError,
  denyMasterEdit: (leg: ControlledByParentWriteDenialLeg, reason: string, recordId?: unknown) => never,
): Promise<void> {
  // [ADR-0055 amendment] Walk the `controlled_by_parent` chain, one hop at a time, and run
  // the SAME three master-edit legs on every hop.
  //
  // The three legs below used to run exactly once, on the immediate master.
  // When that master is ITSELF `controlled_by_parent` all three pass
  // vacuously: it authors no write RLS (a derived object does not — that IS
  // the declaration), and `resolveSharingCanEdit` asks `canEdit`, which
  // returns `abstain` for it because `effectiveSharingModel` maps
  // `controlled_by_parent` to `public`. ⛔ `abstain` is not `deny` — the
  // distinction is the entire write half of this defect — so `canEdit`
  // answered `true` for EVERY master row and every detail under a two-level
  // chain was writable org-wide. A read-side fix does not reach this path;
  // it is a separate mechanism and it is pinned separately.
  //
  // Walking upward asks the master's own master the same question, which is
  // the question `controlled_by_parent` on the master DECLARES. It terminates
  // on the first master that governs its own rows.
  //
  // Every refusal added here is an AUTHORIZATION verdict and keeps the #7474
  // envelope — `403 PERMISSION_DENIED`, named for the CALLER's object and
  // operation, never for an ancestor the caller never asked about. The three
  // non-verdict codes (422 metadata / 404 missing row / 422 null FK) stay
  // scoped to the caller's own detail: an ancestor that is unresolvable,
  // missing or dangling is not a defect in the request, and answering the
  // caller "your master record does not exist" about a grandparent would be a
  // false statement about their own write.
  let hopRel = rel;
  let hopMasterId: unknown = masterId;
  const visited = new Set<string>([object]);
  let hops = 0;
  for (;;) {
    await this.assertMasterRowEditable(permissionSets, hopRel, hopMasterId, context, opCtx, denyMasterEdit);

    // Does this master govern its own rows? Then the chain ends here — this
    // is the single-level case (#5386), unchanged.
    const masterObject = hopRel.master;
    if (!this.declaresControlledByParent(masterObject)) break;

    if (visited.has(masterObject)) {
      throw masterEditDenied(
        'master_chain',
        `the controlled_by_parent chain from '${object}' re-enters '${masterObject}' (metadata cycle)`,
        hopMasterId,
      );
    }
    visited.add(masterObject);
    if (++hops >= CBP_MAX_CHAIN_DEPTH) {
      throw masterEditDenied(
        'master_chain',
        `the controlled_by_parent chain from '${object}' exceeds the depth bound of ${CBP_MAX_CHAIN_DEPTH}`,
        hopMasterId,
      );
    }

    const nextRel = this.resolveCbpRelation(masterObject);
    if (!nextRel) {
      throw masterEditDenied(
        'master_chain',
        `master '${masterObject}' declares controlled_by_parent with no relation to derive edit access from`,
        hopMasterId,
      );
    }
    // Read as SYSTEM — we only need this row's master FK, exactly as the
    // gate reads the detail's own. A throw here is a store fault and
    // propagates (#7505): an outage must not be reported as an access verdict.
    const masterRow = await this.readRowById(masterObject, hopMasterId, { isSystem: true });
    if (!masterRow) {
      throw masterEditDenied(
        'master_chain',
        `master '${masterObject}' record '${String(hopMasterId)}' is not present, so its own master ` +
          `access cannot be derived`,
        hopMasterId,
      );
    }
    const nextMasterId = masterRow[nextRel.fk];
    if (nextMasterId == null) {
      throw masterEditDenied(
        'master_chain',
        `master '${masterObject}' has no '${nextRel.fk}' master reference to derive edit access from`,
        hopMasterId,
      );
    }
    hopRel = nextRel;
    hopMasterId = nextMasterId;
  }
}

/** The body of `SecurityPlugin#controlledByParentPredicateWriteMasters`; the method's docblock there is its contract. */
export async function controlledByParentPredicateWriteMasters(
  this: Pick<CbpWriteGateHost, 'ql'>,
  object: string,
  operation: string,
  rel: CbpRelation,
  opCtx: any,
): Promise<unknown[]> {
  if (typeof this.ql?.find !== 'function') {
    // Unreachable in a real deployment — `start()` registers no security
    // middleware at all without a query engine — but a non-conforming engine
    // double fails closed rather than admitting an unjudged write.
    throw new Error(
      `[Security] Cannot judge the ${operation} on '${object}' against the masters of the records it ` +
        `selects: no query engine is available to read them.`,
    );
  }
  const callerWhere = (opCtx.options as { where?: unknown } | undefined)?.where;
  const readable = await this.ql.find(object, {
    ...(callerWhere != null ? { where: copyOfCallerPredicate(callerWhere) } : {}),
    fields: ['id'],
    limit: PREDICATE_WRITE_READABLE_ID_CAP + 1,
    // The request's envelope minus the operation-private keys, as the read
    // narrowing asks it: on a delegated write that is the agent's context with
    // the delegation link on it, so the rows are the ones both may read.
    context: withoutOperationPrivateKeys((opCtx.context ?? {}) as Record<string, unknown>),
  });
  const rows: unknown[] = Array.isArray(readable) ? readable : [];
  if (rows.length > PREDICATE_WRITE_READABLE_ID_CAP) {
    throw predicateWriteReadableCapError(object, operation);
  }
  const ids = rows
    .map((r) => (r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined))
    .filter((id) => id !== undefined && id !== null);
  if (ids.length === 0) return [];
  const stored = await this.ql.find(object, {
    where: { id: { $in: ids } },
    fields: ['id', rel.fk],
    limit: ids.length,
    context: { isSystem: true },
  });
  const masterIds = new Set<unknown>();
  for (const row of Array.isArray(stored) ? stored : []) {
    if (!row || typeof row !== 'object') continue;
    const masterId = (row as Record<string, unknown>)[rel.fk];
    if (masterId == null) {
      throw new MasterReferenceMissingError(object, operation, rel.fk, (row as { id?: unknown }).id);
    }
    masterIds.add(masterId);
  }
  return [...masterIds];
}

/** The body of `SecurityPlugin#assertMasterRowEditable`; the method's docblock there is its contract. */
export async function assertMasterRowEditable(
  this: Pick<CbpWriteGateHost, 'checkAuthoredRowWrite' | 'collectRLSPolicies' | 'computeRlsFilter' | 'declaresControlledByParent' | 'delegatorOwnWriteFloorOptions' | 'getObjectSecurityMeta' | 'permissionEvaluator' | 'ql' | 'resolveSharingCanEdit' | 'resolveSharingWriteVerdict'>,
  permissionSets: PermissionSet[],
  rel: CbpRelation,
  masterId: unknown,
  context: any,
  opCtx: any,
  denyMasterEdit: (leg: ControlledByParentWriteDenialLeg, reason: string, recordId?: unknown) => never,
): Promise<void> {
  // Master edit access = CRUD update on the master AND the master row reachable
  // under BOTH halves of its own write gate (write RLS + record sharing).
  //
  // [ADR-0055 §3] The object-level half asks the question the master's own
  // write door asks of an `update` on the master, with that door's own
  // inputs, read from the one source each door reads them from
  // ({@link getObjectSecurityMeta}): the posture must resolve (#3545 — an
  // unresolved posture would read as `isPrivate: false`), the capabilities
  // the master requires for `update` must be held (ADR-0066 D3/⑤), and the
  // CRUD grant is asked under the master's posture (ADR-0066 D2). The leg
  // used to ask the CRUD grant alone, with no posture, so a principal the
  // master's own door refuses at its object gate could still write the
  // master's details. Every refusal here is this leg's, `object_permission`.
  // ⛔ Nothing here re-derives a rule: each is the evaluator's or the
  // posture's own answer, asked as the door asks it.
  const masterPosture = await this.getObjectSecurityMeta(rel.master);
  if (masterPosture.unresolved) {
    denyMasterEdit('object_permission', `the security posture of master '${rel.master}' could not be resolved`, masterId);
  }
  const masterUpdateCaps = requiredCapsForOperation(masterPosture.requiredPermissions, 'update');
  if (masterUpdateCaps.length > 0) {
    const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
    if (masterUpdateCaps.some((cap) => !held.has(cap))) {
      denyMasterEdit('object_permission', `master '${rel.master}' requires a capability this user does not hold`, masterId);
    }
  }
  if (
    !this.permissionEvaluator.checkObjectPermission('update', rel.master, permissionSets, {
      isPrivate: masterPosture.isPrivate,
    })
  ) {
    denyMasterEdit('object_permission', `no edit permission on master '${rel.master}'`, masterId);
  }
  // [commit 498f4e884] The master's own write RLS — composed with the SAME ownership
  // authority the by-id write pre-image gate (step 2.7) composes with, which
  // is the whole of this card.
  //
  // This leg used to call `computeRlsFilter(rel.master, 'update')` with no
  // options, so the platform's ownership floor (`created_by ==
  // current_user.id`, `member_default`) stood here while step 2.7 dropped it
  // for the identical (principal, master row, `update`) on a sharing `allow`.
  // Net: every widening mechanism the platform declares — write DEPTH, an
  // `edit`-level `sys_record_share`, `modifyAllRecords` — worked on the master
  // itself and was inert for its children, so an app author saw a master they
  // could edit and children they could not. Same shape #8679 closed in leg 2
  // below, one leg over; maintainer ruling 2026-08-15, direction 1: one
  // composition, both paths, and the permission-boundary widening (children
  // become writable by principals whose sharing verdict on the master is
  // `allow`) is explicitly approved.
  //
  // The composition is step 2.7's, clause for clause, and each clause is
  // load-bearing:
  //
  //  • ask the verdict ONLY when the floor is actually in play for this
  //    (principal, master, `update`) — no floor, nothing to replace, and no
  //    reason to spend a sharing probe on every detail write;
  //  • `allow` alone drops it. `abstain` (record sharing does not enforce on
  //    this master at all) and `deny` both leave it standing — #5492's E2
  //    measurement is what makes the tri-state necessary here, and
  //    {@link resolveSharingWriteVerdict} answers `deny` when its own probe
  //    throws, so no failure mode of this composition can widen;
  //  • the verb is `update`, matching the object-level check above and leg 2
  //    below: this gate's question is EDIT access to the master, never the
  //    detail's own verb;
  //  • [#23093] `masterGateCoversThisWrite` IS set for a master that is itself
  //    `controlled_by_parent`, on a non-delegated write. Maintainer ruling on
  //    #23093 (letter A, 2026-10-12) extends the 2026-08-15 ruling — commit
  //    6feac910b, which hands such an object's platform floor to its master
  //    gate on its own by-id write (step 2.7) — to this hop. Before it, one
  //    principal and one middle master row got two answers to one `update`:
  //    the master's own door dropped the floor, a write to any of its details
  //    kept it here. So an organization member who could edit a quote could
  //    not edit its lines unless they had created the quote, and the quote's
  //    creator could edit the lines of a quote an app policy refused them
  //    (the floor and that policy compose as alternatives). The hop now asks
  //    the composition that door asks, clause for clause: only the PLATFORM
  //    floor yields; an app-authored update policy on the master and the
  //    #7665 derive-from-select floor still run, and refuse here exactly as
  //    they refuse the door. The vouch holds structurally, as step 2.7's
  //    does: the flag is set on the very predicate
  //    (`declaresControlledByParent(rel.master)`) that makes the walk in
  //    {@link SecurityPlugin.assertControlledByParentWrite} continue to this
  //    master's own master, so this master's own master gate runs next, for
  //    this principal, on this pass — or the walk refuses (cycle, depth bound,
  //    broken chain). A master that governs its own rows never sets it.
  //    Pinned in `controlled-by-parent-chain-middle-master.test.ts`.
  //
  // [ADR-0090 D10] The on-behalf-of path is EXCLUDED, mirroring step 2.7's
  // `floorApplies` and its `masterGateCoversThisWrite = !delegatorSets` — from
  // the sharing-verdict floor drop and from the vouch alike. The delegation
  // fact is read off `opCtx.context` rather than off `context`, because THIS
  // METHOD RUNS TWICE for a delegated write
  // — once per principal, with the delegator's own context substituted — and
  // only the shared `opCtx` carries the link on both passes. (At this point
  // `!!opCtx.context?.onBehalfOf?.userId` is the middleware's `!!delegatorSets`:
  // step 2.8's guard has already established `permissionSets.length > 0`, and
  // a link naming a non-existent delegator throws before either call.) Reading
  // `context` instead would drop the floor for the delegator's pass and keep
  // it for the agent's — the half-state commit 6feac910b left as a residual rather
  // than resolve by a guess. The delegated write keeps BOTH floors, exactly as
  // before this change.
  const delegatedWrite = !!opCtx?.context?.onBehalfOf?.userId;
  const masterFloorApplies =
    !delegatedWrite &&
    this.collectRLSPolicies(
      permissionSets,
      rel.master,
      'update',
      (context?.positions ?? []) as string[],
      context,
    ).some(isPlatformOwnershipFloorPolicy);
  const dropPlatformOwnershipFloor = masterFloorApplies
    ? (await this.resolveSharingWriteVerdict(
        'update',
        rel.master,
        String(masterId),
        context,
        permissionSets,
      )) === 'allow'
    : false;
  const masterWriteFilter = await this.computeRlsFilter(permissionSets, rel.master, 'update', context, {
    dropPlatformOwnershipFloor,
    masterGateCoversThisWrite: !delegatedWrite && this.declaresControlledByParent(rel.master),
  });
  // [ADR-0090 D10] On the DELEGATOR's pass of a delegated write — `context`
  // is the delegator's own (no delegation link) while `opCtx` carries the
  // link — the master must also be editable under the composition the
  // delegator's OWN direct write of this detail gets on this hop: its own
  // floor decision on the master row, and the vouch the direct hop makes
  // ({@link delegatorOwnWriteFloorOptions}). ANDed beside the filter above,
  // so it only narrows: an on-behalf-of detail write never passes a master
  // the delegator's own detail write is refused on. The agent's pass is
  // unchanged.
  const delegatorPass = delegatedWrite && !context?.onBehalfOf?.userId;
  const delegatorOwnMasterWriteFilter = delegatorPass
    ? await this.computeRlsFilter(
        permissionSets,
        rel.master,
        'update',
        context,
        await this.delegatorOwnWriteFloorOptions(
          'update',
          rel.master,
          String(masterId),
          context,
          permissionSets,
          this.declaresControlledByParent(rel.master),
        ),
      )
    : null;
  const masterWriteParts = [masterWriteFilter, delegatorOwnMasterWriteFilter].filter(Boolean) as Record<string, unknown>[];
  if (masterWriteParts.length > 0) {
    let visible: unknown = null;
    // [#7505] This catch STAYS, and the difference from the existence probe
    // above is the whole per-caller distinction the ruling asks for. That
    // probe asks "does this row exist" — a question an outage leaves
    // unanswered, and answering it "no" is a lie with a terminal 404 on it.
    // This one asks "is the master VISIBLE to you under your own write
    // policy" — a question whose fail-closed default IS "not visible", which
    // is what the 403 below says. The ruling names this probe (and the
    // sharing half beneath it) as the house fail-closed posture to match,
    // not as a site to change.
    try {
      visible = await this.ql.findOne(rel.master, {
        where: { $and: [{ id: masterId }, ...masterWriteParts] },
        context,
      });
    } catch {
      visible = null;
    }
    if (!visible) {
      denyMasterEdit('row_level_security', `master '${rel.master}' not editable by this user (row-level security)`, masterId);
    }
  }
  // [#5386] The OWD / record-share half — asked UNCONDITIONALLY, because the
  // RLS half above is skipped whole when the master authors no write policy,
  // which is exactly the common case this closes.
  //
  // [#8679] …and it DEFERS before it hard-refuses, exactly as the by-id write
  // path has since #5493 (PR #6909). Record sharing answering "not editable"
  // is not the whole determination: an app-authored RLS update-widener on the
  // MASTER can admit the row by declaration, and asking that question is what
  // #6909 installed on the sharing middleware's refusal branch. This call site
  // never asked it, so one principal, one master row and one operation got two
  // different answers depending on WHO WAS ASKING — the master itself: allowed;
  // a child of it: `403 … (record sharing)`. `security/explain` agreed with the
  // first. Measured on 17.0.0 GA with the only variable being who created the
  // master (the enrolment path of a real app's core write surface).
  //
  // This is the SAME composition, not a second one and not a relaxation:
  //   • the verdict comes from {@link checkAuthoredRowWrite} — the method
  //     `SharingService.probeAuthoredRowWrite` passes straight through to, so
  //     the answer here is byte-for-byte the one a direct by-id write of this
  //     master would get. There is no copy to drift, which matters because a
  //     duplicated permission composition is how these two paths diverged;
  //   • the operation asked is `update`, matching the two legs above — this
  //     gate's whole question is EDIT access to the master, never the detail's
  //     own verb (deleting a child does not delete the master);
  //   • `admit` retracts only THIS leg's refusal. The object-level `update`
  //     grant and the master's own write-RLS leg have already run above and
  //     still refuse on their own terms, mirroring the by-id path where an
  //     `admit` hands the row on to the pre-image gate rather than authorizing
  //     anything;
  //   • every other outcome — `abstain`, no authored policy, a `check`-only
  //     policy, a principal-less or delegated context, a throwing probe —
  //     leaves the refusal below untouched, byte for byte. The method is
  //     fail-closed in the `abstain` direction and swallows its own throws, so
  //     no failure mode here can widen access.
  if (!(await this.resolveSharingCanEdit(rel.master, String(masterId), context, permissionSets))) {
    const authored = await this.checkAuthoredRowWrite(
      rel.master,
      String(masterId),
      'update',
      context,
    );
    if (authored !== 'admit') {
      denyMasterEdit('record_sharing', `master '${rel.master}' not editable by this user (record sharing)`, masterId);
    }
  }
}
