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
 * ## [#28001] The one relation scan, shared
 *
 * Added after the move: `cascadeRelationsInto`, the collection walk's scan of
 * which relations cascade into an object, lifted out of
 * `collectCascadeDeleteSet` unedited so `collectCascadeDeleteObjects` (the
 * object-level closure `ObjectQL.getCascadeDeleteObjects` serves to the
 * metadata read) reads relations through it too, never through a copy.
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
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
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

/**
 * [#9362] The dependents probe's `where`, spelled for the KIND of reference
 * field it is aimed at.
 *
 * A single-valued `lookup` / `master_detail` stores a scalar foreign key, and
 * bare equality is the right question about it. A MULTI-VALUED reference
 * field stores an ARRAY, and every SQL backend in this repo puts that array
 * in a JSON TEXT column. [#18408] Which of the two a field is, is
 * {@link declaredMultiValued} — the one predicate the storage side asks
 * (#17469) — ⛔ never a raw `field.multiple`: `master_detail` and `tree` are
 * outside `MULTI_CAPABLE_TYPES`, so the flag on one of those buys a JSON
 * column from nobody, and aiming `$contains` at the scalar column the driver
 * really built is the mirror image of the defect below.
 *
 * Aiming bare equality at a multi-valued column compares
 * the whole serialization (`["a","b"]`) against one id, which can never hold;
 * `driver-sql` refuses the spelling outright (`INVALID_FILTER` / 400, #7398),
 * and that refusal is correct and stays. Until this method existed the probe
 * built bare equality for both kinds, so every object pointed at by any
 * registered `multiple: true` lookup had its delete refused with a 400 — on
 * the stock showcase, `showcase_account`, with an EMPTY dependent table:
 * the fault is schema-driven, not data-driven, because the probe runs per
 * DECLARED relation.
 *
 * The multi-value spelling is `$contains`, which is what the refusal itself
 * prescribes and the one membership spelling every driver here answers. On a
 * column the driver holds declared multi-valued it asks MEMBERSHIP, as
 * `FILTER_OPERATORS`' `$contains` docblock (`@objectstack/spec`) declares for
 * a JSON-stored column: `driver-sql` (and `driver-sqlite-wasm` and the local
 * `driver-turso`, which extend it) compiles a per-dialect membership
 * construct, `driver-memory` a mingo `$elemMatch`, and `driver-mongodb` the
 * same `$elemMatch`. No public filter surface is widened: `$contains` is
 * already declared, and this is the only construction site that changes.
 *
 * Membership answers EXACTLY on a well-formed slot, but a backend that does
 * not hold the declaration (a table it was never told about) answers the
 * SUBSTRING reading instead, which is a SUPERSET: with ids `acc_1` and
 * `acc_10`, a row holding `acc_10` also matches a probe for `acc_1`. That is
 * why the caller still narrows the rows exactly through
 * {@link ObjectQL.storedReferenceIncludes} — over-matching here would make
 * `cascade` DELETE and `set_null` clear rows that never referenced this
 * record, which is worse than the 400 being fixed. The pushdown's only job is
 * to keep the probe from reading the whole table.
 *
 * ⚠️ Membership is array-only on every backend that answers it, so a slot
 * holding an off-shape bare scalar (the write door never stores one, it wraps
 * a scalar; out-of-band data can) is not matched by the pushdown, and the
 * scalar arm of {@link ObjectQL.storedReferenceIncludes} never sees that row.
 *
 * The `$or` limb covers the other direction — a FALSE NEGATIVE, which on an
 * integrity guard is the fail-OPEN that #8895 ruled out. An id needing JSON
 * escaping (a quote, a backslash) appears in the serialized text in its
 * ESCAPED form, so a backend answering the substring reading over that text
 * would miss the row for the raw id; a membership test, and a document or
 * in-memory backend, compares the element itself and needs the RAW form. Both
 * are asked whenever they differ, and the exact narrowing discards whatever
 * the extra limb over-matched. Identical for an ordinary id, which is every
 * id this engine generates.
 */
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

/**
 * [#12166, ruling constraint 3] File the reference-check elevation, BOTH
 * halves: `triggeredBy` = the operator who asked for the delete,
 * `executedAs: 'system'` = the identity the check actually ran under.
 *
 * ## Why a record exists at all
 *
 * The elevation is the whole of what this card changed, and an elevation
 * nobody can see afterwards is the thing a security reviewer has no way to
 * audit. The ruling names the Salesforce/Dataverse ledger shape for exactly
 * this reason: a platform-executed integrity action is attributable to the
 * human who triggered it, not laundered into "system did something".
 *
 * ## Why the LOGGER and not a `sys_audit_log` row
 *
 * Stated plainly, because a narrow audit edge has to be visible to be honest
 * (`read-audit.ts` takes the same posture about its own narrowing):
 *
 * The elevated operation is a READ, and `plugin-audit`'s read writer declares
 * — and pins — that a system-elevated read produces NO row, deliberately:
 * those are the platform reading for its own bookkeeping, and recording them
 * would bury the human views that ledger exists to make findable. Minting a
 * row here would either contradict that declared boundary or require the
 * engine to reach into a plugin it does not depend on. The engine's logger is
 * the channel it owns, and it is where the reporting deployment read the
 * defect in the first place — the issue's evidence is a server log line.
 *
 * So: this is a LOG record, at `info`, and the honest limit of it is that a
 * deployment which does not retain engine logs retains no trace. A durable
 * `sys_audit_log` row for the elevation is a follow-up that belongs to
 * plugin-audit, which owns that row shape.
 *
 * `debug` was not an option: a record that is off by default in production is
 * not an audit record.
 *
 * ⛔ The record names the referenced OBJECT and the relation FIELD — declared
 * metadata — and never a row id, a field value, or a count. Constraint 2
 * governs what the CALLER is told; this is the server-side ledger and could
 * defensibly say more, but saying more here is how a count reaches a support
 * transcript, and the two surfaces are kept on one rule so neither has to be
 * re-audited alone.
 */
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

/**
 * [#28001] The relations a delete of a record of `target` cascades through:
 * every field of every object in `objects` whose resolved behaviour, read by
 * {@link DeleteCascadeHost.cascadeRelationBehavior}, is `cascade`. In
 * `objects` order, then field order.
 *
 * The ONE answer to "which relations cascade into this object". The delete's
 * collection walk ({@link collectCascadeDeleteSet}) asks it for each object
 * it reaches, and the object-level closure the metadata read serves
 * ({@link collectCascadeDeleteObjects}) asks it too, so the list a delete
 * confirmation names and the rows the delete removes cannot be chosen by two
 * rules.
 */
export function cascadeRelationsInto(
  this: Pick<DeleteCascadeHost, 'cascadeRelationBehavior'>,
  target: string,
  objects: ReadonlyArray<ServiceObject>,
): Array<{ childName: string; fieldName: string; fdef: any }> {
  const relations: Array<{ childName: string; fieldName: string; fdef: any }> = [];
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
  return relations;
}

/**
 * [#28001] The body of `ObjectQL#getCascadeDeleteObjects`; the method's
 * docblock there is its contract.
 *
 * The object-level closure of {@link collectCascadeDeleteSet}: breadth-first
 * from `object` through {@link cascadeRelationsInto}, reading no row. Each
 * object is named once, at the first depth that reaches it, and expanded
 * once, so a cycle (a self-cascading tree, two objects cascading into each
 * other) terminates. `object` itself is named only when a cascading relation
 * leads back to it.
 */
export function collectCascadeDeleteObjects(
  this: Pick<DeleteCascadeHost, 'cascadeRelationBehavior'>,
  object: string,
  objects: ReadonlyArray<ServiceObject>,
): string[] {
  const named: string[] = [];
  const listed = new Set<string>();
  const expanded = new Set<string>([object]);
  let frontier = [object];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const target of frontier) {
      for (const { childName } of cascadeRelationsInto.call(this, target, objects)) {
        if (!listed.has(childName)) {
          listed.add(childName);
          named.push(childName);
        }
        if (!expanded.has(childName)) {
          expanded.add(childName);
          next.push(childName);
        }
      }
    }
    frontier = next;
  }
  return named;
}

/**
 * [#22305] Phase 1 of {@link cascadeDeleteRelations}: every record a by-id
 * delete of `object`/`id` removes, the root included, collected READ-ONLY.
 *
 * Breadth-first across every relation whose resolved behaviour is
 * `cascade`, read through the walk's own two readings — which relations
 * point at an object ({@link cascadeRelationBehavior}) and which rows
 * reference a record ({@link probeReferencingRows}: system identity, the
 * same filter, the same missing-table and multi-value handling) — so the
 * two phases cannot disagree about which rows a cascade reaches. A record
 * already in the set is not expanded again, so a cycle in the data (a
 * self-reference, two objects cascading into each other) terminates.
 *
 * The cost is one extra probe per CASCADING relation per member, since the
 * walk probes those relations again as it deletes. `restrict` and
 * `set_null` relations are not read here. Every probe here is an elevated
 * read, so it files its #12166 record before it runs, through the
 * once-per-record ledger the walk shares ({@link fileReferenceCheckElevation}).
 *
 * [#24964] …except for {@link inspectCascadeDelete}, which passes
 * `fileElevations: false`: that record says "read as system FOR THE DELETE
 * of" the record, and an inspection deletes nothing, so filing it there would
 * put a delete that never happened in the log. The reads are the same.
 *
 * [#27004] From a root SET, level by level: the records found at one depth
 * are probed together, per object and per relation, through
 * {@link probeReferencingRowsOfSet}. The set and its edges are the ones the
 * record-by-record walk collected.
 */
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
      relations = cascadeRelationsInto.call(this, target, objects);
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

/**
 * [#26718] Before the cascade writes anything: refuse the delete when an
 * AUTHORED `restrict` is held by a row the cascade would remove only because
 * the record that restrict protects is removed.
 *
 * The deleting walk judges a `restrict` against rows OUTSIDE the cascade set
 * alone (#22305), and a row inside it was exempt whatever put it there. That
 * exemption is right for a row the cascade reaches through ANOTHER record (a
 * contract and the contact it restricts, both details of the account being
 * deleted: the account's delete removes both, and neither is left dangling).
 * It was wrong for a row reached THROUGH the very record it protects: a child
 * holding a `master_detail` and a `restrict` lookup to the same parent is in
 * that parent's set by its own master_detail, so the restrict was never
 * asked and the cascade deleted the child — the record the author declared
 * undeletable. A grandchild under that parent holding the restrict is the
 * same case one level down.
 *
 * So for every member, every relation whose RESOLVED behaviour is `restrict`
 * ({@link cascadeRelationBehavior}, an authored `restrict` on a lookup,
 * tree or master_detail) is probed here when its object has a member in the
 * reach of that member ({@link cascadeReachOf}); a referencing row in the
 * reach refuses with the walk's own `DELETE_RESTRICTED`
 * ({@link deleteRestrictedError}). Every restrict is judged before the
 * first cascade, so the outcome no longer depends on the order the fields or
 * objects are declared in, and nothing has been written when it refuses.
 *
 * ⛔ The required-lookup escalation (`set_null` on a required field read as
 * `restrict`) is not judged here: it restricts because a required reference
 * cannot be CLEARED, and a row the cascade deletes is never cleared. It keeps
 * the #22305 rule. Neither does this replace the walk's judgement of rows
 * outside the set, which is unchanged.
 */
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

/**
 * The `DELETE_RESTRICTED` refusal of deleting `object`/`id` because
 * `dependents` of `childName` reference it via `fieldName`. One builder for
 * the deleting walk ({@link walkReferencingRelations}) and the judgement
 * before it ({@link refuseRestrictsInsideOwnCascade}), so the two answer one
 * envelope.
 */
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
