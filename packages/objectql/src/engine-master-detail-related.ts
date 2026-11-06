// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 14] The master-detail and related-record bodies of `ObjectQL`,
 * moved out of `engine.ts`: `settleMasterDetailLanding` (the UPDATE payload a
 * master-detail FK repoint actually lands with), `resolvePreviewParents` (the
 * write preview's master-detail headers), `resolvePredicateRelated` (the
 * related rows a rule predicate reads) and `resolveOneHopRelated` (the one-hop
 * reference reads a traversing rule makes, under the caller's bounds).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract.
 *
 * What stays in `engine.ts`: `referenceExists`, `resolveMasterDetailParent`
 * and `resolveMasterDetailParents` (each reads the private static
 * `referenceCheckContext` and holds a query-options erasure site), the bodies
 * earlier cuts already moved, and the two short ones that do not pay for a
 * host (`materializeParentHeader`, `masterDeclaredFields`).
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied per method as
 * `engine-driver-options.ts` applies it. The class keeps all four methods with
 * name, modifiers, signature, docblock and position. Three bodies become one
 * literal of exactly the {@link MasterDetailRelatedHost} members that method
 * reads, plus a `.call`. The fields a body reads (`logger`, `_registry`,
 * `formulaHopReads`) go as GETTERS, so each read happens when the body makes
 * it, as it did; no moved body assigns a field. The methods they call go as
 * late-bound closures over the instance, so a double or spy set on the engine
 * is still the one a call reaches. `settleMasterDetailLanding` reads no member
 * of the class, so its method calls it directly, with its type parameter.
 *
 * ## Module helpers
 *
 * `withoutKey` and `staticReadonlyStripTakes` are read by
 * `settleMasterDetailLanding` alone, so they moved with it. Four helpers are
 * read by these bodies AND by bodies that stay: `masterIdOf` (the master-detail
 * reads and `update`), `servedAsStored` (`validate`), `undeclaredRelatedFields`
 * (`resolveFormulaRelated`) and `staticReadonlyStoredView` (`update`). One home
 * each: they stay declared in `engine.ts`, exported in place, and are imported
 * here, never copied. Nothing re-exports them from the package entry, so the
 * published surface does not move.
 *
 * That import is a run-time module cycle (`engine.ts` imports this module,
 * this module imports `engine.ts`). Nothing here runs at module evaluation,
 * only declarations, and `engine.ts` imports this module after every module
 * this one imports, so the engine's evaluation order is what it was. The
 * published build bundles both files into one, where the cycle does not
 * exist.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 *
 * One body was written here rather than moved: `priorMasterIdsCallerReads`,
 * the stored master an update's pre-check reads, as the caller's read door
 * serves the FK. Its private method on the class is a delegation of the same
 * shape.
 */

import { referenceTargetOf } from '@objectstack/spec/data';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { resolveTenantFieldName, carriesOrganization } from './tenancy/system-write-organization.js';
import { collectPredicateRelationships, referentialClearBinding } from './validation/rule-validator.js';
// [#19911] The settlement's question "does judging the FK's own lock need the
// header it names?" — asked of the same root reader the strips use.
import { readonlyWhenFkJudgementReadsParent } from './validation/rule-validator.js';
import type { RelatedFieldBinding, RelatedRecordBinding } from './validation/rule-validator.js';
import { resolveMasterDetailRelation } from './master-detail.js';
import { isFederatedObject } from './federated-object.js';
import { masterIdOf, servedAsStored, staticReadonlyStoredView, undeclaredRelatedFields } from './engine.js';
import { storedReferencesCallerReads } from './engine-referential-integrity.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters, and which one also has a setter.
 */
export interface MasterDetailRelatedHost {
  readonly logger: ObjectQL['logger'];
  readonly _registry: ObjectQL['_registry'];
  readonly formulaHopReads: ObjectQL['formulaHopReads'];
  find: ObjectQL['find'];
  resolveMasterDetailParents: ObjectQL['resolveMasterDetailParents'];
  materializeParentHeader: ObjectQL['materializeParentHeader'];
  buildReferentialFieldClear: ObjectQL['buildReferentialFieldClear'];
  resolveOneHopRelated: ObjectQL['resolveOneHopRelated'];
  resolveEnginePosture: ObjectQL['resolveEnginePosture'];
  masterDetailHeadersCallerReads: ObjectQL['masterDetailHeadersCallerReads'];
}

/**
 * [#19853] `data` without `key`, as a COPY — the payloads this is applied to
 * are shared with hooks and with the strip reports' before/after diffs, so
 * none of them may lose a key in place. The same reference when `key` is
 * absent, which is the "nothing changed" signal every strip here keeps.
 */
function withoutKey<T extends Record<string, unknown>>(data: T, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return data;
  const { [key]: _omitted, ...rest } = data;
  return rest as T;
}

/**
 * [#19853] Will the static `readonly` strip take `key` back out of this
 * UPDATE payload? Asked before the write's `parent` is resolved, because a
 * master-detail FK that strip takes is a repoint that never lands.
 *
 * Answered by the SAME function the strip runs, over the same `supplied`
 * snapshot, the same hook-write record and the same two exemptions — never by
 * re-deriving "is this FK read-only" from its declaration, which is a second
 * opinion that disagrees the moment either exemption applies. `runs` is the
 * strip's own gate (a system caller skips it), handed in as the value the
 * strip's call site reads once and consumes itself, so the two cannot
 * disagree about whether it runs; `preserveAudit` keeps a preservable column.
 * Silent: no logger, because the strip itself owns every word said about the
 * key, and `strictReadonlyWrites` / `addressKey` shape only that wording,
 * never the verdict.
 */
function staticReadonlyStripTakes(
  schema: unknown,
  data: Record<string, unknown>,
  key: string,
  supplied: Readonly<Record<string, unknown>>,
  strip: {
    runs: boolean;
    preserveAudit: boolean;
    hookWrittenKeys: ReadonlySet<string> | undefined;
    /** [#24822] The wall's flag, read once by `update()` — see {@link staticReadonlyStoredView}. */
    wallJudgesOrganization?: boolean;
  },
): boolean {
  if (!strip.runs) return false;
  return !(key in staticReadonlyStoredView(schema, data, supplied, strip));
}

/**
 * [#19853] Settle whether an UPDATE lands the master-detail FK its payload
 * names, BEFORE any `parent`-scoped lock is judged — so `parent` is the
 * header the write STORES, not merely the one it NAMES. Shared by the by-id
 * and bulk paths, which differ only in how a header is resolved and how the
 * FK's own lock is judged (one row, or "locked in ≥1 matched row").
 *
 * #4889's rule — a repoint is judged against the master it lands on — is
 * right only when the repoint LANDS. Two strips can take the FK back out
 * after `parent` was resolved from it, and the row then keeps the header it
 * had while every other parent-scoped lock was judged against one it never
 * reached. Measured on the card's shape: `update(l1, { amount: 999, invoice:
 * 'inv_b' })` with `invoice` statically `readonly` and `l1` under a PAID
 * `inv_a` committed `{ amount: 999, invoice: 'inv_a' }` — the frozen line
 * rewritten, still under the paid invoice. The strips, in the order they run
 * after this point:
 *
 *  ① the FK's OWN `readonlyWhen` lock. Judged here first, against the
 *    header the FK names — #4889's rule for the FK itself, unmoved.
 *    [#19911] Judged WITH the other caller-supplied locks, not alone, and
 *    settled with them (`settleReadonlyWhenDrops`), so a value one of them
 *    drops can no longer unlock it — but only the FK is TAKEN here (`only`).
 *    That moves the FK's verdict in BOTH directions: a repoint its lock
 *    used to let through can now stay home, and a repoint it used to hold
 *    can now LAND, when the value its `record` lock reads is itself locked
 *    under the header the FK names — that value is dropped, the FK's lock
 *    reads the stored one, and the rest are then judged under the header
 *    the row lands on. When that verdict keeps the FK off the landing it is final:
 *    the returned `supplied` no longer holds the FK, so the strip that
 *    judges the other fields never re-asks it against the header the row
 *    keeps, where it could flip and land the FK after the rest were judged
 *    against the header it left. When the FK lands, that strip re-judges it
 *    on the same landing and reaches the same verdict.
 *  ② the static `readonly` strip (`staticReadonlyStripTakes`), which runs
 *    after the conditional one and takes a non-system caller's forged FK.
 *
 * Nothing else on either path moves the FK after this point, and what moves
 * it before this point (a `beforeUpdate` hook, the post-hook payload) is
 * already in `data`. Field-level security refuses a forbidden FK outright
 * rather than stripping it, so it never leaves a payload that names one
 * header and stores another.
 *
 * Returns:
 *  - `subject` — the payload the `readonlyWhen` strip judges next: `data`,
 *    or `data` without the FK when ①'s verdict locked it;
 *  - `supplied` — the entry snapshot that strip judges against: without the
 *    FK when the FK does not land (its verdict is in), whole when it does;
 *  - `view` — the payload the header id is read from: `data` when the FK
 *    lands, else `data` without it, so `masterIdOf` falls through to the
 *    prior row's FK;
 *  - `header` — what `resolve(view)` answers. ① needs the NAMED header only
 *    when judging the FK's lock reads `parent` — its own predicate, or
 *    [#19911] a `record`-reading one whose view another payload key's
 *    `parent`-scoped lock shapes (`readonlyWhenFkJudgementReadsParent`);
 *    when the FK then lands that is the same header and is reused, so the
 *    write still reads one header — two only when ① read the named header
 *    and the FK does not land.
 */
export async function settleMasterDetailLanding<H>(
  args: {
    schema: unknown;
    data: Record<string, unknown>;
    supplied: Readonly<Record<string, unknown>>;
    staticStrip: { runs: boolean; preserveAudit: boolean; hookWrittenKeys: ReadonlySet<string> | undefined };
    resolve: (view: Record<string, unknown>) => Promise<H>;
    judgeFkLock: (named: H | undefined, fk: string) => Record<string, unknown>;
  },
): Promise<{
    subject: Record<string, unknown>;
    supplied: Readonly<Record<string, unknown>>;
    view: Record<string, unknown>;
    header: H;
  }> {
  const { schema, data, supplied, staticStrip, resolve, judgeFkLock } = args;
  const fk = resolveMasterDetailRelation(schema as any)?.fk;
  if (fk === undefined || !(fk in data)) {
    return { subject: data, supplied, view: data, header: await resolve(data) };
  }
  // ① Whether the FK is still the caller's is the strip's own question
  // (`isCallerSuppliedValue`, own-property): a hook-written FK is not judged.
  const namedNeeded = readonlyWhenFkJudgementReadsParent(schema as any, data, fk);
  const named = namedNeeded ? await resolve(data) : undefined;
  const subject = judgeFkLock(named, fk);
  const rest = withoutKey(supplied as Record<string, unknown>, fk);
  // ②
  const lands = fk in subject && !staticReadonlyStripTakes(schema, subject, fk, supplied, staticStrip);
  if (lands) {
    // [#19911] A landing FK stays in `supplied`: the strip that judges the
    // rest re-judges it on the SAME landing — the header ① read, or one its
    // verdict never reads — so it reaches ①'s verdict again, now over the
    // same drops as everything else, and says it once.
    return { subject, supplied, view: data, header: namedNeeded ? (named as H) : await resolve(data) };
  }
  const view = withoutKey(data, fk);
  return { subject, supplied: rest, view, header: await resolve(view) };
}

/**
 * [#22474] The master-detail headers a `validate()` preview binds, per row:
 * `parents[i]` is the header row `i` is judged under (`parent`), and
 * `previousParents[i]` the header its stored row hangs off when the row
 * REPOINTS it (`previousParent`, for the ADR-0113 pre-check), else
 * `undefined`, which the evaluator reads as "the same header", as the
 * write's own `undefined` is read.
 *
 * The header ids are read the way the write reads them ({@link masterIdOf}):
 * `views[i]` is the judged view, the row on an insert and the stored row
 * merged with the patch on an update, so the patch's FK wins over the stored
 * one; `storedRows[i]` names the header a repoint leaves.
 *
 * ## Read under the caller's access, not elevated
 *
 * A header read elevated here would answer a predicate over a row the caller
 * may not read. Two reads, each answering one question, as the preview's
 * stored-row read does — and, since #22519, as the write's own header read
 * does ({@link resolveMasterDetailParent}):
 *
 *  1. ⛔ MAY THIS CALLER SEE THE HEADER — the READ DOOR, under the caller's
 *     own context, one `find` for the whole batch. A header it does not
 *     return binds as a missing header binds: `null`, so a predicate that
 *     reads `parent` refuses as unevaluable, whatever the header holds. A
 *     failed read binds every header as missing, as the write's own failed
 *     header read does.
 *  2. WHAT THE WRITE WOULD JUDGE — the write's own header read
 *     ({@link resolveMasterDetailParents}, whose own read door returns the
 *     same headers), for the headers read 1 returned only.
 *
 * ⛔ The column rule is the preview's own; the write judges a header the
 * caller can read on its stored values. A header column is kept only where
 * the read door served this caller
 * that very value ({@link servedAsStored}); every other column, hidden or
 * served transformed (a partial mask keeps the key and replaces the value),
 * is judged as empty: the header is materialised over the master's declared
 * fields after the columns are kept, so such a column reads `null`. So the
 * verdict never depends on a header value the caller could not have read in
 * full.
 */
export async function resolvePreviewParents(
  this: Pick<MasterDetailRelatedHost, 'find' | 'logger' | 'resolveMasterDetailParents' | 'materializeParentHeader'>,
  schema: unknown,
  views: ReadonlyArray<Record<string, unknown>>,
  storedRows: ReadonlyArray<Record<string, unknown> | undefined>,
  context: ExecutionContext | undefined,
): Promise<{
    parents: Array<Record<string, unknown> | null>;
    previousParents: Array<Record<string, unknown> | null | undefined>;
  }> {
  const rel = resolveMasterDetailRelation(schema as any);
  const landingIds = views.map((view) => (rel ? masterIdOf(rel.fk, null, view) : undefined));
  const priorIds = storedRows.map((stored) => (rel && stored ? masterIdOf(rel.fk, null, stored) : undefined));
  // The write resolves a second header only for a repoint (`repointsMaster`).
  const repoints = priorIds.map((prior, i) => prior != null && landingIds[i] !== prior);
  const ids = new Set<string>();
  landingIds.forEach((id) => { if (id != null) ids.add(String(id)); });
  priorIds.forEach((id, i) => { if (repoints[i]) ids.add(String(id)); });

  const headers = new Map<string, Record<string, unknown>>();
  // [#24358] ⛔ A stored-metadata-body header is never read here either, as
  // the write's own header read never reads one: every header binds unbound.
  if (rel && ids.size > 0 && !isStoredMetadataBodyObject(rel.master)) {
    // 1. The read door, under the caller's own context.
    const served = new Map<string, Record<string, unknown>>();
    try {
      const rows = await this.find(rel.master, {
        where: { id: { $in: [...ids] } },
        context,
      } as EngineQueryOptions) as Array<Record<string, unknown>>;
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.id != null && ids.has(String(row.id))) served.set(String(row.id), row);
      }
    } catch (err) {
      this.logger?.warn?.('validate preview: the caller\'s read of the master-detail header failed — parent stays unbound', {
        object: rel.master, error: err,
      });
    }
    // 2. The write's own header read, for the headers the caller can read.
    if (served.size > 0) {
      const asWritten = await this.resolveMasterDetailParents(
        schema, null, [...served.keys()].map((id) => ({ [rel.fk]: id })), context,
      );
      for (const [id, servedRow] of served) {
        const header = asWritten({ [rel.fk]: id });
        if (!header) continue;
        const kept: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(header)) {
          if (Object.prototype.hasOwnProperty.call(servedRow, key) && servedAsStored(servedRow[key], value)) {
            kept[key] = value;
          }
        }
        headers.set(id, this.materializeParentHeader(rel.master, kept));
      }
    }
  }
  const headerOf = (id: string | number | undefined) => (id == null ? null : (headers.get(String(id)) ?? null));
  return {
    parents: landingIds.map(headerOf),
    previousParents: priorIds.map((id, i) => (repoints[i] ? headerOf(id) : undefined)),
  };
}

/**
 * The master each of an update's stored rows hangs off, as THIS caller's own
 * read door serves the master-detail FK: the header the ADR-0113 pre-check of
 * a parent-scoped `requiredWhen` reads as `previousParent` when the write
 * names the FK.
 *
 * `{ id }` for a row whose FK the read door serves this caller exactly as
 * stored ({@link storedReferencesCallerReads}, the update's one projection of
 * stored rows onto the caller's read): `id` is the stored master, or
 * `undefined` for a row that hangs off none. `null` for a row whose FK it does
 * not — hidden, or served transformed, or a row the door does not return: the
 * prior master is UNKNOWN to this caller, and the write binds one fixed header
 * for it, the unresolved one, so neither whether the pre-check reads a second
 * header nor which one it reads depends on what the column holds. A SYSTEM
 * caller is answered from the rows as stored, as before.
 *
 * A stored row that carries no FK key at all is read as holding no master, as
 * `masterIdOf` reads it: the key is spelled out as empty before the
 * projection, so a system caller's answer for it is `{ id: undefined }`.
 */
export async function priorMasterIdsCallerReads(
  this: Pick<MasterDetailRelatedHost, 'find' | 'logger'>,
  schema: unknown,
  rows: ReadonlyArray<Record<string, unknown> | null | undefined>,
  context: ExecutionContext | undefined,
): Promise<Array<{ readonly id: string | number | undefined } | null>> {
  const rel = resolveMasterDetailRelation(schema as any);
  if (!rel) return rows.map(() => null);
  const stored = rows.map((row) => {
    const own = row && typeof row === 'object' ? row : {};
    return Object.prototype.hasOwnProperty.call(own, rel.fk) ? own : { ...own, [rel.fk]: undefined };
  });
  const served = await storedReferencesCallerReads.call(
    this, (schema as { name?: unknown } | null | undefined)?.name, stored, [rel.fk], context,
  );
  return served.map((view) => (
    view && Object.prototype.hasOwnProperty.call(view, rel.fk) ? { id: masterIdOf(rel.fk, null, view) } : null
  ));
}

/**
 * [#18682] Resolve the related rows this object's PREDICATE rules read one
 * hop through a reference field, for a whole batch of rows at once.
 *
 * Returns a per-row lookup the validation seams hand to
 * `evaluateValidationRules` as `related`. When no rule traverses anything the
 * schema says so up front and this costs NOTHING — no query, no closure work
 * — which is what bounds the N+1: one hop, only the fields a rule names, one
 * batched read per reference field per write (two for a caller that is not
 * SYSTEM where a read door bounds the rows, below), and only when a rule asks.
 *
 * ## Which related rows a caller's rule may read, and how their values are read
 *
 * The VALUES are read as SYSTEM: a validation rule's output is a pass/fail the
 * SYSTEM enforces, not data handed to the caller — categorically unlike an
 * access-control rule, which is why RLS predicates are excluded from this
 * capability altogether. What bounds that elevation is the PROJECTION: only
 * the columns the predicate names, intersected with the related object's
 * declared fields. ⛔ Never the whole row.
 *
 * ⛔ No caller writes a row naming a related row it cannot read (#29029,
 * ruling records 6573561091 and 6663849489). A non-system write may name, in
 * a `master_detail`, `lookup` or `user` field, only a row the caller's own
 * read door returns, and that reference check runs BEFORE the rules
 * (`assertReferencesResolve`), so a rule never answers for a reference the
 * caller supplied and cannot read: the write answers `reference_not_found`.
 * The elevated value read therefore serves a related row the caller can read,
 * a value the row already stores (#29062), a `tree` parent, and a system
 * caller.
 *
 * Which ROWS a caller that is not SYSTEM may have read is a different
 * question, answered before any value is read:
 *
 *  - ⛔ Through a `master_detail` FK the related row is the detail's HEADER,
 *    and ruling A on #22519 holds here as on the write's own header read
 *    ({@link resolveMasterDetailParent}): an unreadable header is a header
 *    that exists nowhere (#22892). The caller's read door first, under the
 *    caller's own context ({@link masterDetailHeadersCallerReads}); a header
 *    it does not return is `unresolved`, exactly as a header that exists
 *    nowhere is, so the rule's answer never depends on what an unreadable
 *    header holds. The elevated, tenant-kept read follows for the headers the
 *    door returned only, and a header the caller CAN read is judged on its
 *    stored values, as the write judges it.
 *  - On a related object no organization wall scopes, the own read of the
 *    caller bounds the rows, and any other id is `unreadable`, stored or not.
 *  - A plain `lookup` to a walled object keeps the tenant-kept elevated read
 *    alone HERE: a value the caller supplies and cannot read was already
 *    refused by the reference check before this read is judged (above).
 *
 * A SYSTEM caller (seed replay, boot) asks no read door: the elevated read
 * alone, as before.
 *
 * ## An unresolved row is left UNAVAILABLE, and it says which kind
 *
 * No reference stored, the related record not found, the related object
 * declares no such column, or the row could not be read: each is its own reason, and
 * {@link checkPredicate} turns it into a refusal naming the related object and
 * column. The write is REJECTED rather than judged on a rule that produced no
 * verdict. ⛔ Never silently true, and never silently false.
 *
 * The projection always names `id` alongside the fields the rules read:
 * the map below is keyed on `row.id`, and a projection that omitted it would
 * build an EMPTY map and leave every row unbound (#7537's shape, one seam
 * over).
 */
export async function resolvePredicateRelated(
  this: Pick<MasterDetailRelatedHost, 'buildReferentialFieldClear' | '_registry' | 'resolveOneHopRelated'>,
  schema: any,
  rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
  context: unknown,
): Promise<((row: Record<string, unknown> | undefined | null) => RelatedRecordBinding | undefined)> {
  const unbound = () => undefined;
  // ⛔ A referential FK clear resolves NOTHING. `cascadeDeleteRelations`
  // stamps `__referentialFieldClear` on its cleanup UPDATE, and plugin-security
  // exempts an update carrying it from its object-level CRUD check — so the
  // cleanup reaches this seam for a deleter holding no grant on the
  // referencing object, and a system read here would let a traversing rule's
  // verdict decide their delete: one bit of a related record they cannot
  // read, per delete. Left unbound, such a rule meets the bare id as it did
  // before this seam existed (`resolveTraversalScope` leaves an unbound record
  // to CEL), where reading through it faults and refuses the cleanup. Pinned
  // end to end in plugin-security's
  // `delete-reference-cleanup-system-identity.test.ts`.
  if (this.buildReferentialFieldClear(context as ExecutionContext | undefined)) {
    // [#20006] Still NOTHING is resolved: the binding handed back is empty.
    // It carries WHY — the delete and the reference it clears, which
    // `cascadeDeleteRelations` stamps beside the marker — so a traversing rule
    // that faults here refuses with a text naming them, instead of one
    // prescribing a column on the object carrying the rule. Only for the
    // record the cleanup was issued for: a write a hook issues during the
    // cleanup inherits the envelope, and that write is not the clear.
    const cause = (context as { __referentialFieldClearCause?: Record<string, unknown> } | undefined)
      ?.__referentialFieldClearCause;
    if (!cause || schema?.name !== cause.referencingObject) return unbound;
    const binding = referentialClearBinding({
      object: String(cause.object),
      id: String(cause.id),
      referencingObject: String(cause.referencingObject),
      field: String(cause.field),
    });
    return (row) => (row?.id != null && String(row.id) === String(cause.referencingId) ? binding : undefined);
  }
  const wanted = collectPredicateRelationships(schema);
  if (wanted.size === 0) return unbound;
  // [#24468] The read set per reference is the UNION of every rule's
  // columns, and the loader answers a whole reference `undeclared-field` when
  // any column of it is undeclared — so one rule's misspelt column left every
  // sibling rule through the same reference without a verdict, each refusing
  // the write with the other rule's field. The undeclared columns are taken
  // out of the shared read here and judged per rule (`resolveTraversalScope`
  // reads `undeclaredFields` against the rule's own columns); the loader
  // reads the declared rest, under the same authority and bound as before.
  // ⛔ Nothing undeclared enters the system-authority read either way.
  const fields = (schema?.fields ?? {}) as Record<string, unknown>;
  const undeclared = new Map<string, { object: string; fields: string[] }>();
  for (const [fk, named] of wanted) {
    const target = referenceTargetOf(fields[fk]);
    // The loader's own verdicts stand for these: no target, or a hop into
    // the stored-metadata-body family, which is never read.
    if (!target || isStoredMetadataBodyObject(target)) continue;
    const declared = (this._registry.getObject(target) as { fields?: Record<string, unknown> } | undefined)?.fields;
    const missing = undeclaredRelatedFields(declared, named);
    if (missing.length === 0) continue;
    undeclared.set(fk, { object: target, fields: missing });
    for (const name of missing) named.delete(name);
    if (named.size === 0) wanted.delete(fk);
  }
  const lookup = wanted.size > 0
    ? await this.resolveOneHopRelated(schema, wanted, rows, context, 'predicate')
    : unbound;
  if (undeclared.size === 0) return lookup;
  return (row) => {
    if (!row) return undefined;
    const binding: Record<string, RelatedFieldBinding> = { ...(lookup(row) ?? {}) };
    for (const [fk, { object, fields: missing }] of undeclared) {
      // A reference no rule reads a declared column through has no row to
      // serve; the binding says why, and every rule through it names its own.
      binding[fk] = { ...(binding[fk] ?? { object, unavailable: 'undeclared-field' }), undeclaredFields: missing };
    }
    return binding;
  };
}

/**
 * [#24197] Resolve the related rows a page of `rows` reads ONE hop through a
 * reference field — the one loader behind both seams that serve a hop:
 * validation predicates ({@link resolvePredicateRelated}, `authority:
 * 'predicate'`) and formula fields ({@link resolveFormulaRelated},
 * `authority: 'caller'`).
 *
 * Everything but the AUTHORITY of the value read is shared, so the two seams
 * cannot disagree about it: which reference fields and related fields to
 * read ({@link collectReferenceTraversals}), the declared-field intersection
 * and its `undeclared-field` report, the id set (one batched read per
 * reference field per call, never one per row; a multi-value or already
 * expanded slot names no single row), the `null` materialisation of a
 * declared column the driver omitted, and the per-row
 * {@link RelatedFieldBinding} with its reason when there is no row.
 *
 * ## The authority, and why the two differ
 *
 *  - `predicate`: a rule's output is a pass/fail the SYSTEM enforces, so the
 *    values are read as SYSTEM behind the caller's read doors — see
 *    {@link resolvePredicateRelated} for the whole argument.
 *  - `caller`: a formula's output is DATA handed to the reader. Reading the
 *    hop as SYSTEM would hand any reader of the junction row a related
 *    column it could not read directly, so the hop is read under the
 *    caller's OWN context, through every enforcement layer `find` applies
 *    (row-level security, field-level security, the organization wall). A
 *    related row that read does not return is `unresolved` — whether it
 *    exists nowhere or the reader may not see it, the formula answers the
 *    same, so the answer discloses neither.
 */
export async function resolveOneHopRelated(
  this: Pick<MasterDetailRelatedHost, 'resolveEnginePosture' | '_registry' | 'find' | 'masterDetailHeadersCallerReads' | 'formulaHopReads' | 'logger'>,
  schema: any,
  wanted: ReadonlyMap<string, ReadonlySet<string>>,
  rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
  context: unknown,
  authority: 'predicate' | 'caller',
): Promise<((row: Record<string, unknown> | undefined | null) => RelatedRecordBinding | undefined)> {
  const unbound = () => undefined;
  // ⛔ Every bound below keys on "not SYSTEM", never on `userId`: a public-form
  // submitter or a principal-less caller is bound exactly like a user. Walled
  // posture: such a caller with no `tenantId` cannot be scoped here, so it reads nothing.
  // [#24197] The caller-authority read applies the wall itself (it IS the
  // caller's own `find`), so it computes no bound of its own.
  const caller = context as ExecutionContext | undefined;
  const bound = authority === 'predicate' && !caller?.isSystem;
  const readsNothing = bound && !carriesOrganization(caller?.tenantId)
    && postureEnforcesWall(this.resolveEnginePosture());

  const fields = (schema?.fields ?? {}) as Record<string, unknown>;
  type Resolved = {
    object: string;
    byId: Map<string, Record<string, unknown>>;
    /** Named fields the RELATED object does not declare. */
    undeclared?: string[];
    /** Set when the read itself failed, whatever the id. */
    blocked?: boolean;
    /** The ids the caller's OWN read returned, when that read decides (below). */
    ownRead?: ReadonlySet<string>;
  };
  const resolved = new Map<string, Resolved>();

  for (const [fk, namedFields] of wanted) {
    const target = referenceTargetOf(fields[fk]);
    if (!target) continue;
    // [#24316] ⛔ A hop into the stored-metadata-body family is never read,
    // under either authority. The family's projection runs at its doors and
    // never here, so this `find` would hand the formula (or the rule) the
    // stored body and its content hash unprojected — material the family's
    // own door withholds from the same reader. The binding is `unreadable`,
    // the disclosure-safe shape: a formula reads `null` with its reason, a
    // rule has no verdict and refuses the write, and neither says anything
    // about the row. The lint refuses the same hop at author time.
    if (isStoredMetadataBodyObject(target)) {
      resolved.set(fk, { object: target, byId: new Map(), blocked: true });
      continue;
    }
    const named = [...namedFields];

    // ── The READ SET is the intersection of "what the predicate names" and
    // "what the related object DECLARES", and it is computed here so that it
    // can never be anything else. A predicate naming a column the related
    // object does not declare must not put that name into a system-authority
    // query: the read is elevated. An undeclared name is also a real
    // authoring fault and is reported as one rather than silently dropped.
    const targetSchema = this._registry.getObject(target) as { fields?: Record<string, unknown>; external?: unknown } | undefined;
    const declared = targetSchema?.fields;
    // [#8215] The PRIMARY KEY is declared by the platform, not by the author,
    // so it is absent from every object's field map — the map carries the
    // injected audit/tenant/owner columns but never the PK. It still has to
    // count as declared HERE, because `record.<fk>.id` is the repair this
    // capability's own conflict refusal prescribes: without this the engine
    // refuses the very spelling it just told the author to write, and then
    // hands them a second prescription ("declare `id` on the related object")
    // that is equally impossible. An actively misleading prescription is
    // worse than none (ADR-0078 §6).
    //
    // ⛔ This widens the READ SET by nothing: `id` is already unconditionally
    // in the projection below, because the by-id map is keyed on it.
    const undeclared = undeclaredRelatedFields(declared, named);
    if (undeclared.length > 0) {
      resolved.set(fk, { object: target, byId: new Map(), undeclared });
      continue;
    }

    const ids = new Set<string>();
    for (const row of rows) {
      const value = row?.[fk];
      // A multi-value reference cannot be ONE hop: `record.fk.field` on a list
      // names no single related record, so it is never hydrated.
      if (value == null || Array.isArray(value) || typeof value === 'object') continue;
      ids.add(String(value));
    }
    if (ids.size === 0 || readsNothing) { resolved.set(fk, { object: target, byId: new Map() }); continue; }
    try {
      // ⭐ SYSTEM authority, and ONLY for this seam.
      //
      // A validation rule's output is a pass/fail the SYSTEM enforces, not
      // data handed to the caller — categorically unlike an access-control
      // rule, which is why RLS predicates are excluded from this capability
      // altogether. [#29029] A reference the caller supplies and cannot read
      // never reaches a rule: the write's reference check refuses it first
      // (`reference_not_found`), so no caller writes a row naming a related
      // row it cannot read. What this read still serves without a read door
      // is a row the caller can read, a value the row already stores, and a
      // system caller.
      //
      // What bounds the elevation is the PROJECTION: only the
      // columns this predicate names, intersected with the related object's
      // declared fields above. ⛔ Never the whole row.
      //
      // The accepted cost, recorded so nobody widens it by accident: a caller
      // can INFER a value they cannot see by observing which writes refuse —
      // a column hidden from them on a row they may read, or a column of a
      // row a plain `lookup` the row already stores names on a walled object.
      // The value itself never appears — not in the row handed to CEL beyond
      // the predicate's own use of it, and not in the refusal text, which
      // names the field and the rule and never the value. [#22892] ⛔ Never
      // what a master-detail header the caller cannot read holds: the door
      // below answers first.
      //
      // ⛔ No organization wall scopes a related object with no tenant column
      // (e.g. `sys_user`), `tenancy.enabled: false` or `external`, so for a
      // caller that is not SYSTEM its rows are the ones its OWN read returns,
      // through every enforcement layer; any other id is 'unreadable', stored or not.
      let ownRead: Set<string> | undefined;
      let readSet: ReadonlySet<string> = ids;
      if (bound && (isFederatedObject(targetSchema) || resolveTenantFieldName(targetSchema) === null)) {
        const own = await this.find(target, {
          where: { id: { $in: [...ids] } }, fields: ['id'], context: caller as EngineQueryOptions['context'],
        }) as Array<Record<string, unknown>>;
        ownRead = new Set((Array.isArray(own) ? own : []).flatMap((r) => (r?.id == null ? [] : [String(r.id)])));
        if (ownRead.size === 0) { resolved.set(fk, { object: target, byId: new Map(), ownRead }); continue; }
        readSet = ownRead;
      } else if (bound && (fields[fk] as { type?: unknown } | undefined)?.type === 'master_detail') {
        // [#22892] Through a master-detail FK the related row is the detail's
        // HEADER, and ruling A on #22519 holds here as on the write's own
        // header read: the caller's read door first, under the caller's own
        // context. A header it does not return gets no row below and no
        // `ownRead`, so it is `unresolved`, exactly as a header that exists
        // nowhere is, whatever it holds. A failed door read returned no
        // header, so every header is missing.
        readSet = await this.masterDetailHeadersCallerReads(target, [...ids], caller);
        if (readSet.size === 0) { resolved.set(fk, { object: target, byId: new Map() }); continue; }
      }
      const query: EngineQueryOptions = {
        where: { id: { $in: [...readSet] } },
        fields: [...new Set(['id', ...named])],
        // [#24197] A formula's hop is read as the CALLER (see the docblock).
        context: (authority === 'caller'
          ? context
          : { ...(context as Record<string, unknown> ?? {}), isSystem: true }) as EngineQueryOptions['context'],
      };
      // [#24197] ONE hop: the related object's own formulas are computed on
      // this read, but none of them reads a hop of its own — that would be
      // the second hop the formula contract does not serve, and two objects
      // whose titles read each other would recurse without end.
      if (authority === 'caller') this.formulaHopReads.add(query);
      const related = await this.find(target, query) as Array<Record<string, unknown>>;
      const byId = new Map<string, Record<string, unknown>>();
      // Materialise the named DECLARED columns to `null`. A driver omits a key
      // whose value is `undefined`, so without this a legitimately-empty
      // parent column would fault and refuse a valid write — #6457's trap, one
      // root over and on a fail-CLOSED seam. A column the related object does
      // not declare never reaches here (it was reported above), so a real
      // "this field does not exist" fault stays distinguishable from a null.
      for (const row of Array.isArray(related) ? related : []) {
        if (row?.id == null) continue;
        const copy: Record<string, unknown> = { ...row };
        for (const name of named) if (!(name in copy)) copy[name] = null;
        byId.set(String(row.id), copy);
      }
      resolved.set(fk, { object: target, byId, ownRead });
    } catch (err) {
      this.logger?.warn?.(authority === 'caller'
        ? 'formula relationship read failed — the formulas reading through this reference read null'
        : 'predicate relationship read failed — the rule will reject the write', {
        object: target, field: fk, error: err,
      });
      resolved.set(fk, { object: target, byId: new Map(), blocked: true });
    }
  }
  if (resolved.size === 0) return unbound;

  return (row) => {
    if (!row) return undefined;
    const binding: Record<string, RelatedFieldBinding> = {};
    for (const [fk, entry] of resolved) {
      if (entry.undeclared) {
        binding[fk] = { object: entry.object, unavailable: 'undeclared-field', undeclaredFields: entry.undeclared };
        continue;
      }
      if (entry.blocked) { binding[fk] = { object: entry.object, unavailable: 'unreadable' }; continue; }
      const value = row[fk];
      if (value == null || Array.isArray(value) || typeof value === 'object') {
        binding[fk] = { object: entry.object, unavailable: 'no-reference' };
        continue;
      }
      const found = entry.byId.get(String(value));
      binding[fk] = found
        ? { object: entry.object, row: found }
        : { object: entry.object, unavailable: entry.ownRead ? 'unreadable' : 'unresolved' };
    }
    return binding;
  };
}
