// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 16] The body of `ObjectQL#validate`, the write preview (run the
 * write path's own verdict over candidate rows and report it, persisting
 * nothing), moved out of `engine.ts`.
 *
 * A MOVE, not a redesign. The exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. The method's docblock stays on the method in
 * `engine.ts`, which is still the contract.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts`, applied as
 * `engine-driver-options.ts` applies it. The class keeps `validate` with name,
 * modifiers, signature, docblock and position; its body becomes one literal of
 * exactly the {@link ValidateHost} members it reads, plus a `.call`. The fields
 * it reads (`_registry`, `_writeWallVerdict`, `logger`, `_writeGateProbe`) go
 * as GETTERS, so each read happens when the body makes it, as it did; the body
 * assigns no field. The methods it calls go as late-bound closures over the
 * instance, so a double or spy set on the engine is still the one a call
 * reaches.
 *
 * ## Module helpers
 *
 * Seven helpers are read by this body AND by bodies that stay:
 * `undeclaredWriteFieldErrors` and `stripComputedWriteFields` (`insert`,
 * `update`), `droppedFieldEvents` (`insert`), `insertStaticReadonlySubject`
 * (`insert`, `withholdInsertReadonlyFromHooks`), `updateStaticReadonlySubject`
 * (`update`, `staticReadonlyStoredView`), `shouldSkipStateMachine` (`insert`,
 * `update`) and `servedAsStored` (`engine-master-detail-related.ts`). One home
 * each: they stay declared in `engine.ts`, exported in place (`servedAsStored`
 * already was), and are imported here, never copied. Nothing re-exports them
 * from the package entry, so the published surface does not move.
 *
 * That import is a run-time module cycle (`engine.ts` imports this module,
 * this module imports `engine.ts`). Nothing here runs at module evaluation,
 * only declarations, and `engine.ts` imports this module after every module
 * this one imports, so the engine's evaluation order is what it was. The
 * published build bundles both files into one, where the cycle does not
 * exist.
 */

import { RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ValidateDataIssue, ValidateDataResponse } from '@objectstack/spec/api';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';
import { validateRecordInScope, normalizeBlankTypedValues, normalizeNumericStringValues, ValidationError, valueShapeStrictEffective, mediaStrictEffective } from './validation/record-validator.js';
import { evaluateValidationRules, hasParentScopedRequiredWhen, stripReadonlyFields, stripRuntimeOwnedFields } from './validation/rule-validator.js';
import { createBatchSummaryAccumulator } from './summary-batch-accumulation.js';
import { resolveEngineUpdateDispatch, type EngineUpdateDispatchData } from './engine-update-dispatch.js';
import {
  droppedFieldEvents,
  insertStaticReadonlySubject,
  servedAsStored,
  shouldSkipStateMachine,
  stripComputedWriteFields,
  undeclaredWriteFieldErrors,
  updateStaticReadonlySubject,
} from './engine.js';
import type { ObjectQL, WriteWallRowVerdict } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters, and which one also has a setter.
 */
export interface ValidateHost {
  readonly _registry: ObjectQL['_registry'];
  readonly _writeWallVerdict: ObjectQL['_writeWallVerdict'];
  readonly logger: ObjectQL['logger'];
  readonly _writeGateProbe: ObjectQL['_writeGateProbe'];
  resolveObjectName: ObjectQL['resolveObjectName'];
  permissionResolution: ObjectQL['permissionResolution'];
  resolveDefaultPermissions: ObjectQL['resolveDefaultPermissions'];
  initializeSummaryFields: ObjectQL['initializeSummaryFields'];
  applyFieldDefaults: ObjectQL['applyFieldDefaults'];
  staticReadonlyCreateStrip: ObjectQL['staticReadonlyCreateStrip'];
  mediaValueShapeStrictFor: ObjectQL['mediaValueShapeStrictFor'];
  valueShapeStrictFor: ObjectQL['valueShapeStrictFor'];
  validationMessageContext: ObjectQL['validationMessageContext'];
  buildEvalUser: ObjectQL['buildEvalUser'];
  findOne: ObjectQL['findOne'];
  readUpdatePriorRow: ObjectQL['readUpdatePriorRow'];
  resolvePreviewParents: ObjectQL['resolvePreviewParents'];
  resolvePredicateRelated: ObjectQL['resolvePredicateRelated'];
  resolveOptionPermissions: ObjectQL['resolveOptionPermissions'];
  getSummaryDescriptors: ObjectQL['getSummaryDescriptors'];
  assertReferencesResolve: ObjectQL['assertReferencesResolve'];
}

/** The body of `ObjectQL#validate`; the method's docblock there is its contract. */
export async function validate(
  this: Pick<ValidateHost, 'resolveObjectName' | '_registry' | 'permissionResolution' | 'resolveDefaultPermissions' | 'initializeSummaryFields' | 'applyFieldDefaults' | '_writeWallVerdict' | 'staticReadonlyCreateStrip' | 'logger' | 'mediaValueShapeStrictFor' | 'valueShapeStrictFor' | 'validationMessageContext' | 'buildEvalUser' | 'findOne' | 'readUpdatePriorRow' | 'resolvePreviewParents' | '_writeGateProbe' | 'resolvePredicateRelated' | 'resolveOptionPermissions' | 'getSummaryDescriptors' | 'assertReferencesResolve'>,
  object: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  options?: {
      mode?: 'insert' | 'update';
      context?: ExecutionContext;
      /**
       * [#20805] The write's own strip listener: called once per `reason` for
       * the fields the write WOULD drop from these rows — the same events, in
       * the same shape, that `insert` / `update` report through
       * `WriteObservabilityOptions.onFieldsDropped`. A listener that throws is
       * logged and ignored, as on the write.
       */
      onFieldsDropped?: WriteObservabilityOptions['onFieldsDropped'];
    },
): Promise<ValidateDataResponse> {
  object = this.resolveObjectName(object);
  const mode = options?.mode ?? 'insert';
  const schemaForValidation = this._registry.getObject(object);

  // [#4633] `insert()` resolves `defaultValue`s and seeds owned roll-up
  // `summary` fields BEFORE it validates, so a required field carrying a
  // default is never missing by the time `validateRecord` runs. The preview
  // has to walk the same two steps or it reports `required` on a row the
  // write happily creates — a FALSE ALARM, and the one failure mode the
  // ruling that created this operation set out to prevent. (Measured on the
  // import dry run: `tier: { required: true, defaultValue: 'standard' }`
  // unmapped ⇒ preview `failed`, write `created`.)
  //
  // Both helpers are pure and synchronous: they read the registry, copy the
  // row, and touch neither driver nor hook — so running them here keeps the
  // "nothing is WRITTEN" contract intact.
  //
  // ⚠️ "Nothing is executed" is no longer literally true and must not be
  // restated as if it were: a traversing validation rule needs its related
  // rows, so this operation issues a READ per reference field the rules name
  // (see the `previewRelatedForRow` block below), and [#22445] an
  // `update`-mode row that carries its address issues two READS of the
  // stored row — the read door under the caller's own context, then the
  // write's own prior-row read (the `storedRows` block below), and [#22474]
  // an object with a parent-scoped `requiredWhen` issues two READS of the
  // master-detail headers its rows name, the same two doors in the same
  // order (the `previewParents` block below). Nothing is
  // written, no write hook runs (a read through the read door fires its read
  // hooks, as the related read always has), and the
  // RELATED read happens only for a caller who passes the arms the
  // write-gate probe RUNS — ⛔ never a category of the write decision, and
  // ⛔ not a promise the write would succeed (`registerWriteGateProbe` names
  // those arms, and the families it does not carry).
  // `update()` deliberately does not default (#2706: a PATCH's explicit
  // `null` means "clear it"), so neither does an `update`-mode preview.
  // [#20308] The write doors read a blank on a non-string-typed column as
  // `null` before anything else; the preview does the same at the same point,
  // or a blank on a required field with a `defaultValue` would preview
  // `required` while the write takes the default. [#20309] Likewise a
  // numeric string on a number field is its number here, as on the write.
  const submittedRows = normalizeNumericStringValues(
    schemaForValidation,
    normalizeBlankTypedValues(schemaForValidation, Array.isArray(data) ? data : [data]),
  );
  // [#20805] THE WRITE'S DOORS, run here by the same functions and in the
  // write's order, so a dry run predicts what the write will do rather than
  // judging a payload the write never stores:
  //  1. the declared-field door (`undeclaredWriteFieldErrors`) — an
  //     undeclared key is refused exactly as `insert()` / `update()` refuse
  //     it: thrown, `INVALID_FIELD` / 400, naming the field. It used to be
  //     answered `valid: true` here while the write refused the row.
  //  2. the computed-field door (`stripComputedWriteFields`) — a `formula`
  //     value is taken out and reported under `computed`, in every context.
  //  3. the caller-write strips (below, after the defaults, where the write
  //     runs them) — reported under `readonly`.
  // Reported through `options.onFieldsDropped`, the listener the write
  // reports through.
  const refusal = undeclaredWriteFieldErrors(
    object,
    schemaForValidation as { fields?: unknown } | undefined,
    submittedRows,
  ).find((e) => e !== undefined);
  if (refusal) throw refusal;
  const computedStrip = stripComputedWriteFields(
    schemaForValidation as { fields?: unknown } | undefined,
    submittedRows,
  );
  const rawRows = computedStrip.rows as Record<string, unknown>[];
  const nowSnapshot = new Date();
  // [#20082] The preview's ONE permission resolution, shared by its CEL
  // defaults and its option gates below, exactly as the write shares one. A
  // resolution failure rejects the preview for a row whose `can` default needed
  // it, as it fails the write.
  const permissionResolution = this.permissionResolution(options?.context);
  const defaultPermissionsFor = mode === 'insert'
    ? await this.resolveDefaultPermissions(object, rawRows, options?.context, permissionResolution)
    : () => undefined;
  const rows: Record<string, unknown>[] = mode === 'insert'
    ? rawRows.map((row) => this.initializeSummaryFields(
        object,
        this.applyFieldDefaults(object, row, options?.context, nowSnapshot, defaultPermissionsFor(row)),
      ) as Record<string, unknown>)
    : rawRows.slice();

  // [#25062] THE LAYER 0 TENANT WALL'S VERDICT on each row, from the layer
  // that owns the wall ({@link registerWriteWallVerdict}), over the rows as
  // the preview holds them: after the defaults, before any hook. The write
  // asks its wall twice, and so does this: on the payload before the strips
  // (here; the write's middleware), and on the rows the strips leave (below;
  // the write's stored-image seam). A refused row is answered with the
  // write's refusal (the `results` block below) and reaches nothing the write
  // does not run for it; an admitted row whose organization the wall judges
  // keeps the column through the static `readonly` strip, as `insert()` /
  // `update()` keep it. `null` (nothing registered, or the wall not asked)
  // leaves every row to the strip, exactly as before. ⛔ Nothing here reads
  // the posture or the context's organizations: the verdict is the wall's
  // own, read as a value.
  const askWriteWall = async (asked: Record<string, unknown>[]) => {
    if (!this._writeWallVerdict || asked.length === 0) return null;
    const verdicts = await this._writeWallVerdict(object, mode, options?.context, asked);
    if (verdicts && verdicts.length !== asked.length) {
      throw new Error(
        `[ObjectQL] the write-wall verdict answered ${verdicts.length} verdict(s) for ` +
          `${asked.length} row(s) of '${object}'`,
      );
    }
    return verdicts;
  };
  const refusalIn = (verdict: WriteWallRowVerdict | undefined) =>
    verdict && verdict.admitted === false ? verdict : undefined;
  const wallVerdicts = await askWriteWall(rows);
  const wallRefusals = rows.map((_, i) => refusalIn(wallVerdicts?.[i]));
  const wallRefusalOf = (i: number) => wallRefusals[i];
  const wallJudgesOrganizationOf = (i: number): boolean => {
    const verdict = wallVerdicts?.[i];
    return verdict?.admitted === true && verdict.judgesOrganization === true;
  };
  const heldBeforeStrips = rows.slice();

  // [#20805] 3. The caller-write strips, over the defaulted rows with the
  // caller's rows as `supplied` — where the write runs them (after the
  // defaults; the write's hooks, which this preview does not run, sit in
  // between) and under the write's `isSystem` gate. The same functions:
  // on `insert`, `stripRuntimeOwnedFields` and then
  // `staticReadonlyCreateStrip` (the static `readonly` strip with its
  // re-default); on `update`, `stripReadonlyFields`, which covers both on
  // that verb. No logger: a preview writes nothing, and a strip line says
  // the value was not stored.
  //
  // ⚠️ On `update`, a supplied `id` is read as the address the write binds —
  // every update door folds the target id into the payload (`updateData`) —
  // and is never judged as a payload key (#8093, ADDRESSING IS NOT PAYLOAD).
  // [#22445] That address now names the stored row the rules judge (the
  // `storedRows` block below). `readonlyWhen` and the primary-key strip are
  // still not run: they remain the named limit `ValidateDataResponse`
  // states, so the preview can report fewer drops than the update.
  //
  // [#20922] Each strip's result is recorded twice at the strip itself: into
  // the batch-level union the listener reports (unchanged), and into the
  // taking row's own list, which becomes that row's `droppedFields` below.
  const readonlyDropped: string[] = [];
  const readonlyDroppedPerRow: string[][] = rows.map(() => []);
  const recordTaken = (i: number, taken: readonly string[]): void => {
    for (const k of taken) {
      if (!readonlyDropped.includes(k)) readonlyDropped.push(k);
      if (!readonlyDroppedPerRow[i]!.includes(k)) readonlyDroppedPerRow[i]!.push(k);
    }
  };
  const collectTaken = (i: number, before: Record<string, unknown>, after: Record<string, unknown>): void => {
    recordTaken(i, Object.keys(before).filter((k) => !(k in after)));
  };
  if (!options?.context?.isSystem) {
    const preserveAudit = options?.context?.preserveAudit === true;
    if (mode === 'insert') {
      for (let i = 0; i < rows.length; i++) {
        if (wallRefusalOf(i)) continue;
        const stripped = stripRuntimeOwnedFields(
          schemaForValidation as any, rows[i], rawRows[i] ?? {}, undefined, { preserveAudit },
        ) as Record<string, unknown>;
        if (stripped === rows[i]) continue;
        collectTaken(i, rows[i]!, stripped);
        rows[i] = stripped;
      }
      // [#25062] The subject per row, as the write's strip judges that row:
      // without `organization_id` where the wall judges it
      // (`insertStaticReadonlySubject`, the write's own view).
      for (let i = 0; i < rows.length; i++) {
        if (wallRefusalOf(i)) continue;
        const readonlySubject = insertStaticReadonlySubject(schemaForValidation, wallJudgesOrganizationOf(i));
        if (!readonlySubject) continue;
        const pass = await this.staticReadonlyCreateStrip(
          object, readonlySubject, rows[i]!, rawRows[i] ?? {}, options?.context,
          { logger: undefined, strictReadonlyWrites: false, hookWrittenKeys: undefined, nowSnap: nowSnapshot, permissionResolution },
        );
        recordTaken(i, pass.taken);
        // The write fails on this resolution failure outside partial mode;
        // a preview has no partial mode, so it fails the same way.
        if (pass.error !== undefined) throw pass.error;
        rows[i] = pass.row;
      }
    } else {
      for (let i = 0; i < rows.length; i++) {
        if (wallRefusalOf(i)) continue;
        const supplied: Record<string, unknown> = { ...(rawRows[i] ?? {}) };
        delete supplied.id;
        // [#25062] The update's own view (`updateStaticReadonlySubject`):
        // the whole schema, without `organization_id` where the wall judges it.
        const stripped = stripReadonlyFields(
          updateStaticReadonlySubject(schemaForValidation, wallJudgesOrganizationOf(i)) as any,
          rows[i], supplied, undefined, { preserveAudit },
        ) as Record<string, unknown>;
        if (stripped === rows[i]) continue;
        collectTaken(i, rows[i]!, stripped);
        rows[i] = stripped;
      }
    }
  }
  // [#25062] …and the wall's STORED-IMAGE half, on each row the strips
  // changed: the row as the write would store it, which the wall has not
  // seen. Where the wall does not judge the organization (a platform
  // operator crossing it with no active organization), the strip takes a
  // caller's organization and the stored row has nowhere to land; the write
  // refuses it there, after its strips, and so does this. A row the strips
  // left alone was answered above. Only a refusal is read here: the spare
  // was decided on the first answer, as the write decides it before its
  // strips.
  const restripped = rows.flatMap((row, i) => (!wallRefusals[i] && row !== heldBeforeStrips[i] ? [i] : []));
  const storedImageVerdicts = await askWriteWall(restripped.map((i) => rows[i]!));
  restripped.forEach((rowIndex, k) => {
    wallRefusals[rowIndex] = refusalIn(storedImageVerdicts?.[k]);
  });

  const onFieldsDropped = options?.onFieldsDropped;
  if (typeof onFieldsDropped === 'function') {
    // [#25062] A row the wall refuses drops nothing: the write that refuses
    // it reports no drop. So the batch union is the admitted rows' alone.
    const admittedTook = (perRow: readonly (readonly string[])[], key: string) =>
      perRow.some((taken, i) => !wallRefusals[i] && taken.includes(key));
    const drops = droppedFieldEvents(
      object,
      computedStrip.dropped.filter((key) => admittedTook(computedStrip.droppedPerRow, key)),
      readonlyDropped.filter((key) => admittedTook(readonlyDroppedPerRow, key)),
    );
    for (const drop of drops) {
      try {
        onFieldsDropped(drop);
      } catch (err) {
        this.logger.warn('onFieldsDropped listener threw — ignored', { object, error: err });
      }
    }
  }

  // Resolved once for the whole set, exactly as the write path resolves them
  // once per batch — this is the "same posture as the real write" guarantee.
  const mediaValueShapeStrict = await this.mediaValueShapeStrictFor(schemaForValidation);
  const valueShapeStrict = await this.valueShapeStrictFor(schemaForValidation);
  const messages = this.validationMessageContext(object, options?.context);
  const currentUser = this.buildEvalUser(options?.context);
  const skipStateMachine = shouldSkipStateMachine(options?.context);

  // [#22445] THE STORED ROW an `update`-mode row is judged against — the
  // by-id update's prior row, read here for the same reason the write reads
  // it: a rule that reads a column the patch omits judges the stored value,
  // so the rules' record is the stored row merged with the patch and their
  // `previous` is the stored row (`evaluateValidationRules` below, called as
  // the by-id branch of `update()` calls it).
  //
  // The address is the write's own: `resolveEngineUpdateDispatch`, the
  // ladder `update()` resolves its by-id branch with, asked of the row as
  // submitted. Two reads, each answering one question:
  //
  //  1. ⛔ MAY THIS CALLER SEE THE ROW — the READ DOOR, under the caller's
  //     own context (`findOne`). The by-id write reads its row raw only after
  //     its middleware's write gates, which answer 404 for a row the caller
  //     cannot read; the preview runs none of them. So a row the read door
  //     does not return is a missing row here too: no image, no verdict about
  //     its columns. A refused read propagates as raised.
  //  2. WHAT IS STORED — the write's own prior-row read
  //     ({@link readUpdatePriorRow}), so the rules judge the row as STORED,
  //     exactly as the write does, and not the read door's served image (a
  //     formula the read door evaluates has no stored column, and the write
  //     judges it absent).
  //
  // ⛔ A stored column is kept ONLY where the read door served this caller
  // that very value ({@link servedAsStored}): the caller can already read it
  // IN FULL. Every other column is left out and judged as empty — one the
  // read door hid (field-level security deletes the key), and one it served
  // TRANSFORMED: a partial mask, which keeps the key and replaces the value,
  // a masked secret, an `internal` column, a read hook's rewrite. A verdict
  // over a masked column's stored value is the probe the security plugin
  // refuses on a query (a partially masked field is as probe-able as a
  // hidden one), and the preview runs none of the write's gates, so it must
  // not answer one. So the verdict never depends on a value this caller
  // could not have read. The read door is asked for file fields in their
  // stored form (`RAW_FILE_VALUES_CONTEXT_KEY`, the declared opt-out for a
  // caller whose subject is the stored form), so a readable file reference
  // compares as the id it is rather than as the expanded object.
  //
  // `undefined` = no stored row: the row is judged on the patch alone, as
  // it was before these reads existed.
  const storedRows: Array<Record<string, unknown> | undefined> = [];
  for (const submitted of submittedRows) {
    let stored: Record<string, unknown> | undefined;
    if (mode === 'update' && submitted && typeof submitted === 'object') {
      const dispatch = resolveEngineUpdateDispatch(submitted as EngineUpdateDispatchData, undefined);
      if (dispatch.kind === 'by-id') {
        const visible = await this.findOne(object, {
          where: { id: dispatch.id },
          context: { ...(options?.context ?? {}), [RAW_FILE_VALUES_CONTEXT_KEY]: true },
        } as EngineQueryOptions);
        const prior = visible && typeof visible === 'object'
          ? await this.readUpdatePriorRow(object, dispatch.id, options?.context)
          : null;
        if (visible && prior) {
          const served = visible as Record<string, unknown>;
          stored = {};
          for (const [key, value] of Object.entries(prior)) {
            if (Object.prototype.hasOwnProperty.call(served, key) && servedAsStored(served[key], value)) {
              stored[key] = value;
            }
          }
        }
      }
    }
    storedRows.push(stored);
  }
  // The merged view each rule evaluates, and the one the reference reads
  // below key on: the write reads a traversed FK off the same merge
  // (`updateView` in `update()`), so a FK the patch omits resolves from the
  // stored row.
  const judgedViews = rows.map((row, i) => (storedRows[i] ? { ...storedRows[i], ...row } : row));

  // [#22474] THE MASTER-DETAIL HEADER a field `requiredWhen` reads as
  // `parent`, bound as the write binds it and under the write's own gate:
  // only an object that declares a parent-scoped `requiredWhen` reads a
  // header (`hasParentScopedRequiredWhen`, the insert's gate and the
  // update's `requiredWhen` half), so every other object's preview reads
  // none. The header is named by the judged view, the write's
  // payload-FK-first reading (`masterIdOf`): the row's own FK on an insert,
  // and on an update the patch's FK, else the stored row's. A repointing
  // update also binds the header the stored row hangs off as
  // `previousParent`, the header the write's ADR-0113 pre-check reads.
  //
  // ⛔ Read under the caller's access, as the write reads it since #22519:
  // see {@link resolvePreviewParents}. A header the caller cannot read binds
  // as a missing header binds; unlike the write, a header column the read
  // door did not serve this caller as stored is judged as empty.
  //
  // Named limit: the update's `readonlyWhen` judgement of the FK itself
  // (`settleMasterDetailLanding` ①) is not run, the limit `readonlyWhen`
  // already holds in this preview, so a repoint that lock would take back
  // out is judged against the header it names.
  const previewParents = hasParentScopedRequiredWhen(schemaForValidation as any)
    ? await this.resolvePreviewParents(schemaForValidation, judgedViews, storedRows, options?.context)
    : undefined;

  // [#18682] The preview owes the SAME relationship resolution the real write
  // does. Without it a rule that reads one hop through a reference field
  // reports `valid: false` (unevaluable) against a row `insert()` happily
  // accepts — the false alarm this operation was created to prevent, and the
  // import dry run rides on it.
  //
  // Resolved once for the whole set, like every other posture input above.
  // [#22445] The named limit that sat here — an `update`-mode preview read
  // no prior row, so a traversing rule whose FK the PATCH did not carry had
  // no id to resolve — is CLOSED for a row that carries its address: the FK
  // is read off `judgedViews`, the stored row merged with the patch. A row
  // with no address (or no stored row this caller can read) still resolves
  // only the FKs its patch carries.
  // [#20805] The second named limit that used to sit here is CLOSED: a
  // reference field the author declared static `readonly` is stripped from a
  // non-system caller's payload by the write, so the write resolves no
  // related row for it — and since the caller-write strips run above, the
  // preview's `rows` have lost it too, and a traversing rule answers the
  // same way on both.
  // ⛔ Behind the caller's own create/update gate — see
  // {@link registerWriteGateProbe}. A caller the probe refuses gets NO
  // elevated read: `related` stays unresolved, and a traversing rule then
  // refuses, which is the fail-closed direction and is honest about what it
  // did not evaluate.
  // ⛔ `submittedRows`, not `rows`: the gate's field-level arm judges WHICH
  // FIELDS THE CALLER WROTE, and `rows` has already been through the strips,
  // `applyFieldDefaults` / `initializeSummaryFields` above. Handing it the
  // defaulted image would offer the plugin keys the caller never sent — the
  // exact reading the middleware avoids by gating on `opCtx.data`, which is
  // the raw payload (defaults are resolved inside the executor, under it).
  // [#20805] Nor the stripped `rawRows`: the middleware runs BEFORE the
  // write's computed-field door, so it judges the caller's keys as sent.
  const mayWrite = this._writeGateProbe
    ? await this._writeGateProbe(object, mode, options?.context, submittedRows).catch(() => false)
    : true;
  const previewRelatedForRow = mayWrite
    ? await this.resolvePredicateRelated(schemaForValidation, judgedViews, options?.context)
    : () => undefined;
  // [#18783] The preview answers a `can`-gated option with the SAME map the
  // write would — resolved once for the whole set, like every posture input
  // above. A resolution failure rejects the preview, as it fails the write.
  const previewPermissionsFor = await this.resolveOptionPermissions(schemaForValidation, rows, permissionResolution);
  // [#25579] A multi-row insert preview judges a rule reading a parent
  // roll-up the way the write judges the batch: each row sees the earlier
  // rows the preview accepted, accumulated in memory (see `insert()`).
  const batchSummaries = mode === 'insert' && rows.length > 1
    ? createBatchSummaryAccumulator(this.getSummaryDescriptors(object), (schemaForValidation as any)?.fields)
    : undefined;

  // [#26684] Judged one row after another, as the write's validation loop
  // judges them: a row's admission (the reference check below) is awaited
  // before the next row reads what the earlier rows added.
  const judgeRow = async (row: Record<string, unknown>, i: number): Promise<NonNullable<ValidateDataResponse['results']>[number]> => {
    const warnings: ValidateDataIssue[] = [];
    // Warn-first admissions are the posture signal the caller came for, so
    // they are reported — into this row's own bucket, never into the
    // certification sink (see the note above).
    //
    // Carried under the code the STRICT path would have FAILED with
    // (`invalid_type`) rather than a warning-specific one: the same bad
    // value is one finding that changed buckets when the posture changed,
    // and a caller diffing a preview against a write should see that, not
    // two vocabularies. The sink's payload is `{gate, field, type, detail}`,
    // so the message is composed the way the warn-first log line composes it.
    const onAdmittedValueShapeViolation = (violation: any) => {
      const field = String(violation?.field ?? '');
      const type = String(violation?.type ?? '');
      const detail = String(violation?.detail ?? 'invalid value shape');
      warnings.push({
        field,
        code: 'invalid_type',
        message: `${field} has an invalid ${type} value: ${detail}`,
      });
    };
    // [#25062] A row the tenant wall refuses is answered with the write's
    // refusal, which the write gives before it validates anything.
    const wallRefusal = wallRefusalOf(i);
    if (wallRefusal) {
      return {
        valid: false,
        errors: [{ field: wallRefusal.field, code: wallRefusal.code, message: wallRefusal.message }],
        warnings,
      };
    }
    try {
      // [#21663] `'include'` in both modes: the caller-write strips ran
      // above, so this is the payload the write stores — and the write
      // judges its readonly values' shape (insert in the same call, update
      // in a second pass after its own strip).
      validateRecordInScope(schemaForValidation, row, mode, 'include', {
        mediaValueShapeStrict, valueShapeStrict, messages, onAdmittedValueShapeViolation,
        // [#22183] The option values an import kept for this write — the
        // preview admits exactly what the write would.
        keptOptionValues: options?.context?.keptOptionValues,
      });
      warnings.push(...evaluateValidationRules(schemaForValidation as any, row, mode, {
        // [#22445] The stored row, when this row named one: the by-id
        // update's `previous: priorRecord`. Absent, the record is the patch.
        ...(storedRows[i] ? { previous: storedRows[i] } : {}),
        logger: this.logger, currentUser, skipStateMachine, messages,
        // [#22474] The header the write binds: the insert's
        // `insertParentForRow`, the update's landing header and, for a
        // repoint, `roWhenPreviousParent`.
        parent: previewParents?.parents[i],
        previousParent: previewParents?.previousParents[i],
        related: batchSummaries ? batchSummaries.overlay(previewRelatedForRow(judgedViews[i])) : previewRelatedForRow(judgedViews[i]),
        permissions: previewPermissionsFor(row),
      }));
      // [#26684] The insert's admit step, run as `insert()` runs it: after
      // the rules, the reference check on the ids the caller supplied
      // (`rawRows`, before the defaults — the write's `suppliedPerRow`), so
      // a row the write refuses on a dangling reference is refused here
      // with the same finding, and is not counted toward a later row's
      // parent summary. ⛔ Behind the same write-gate probe as the related
      // read above: the probe on a `lookup` target is elevated, so a caller
      // the probe refuses learns nothing about which ids exist.
      if (mode === 'insert' && mayWrite) {
        await this.assertReferencesResolve(schemaForValidation, row, rawRows[i], options?.context, messages);
      }
    } catch (e) {
      if (e instanceof ValidationError) {
        return { valid: false, errors: e.fields.map((f) => ({ ...f })), warnings };
      }
      throw e;
    }
    batchSummaries?.accept(row);
    // [#20922] THIS row's drops, from the strips' own per-row record above
    // — the report `insertMany` hangs on the same row's `ok` outcome, so a
    // dry run and its commit answer one row in one vocabulary. Only on a
    // row the verdict accepts: a drop is "the write completed without
    // them", and the write refuses an invalid row, so it drops nothing
    // (`insertMany` answers that row `ok: false`, with no drops). Absent
    // when nothing would be taken.
    const droppedFields = droppedFieldEvents(object, computedStrip.droppedPerRow[i]!, readonlyDroppedPerRow[i]!);
    return { valid: true, errors: [], warnings, ...(droppedFields.length > 0 ? { droppedFields } : {}) };
  };
  const results: NonNullable<ValidateDataResponse['results']> = [];
  for (let i = 0; i < rows.length; i++) results.push(await judgeRow(rows[i]!, i));

  return {
    object,
    mode,
    valid: results.every((r) => r.valid),
    results,
    // The EFFECTIVE posture, not the raw deployment flag. `validateRecord`
    // runs the flag through `valueShapeStrictEffective`, where the ADR-0104
    // env switches take precedence over it, so reporting the flag would
    // describe a different posture than the one that just decided the
    // verdict — on a deployment holding the flag but running with
    // `OS_ALLOW_LAX_VALUE_SHAPES`, exactly backwards. Reporting what decided
    // is the whole point of returning it.
    posture: {
      valueShapeStrict: valueShapeStrictEffective(valueShapeStrict),
      mediaValueShapeStrict: mediaStrictEffective(mediaValueShapeStrict),
    },
  };
}
