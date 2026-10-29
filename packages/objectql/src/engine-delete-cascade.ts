// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 19] Five bodies of the `ObjectQL` "Delete cascade and
 * reference walking" section, moved out of `engine.ts`: the read-only
 * collection walk that builds a cascade's delete set
 * (`collectCascadeDeleteSet`), the in-cascade `restrict` judge
 * (`refuseRestrictsInsideOwnCascade`), the `409 DELETE_RESTRICTED` refusal
 * it and the deleting walk throw (`deleteRestrictedError`), the
 * reference-probe filter (`referenceProbeFilter`) and the reference-check
 * elevation record (`recordReferenceCheckElevation`).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied as
 * `engine-count-aggregate.ts` applies it. The class keeps each method with
 * name, modifiers, signature, docblock and position; its body becomes one
 * literal of exactly the {@link DeleteCascadeHost} members it reads, plus a
 * `.call` (`referenceProbeFilter` reads no member and is called directly).
 * The one field read (`logger`) goes as a GETTER, so the read happens when
 * the body makes it, as it did; no body assigns a field. The methods called go
 * as late-bound closures over the instance, so a double or spy set on the
 * engine is still the one a call reaches.
 *
 * ## What stays in the class
 *
 * - Every body of the section that reads a private static
 *   (`MAX_CASCADE_DEPTH`, `REFERENCE_PROBE_BATCH`, `storedReferenceIncludes`,
 *   `remainderAfterMemberRemoval`, `referenceCheckContext`,
 *   `outlivesOrganization`, `keepsOrganizationReference`,
 *   `organizationCountContext`), since a module function cannot read one,
 *   and the statics with them: `planCascadeAtomicity`,
 *   `cascadeDeleteRelations`, `dependentCountIsDisclosable`,
 *   `probeReferencingRows`, `probeReferencingRowsOfSet`,
 *   `walkReferencingRelations`, `countReferencingRowsOutside`,
 *   `refuseOrganizationDeleteWhileOwned` and `organizationOwnedRowCounts`.
 * - `cascadeRelationBehavior`: `federated-injected-column-readers.test.ts`
 *   checks a `via` row by reading the helper it names in the SAME file as the
 *   site that calls it (`organizationOwnedRowCounts`).
 * - The bodies of a few lines that would not pay for their host.
 *
 * ## Module helpers
 *
 * The bodies read four top-level `engine.ts` helpers that staying bodies
 * read too: `cascadeMemberKey`, `cascadeSetAdd`, `cascadeSetHas` and
 * `declaredMultiValued`, and the `CascadeDeleteSet` type. One home each:
 * they stay declared in `engine.ts`, exported in place, and are imported
 * here, never copied. Nothing re-exports them from the package entry, so the
 * published surface does not move. `cascadeReachOf`, read only by
 * `refuseRestrictsInsideOwnCascade`, moved here with it.
 *
 * That import is a run-time module cycle (`engine.ts` imports this module,
 * this module imports `engine.ts`). Nothing here runs at module evaluation,
 * only declarations, and the helpers are read only when a body runs, after
 * both modules have evaluated. `engine.ts` imports this module after every
 * other module this one imports, so the evaluation order of every module is
 * what it was. The published build bundles both files into one, where the
 * cycle does not exist.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { renderOperationMessage } from '@objectstack/spec/system';
import { resolveFieldLabel } from './validation/record-validator.js';
import {
  cascadeMemberKey,
  cascadeSetAdd,
  cascadeSetHas,
  declaredMultiValued,
} from './engine.js';
import type { CascadeDeleteSet, ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface DeleteCascadeHost {
  readonly logger: ObjectQL['logger'];
  cascadeRelationBehavior: ObjectQL['cascadeRelationBehavior'];
  fileReferenceCheckElevation: ObjectQL['fileReferenceCheckElevation'];
  probeReferencingRowsOfSet: ObjectQL['probeReferencingRowsOfSet'];
  deleteRestrictedError: ObjectQL['deleteRestrictedError'];
  referenceProbeFilter: ObjectQL['referenceProbeFilter'];
  validationMessageContext: ObjectQL['validationMessageContext'];
  dependentCountIsDisclosable: ObjectQL['dependentCountIsDisclosable'];
  objectDisplayLabel: ObjectQL['objectDisplayLabel'];
}

/**
 * [#26718] Every member a cascade reaches from `object`/`id` through the
 * set's own {@link CascadeDeleteSet.cascadeEdges}: its details, theirs, and so
 * on, indexed like {@link CascadeDeleteSet.members}. The member itself is in
 * it only when a cycle in the data leads back.
 */
function cascadeReachOf(set: CascadeDeleteSet, object: string, id: unknown): Map<string, Set<string>> {
  const reach = new Map<string, Set<string>>();
  const queue: Array<{ object: string; id: unknown }> = [{ object, id }];
  for (const from of queue) {
    for (const next of set.cascadeEdges.get(cascadeMemberKey(from.object, from.id)) ?? []) {
      if (cascadeSetAdd(reach, next.object, next.id)) queue.push(next);
    }
  }
  return reach;
}

/** The body of `ObjectQL#referenceProbeFilter`; the method's docblock there is its contract. */
export function referenceProbeFilter(
  fieldName: string,
  fdef: { type?: unknown; multiple?: unknown },
  id: string | number,
): Record<string, unknown> {
  // [#18408] Was `fdef?.multiple !== true`. See {@link declaredMultiValued}.
  if (!declaredMultiValued(fdef)) return { [fieldName]: id };
  const raw = String(id);
  // The BODY of the JSON string form — `JSON.stringify('a"b')` is `"a\"b"`,
  // and the quotes are the serialization's, not the id's.
  const escaped = JSON.stringify(raw).slice(1, -1);
  if (escaped === raw) return { [fieldName]: { $contains: raw } };
  return {
    $or: [
      { [fieldName]: { $contains: raw } },
      { [fieldName]: { $contains: escaped } },
    ],
  };
}

/** The body of `ObjectQL#recordReferenceCheckElevation`; the method's docblock there is its contract. */
export function recordReferenceCheckElevation(
  this: Pick<DeleteCascadeHost, 'logger'>,
  object: string,
  id: string | number,
  childName: string,
  fieldName: string,
  context?: ExecutionContext,
): void {
  // The triggered-by half. `userId` survives the `sudo()`-shaped elevation,
  // which is what makes the two halves recordable at all; `actor` is the
  // service-principal channel (the `ExecutionContext.actor` contract,
  // `@objectstack/spec` kernel/execution-context.zod.ts) that keeps a
  // non-user-authenticated caller attributable instead of anonymous.
  const triggeredBy =
    (context?.userId != null && String(context.userId)) ||
    (typeof (context as any)?.actor === 'string' && (context as any).actor.trim()) ||
    // Not "unknown": a context with neither channel IS the platform acting
    // for itself (boot provisioning, seed replay, an inner cascade), and
    // naming that honestly is more useful than a null.
    (context?.isSystem === true ? 'system' : 'anonymous');
  this.logger.info(
    `[reference-cleanup] referential integrity check on '${childName}' executed as SYSTEM ` +
    `for delete of ${object}/${String(id)} triggered by ${triggeredBy}`,
    {
      triggeredBy,
      executedAs: 'system',
      object,
      recordId: String(id),
      referencedObject: childName,
      relationField: fieldName,
    },
  );
}

/** The body of `ObjectQL#collectCascadeDeleteSet`; the method's docblock there is its contract. */
export async function collectCascadeDeleteSet(
  this: Pick<DeleteCascadeHost, 'cascadeRelationBehavior' | 'fileReferenceCheckElevation' | 'probeReferencingRowsOfSet'>,
  object: string,
  ids: ReadonlyArray<string | number>,
  context: ExecutionContext | undefined,
  objects: ServiceObject[],
  opts: { fileElevations: boolean } = { fileElevations: true },
): Promise<CascadeDeleteSet> {
  const set: CascadeDeleteSet = {
    members: new Map(), entered: new Map(), elevationsFiled: new Set(), cascadeEdges: new Map(), cleared: new Map(),
  };
  let frontier = new Map<string, Array<string | number>>([[object, []]]);
  for (const id of ids) {
    if (cascadeSetAdd(set.members, object, id)) frontier.get(object)!.push(id);
  }
  // The cascading relations pointing at each object, scanned once per object
  // rather than once per record: a wide cascade has many records of few
  // objects.
  const cascading = new Map<string, Array<{ childName: string; fieldName: string; fdef: any }>>();
  const cascadingInto = (target: string) => {
    let relations = cascading.get(target);
    if (!relations) {
      relations = [];
      for (const child of objects) {
        const childName = (child as any)?.name as string | undefined;
        const fields = (child as any)?.fields as Record<string, any> | undefined;
        if (!childName || !fields) continue;
        for (const [fieldName, fdef] of Object.entries(fields)) {
          if (this.cascadeRelationBehavior(target, child, fieldName, fdef) === 'cascade') {
            relations.push({ childName, fieldName, fdef });
          }
        }
      }
      cascading.set(target, relations);
    }
    return relations;
  };
  // Breadth-first, one depth at a time: the records each depth adds are the
  // next one's targets, grouped by object.
  while (frontier.size > 0) {
    const next = new Map<string, Array<string | number>>();
    for (const [target, targetIds] of frontier) {
      if (targetIds.length === 0) continue;
      for (const { childName, fieldName, fdef } of cascadingInto(target)) {
        if (opts.fileElevations) {
          for (const id of targetIds) {
            this.fileReferenceCheckElevation(set, target, id, childName, fieldName, context);
          }
        }
        const referencing = await this.probeReferencingRowsOfSet(childName, fieldName, fdef, targetIds, context);
        for (const id of targetIds) {
          for (const row of referencing.get(String(id)) ?? []) {
            const depId = row?.id;
            if (depId == null) continue;
            // [#26718] The edge is kept even for a row already in the set: a
            // row reached by two paths is in the reach of both.
            const from = cascadeMemberKey(target, id);
            let edges = set.cascadeEdges.get(from);
            if (!edges) { edges = []; set.cascadeEdges.set(from, edges); }
            edges.push({ object: childName, id: depId });
            if (cascadeSetAdd(set.members, childName, depId)) {
              let found = next.get(childName);
              if (!found) { found = []; next.set(childName, found); }
              found.push(depId);
            }
          }
        }
      }
    }
    frontier = next;
  }
  return set;
}

/** The body of `ObjectQL#refuseRestrictsInsideOwnCascade`; the method's docblock there is its contract. */
export async function refuseRestrictsInsideOwnCascade(
  this: Pick<DeleteCascadeHost, 'cascadeRelationBehavior' | 'fileReferenceCheckElevation' | 'probeReferencingRowsOfSet' | 'deleteRestrictedError' | 'referenceProbeFilter'>,
  cascadeSet: CascadeDeleteSet,
  roots: ReadonlyArray<{ object: string; id: string | number }>,
  context: ExecutionContext | undefined,
  objects: ServiceObject[],
): Promise<void> {
  // The members with the ids as the rows carried them (the set's own index
  // holds strings), so each probe below spells its filter as the walk does:
  // the roots, then every member in the order the collection found it.
  const members: Array<{ object: string; id: string | number }> = [];
  const seen = new Set<string>();
  const visit = (member: { object: string; id: string | number }) => {
    const key = cascadeMemberKey(member.object, member.id);
    if (seen.has(key)) return;
    seen.add(key);
    members.push(member);
  };
  for (const root of roots) visit(root);
  for (const member of members) {
    for (const next of cascadeSet.cascadeEdges.get(cascadeMemberKey(member.object, member.id)) ?? []) visit(next);
  }
  // The restrict relations pointing at each object whose own object has a
  // member, scanned once per object.
  const restricting = new Map<string, Array<{ child: ServiceObject; childName: string; fieldName: string; fdef: any }>>();
  const restrictingInto = (target: string) => {
    let relations = restricting.get(target);
    if (!relations) {
      relations = [];
      for (const child of objects) {
        const childName = (child as any)?.name as string | undefined;
        const fields = (child as any)?.fields as Record<string, any> | undefined;
        if (!childName || !fields || !cascadeSet.members.has(childName)) continue;
        for (const [fieldName, fdef] of Object.entries(fields)) {
          if (this.cascadeRelationBehavior(target, child, fieldName, fdef) === 'restrict') {
            relations.push({ child, childName, fieldName, fdef });
          }
        }
      }
      restricting.set(target, relations);
    }
    return relations;
  };
  // [#27004] Which member asks which relation, in the order it is judged:
  // a relation is asked about a member only when its object has a member in
  // that member's reach.
  type Relation = { child: ServiceObject; childName: string; fieldName: string; fdef: any };
  const asks: Array<{ object: string; id: string | number; relation: Relation; reach: Map<string, Set<string>> }> = [];
  const askedOf = new Map<Relation, { object: string; ids: Array<string | number> }>();
  for (const { object, id } of members) {
    const relations = restrictingInto(object);
    if (relations.length === 0) continue;
    const reach = cascadeReachOf(cascadeSet, object, id);
    for (const relation of relations) {
      if (!reach.has(relation.childName)) continue;
      asks.push({ object, id, relation, reach });
      let asked = askedOf.get(relation);
      if (!asked) { asked = { object, ids: [] }; askedOf.set(relation, asked); }
      asked.ids.push(id);
    }
  }
  // One probe per relation per batch of the members asking it.
  const referencing = new Map<Relation, Map<string, any[]>>();
  for (const [relation, { object, ids }] of askedOf) {
    const { childName, fieldName, fdef } = relation;
    for (const id of ids) this.fileReferenceCheckElevation(cascadeSet, object, id, childName, fieldName, context);
    referencing.set(relation, await this.probeReferencingRowsOfSet(childName, fieldName, fdef, ids, context));
  }
  for (const { object, id, relation, reach } of asks) {
    const { child, childName, fieldName, fdef } = relation;
    const rows = referencing.get(relation)!.get(String(id)) ?? [];
    const dependents = rows.filter((row) => cascadeSetHas(reach, childName, row?.id));
    if (dependents.length === 0) continue;
    throw await this.deleteRestrictedError({
      object, id, child, childName, fieldName, fdef, dependents,
      probeWhere: this.referenceProbeFilter(fieldName, fdef, id),
      probedIds: rows.map((r: any) => String(r?.id)),
      multiValued: declaredMultiValued(fdef),
      objects, context,
    });
  }
}

/** The body of `ObjectQL#deleteRestrictedError`; the method's docblock there is its contract. */
export async function deleteRestrictedError(
  this: Pick<DeleteCascadeHost, 'validationMessageContext' | 'dependentCountIsDisclosable' | 'objectDisplayLabel'>,
  args: {
    object: string;
    id: string | number;
    child: ServiceObject;
    childName: string;
    fieldName: string;
    fdef: any;
    dependents: readonly any[];
    probeWhere: Record<string, unknown>;
    probedIds: readonly string[];
    multiValued: boolean;
    objects: ServiceObject[];
    context: ExecutionContext | undefined;
  },
): Promise<Error> {
  const {
    object, id, child, childName, fieldName, fdef, dependents, probeWhere, probedIds, multiValued, objects, context,
  } = args;
  // [#7307] TWO messages, two audiences — because this error has two
  // and they were sharing one string.
  //
  // `message` is what a BUSINESS USER reads: REST ships it verbatim as
  // `body.error` in the flat 409 envelope (`mapDataError`), and Console
  // renders that as-is in a toast. It was composed English-only with the
  // API names concatenated in and a metadata-authoring instruction on
  // the end, so an operator deleting a 部门 in a fully Chinese app got an
  // English sentence naming two tables and a column they have never
  // seen, ending in advice only a developer can act on. It is now
  // rendered through the operation-message catalog in the caller's
  // locale against resolved LABELS — the same fix #3957 made one layer
  // down for field constraints, reached from the operation side.
  //
  // `developerMessage` is what the DEVELOPER reads, and is the previous
  // sentence unchanged, byte for byte: English, API names, and the
  // `deleteBehavior:'cascade'` hint — which is correct and useful, and
  // is not lost, it is addressed. It rides the structured half of the
  // envelope alongside `dependentObject` / `dependentCount`, which
  // already carry API names, so it discloses nothing new; no
  // user-facing surface reads it.
  //
  // The wire code does NOT split: one `DELETE_RESTRICTED` (ADR-0112),
  // two SENTENCES, exactly as the field catalog splits a message key
  // without splitting `FieldErrorCode`.
  const required = fdef.deleteBehavior !== 'restrict' && fdef.required === true;
  const msgCtx = this.validationMessageContext(object, context);
  const parent = objects.find((o) => (o as any)?.name === object);
  // [#12166, ruling constraint 2] Whether this refusal may carry the
  // row COUNT — see `dependentCountIsDisclosable` for why the elevation
  // above is what makes the question exist, and why the answer is "only
  // if the caller's own identity would have produced the same rows".
  // The OBJECT is named either way: that half is what the ruling
  // requires the caller to learn.
  const discloseCount = await this.dependentCountIsDisclosable(
    childName, probeWhere, probedIds, fieldName, multiValued, id, context,
  );
  const err: any = new Error(
    renderOperationMessage(
      {
        messageKey: discloseCount
          ? (required ? 'delete_restricted_required' : 'delete_restricted')
          : (required ? 'delete_restricted_required_opaque' : 'delete_restricted_opaque'),
        params: {
          object: this.objectDisplayLabel(object, (parent as any)?.label, msgCtx),
          dependentObject: this.objectDisplayLabel(childName, (child as any)?.label, msgCtx),
          field: resolveFieldLabel(fieldName, fdef, { ...msgCtx, objectName: childName }),
          ...(discloseCount ? { count: dependents.length } : {}),
        },
      },
      { locale: msgCtx.locale, translate: msgCtx.translate },
    ),
  );
  // The DEVELOPER half is subject to the same rule, and the reason is
  // measured rather than assumed: for `DELETE_RESTRICTED` (unlike the
  // #7414 permission denial) this sentence RIDES THE ENVELOPE — REST's
  // `mapDataError` ships it — so a count withheld from `message` and
  // left here would not be withheld at all.
  err.developerMessage =
    `Cannot delete ${object} (${id}): ` +
    `${discloseCount ? `${dependents.length} dependent ${childName} record(s) reference it` : `dependent ${childName} record(s) reference it`} via ${fieldName}` +
    `${required ? ` (${fieldName} is required, so it cannot be cleared)` : ''}. ` +
    `Delete or reassign them first, or set deleteBehavior:'cascade' on ${childName}.${fieldName}.`;
  err.code = 'DELETE_RESTRICTED';
  err.status = 409;
  err.httpStatus = 409;
  err.object = object;
  // Constraint 2's REQUIRED half — the referenced object is named
  // unconditionally, because "which table is blocking me" is the one
  // thing the reporting deployment's admins could not self-diagnose.
  err.dependentObject = childName;
  // …and its withheld half. Absent rather than zeroed: `0` would be a
  // false statement about the rows (there is at least one, or this
  // branch would not have been reached), and REST's envelope builder
  // already omits the key for a non-number, so an absent count reaches
  // the client as an absent key rather than as a lie.
  if (discloseCount) err.dependentCount = dependents.length;
  return err;
}
