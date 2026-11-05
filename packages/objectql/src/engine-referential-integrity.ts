// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 10] Two referential-integrity bodies of `ObjectQL`, moved out
 * of `engine.ts` whole: `assertReferencesResolve` (the write path's #4441
 * reference check: a caller-supplied id in a reference field must name a row
 * of its target) and `masterDetailHeadersCallerReads` (#22519: which
 * master-detail headers the caller's own read door returns), with
 * `isEmptyReferenceValue`, the module helper only the first of them calls.
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same system-caller exit, the same `readonly` and
 * caller-supplied skips, the same master-detail branch, the same one-`find`
 * read door and the same warning when that read fails. Each method's
 * docblock stays on the method in `engine.ts`, which is still the contract.
 * `isEmptyReferenceValue` moves with its docblock, byte for byte, and is not
 * exported. [#28881] Since the move, the system-caller exit keeps the check for
 * a flow run's elevated write (the method's docblock, Scope).
 *
 * What stays in the class: `referenceExists`, `resolveMasterDetailParent` and
 * `resolveMasterDetailParents`, which read the private static
 * `referenceCheckContext` and hold an erased query-options site; the bodies
 * that call a module helper `engine.ts` still needs elsewhere
 * (`settleMasterDetailLanding`, `resolvePreviewParents`,
 * `resolvePredicateRelated`, `resolveOneHopRelated`); and
 * `callerReadableReferenceExists`, `materializeParentHeader` and
 * `masterDeclaredFields`, whose bodies are no longer than the host literal
 * moving them would cost.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied per method as
 * `engine-compatibility-api.ts` applies it. The class keeps both methods with
 * name, modifiers, signature, docblock and position, and each body is one
 * literal of exactly the {@link ReferentialIntegrityHost} members that method
 * reads, plus a `.call`. The one field a body reads (`logger`) goes as a
 * GETTER, so the read happens when the body makes it, as it did. The methods
 * they call (`find`, `callerReadableReferenceExists`, `referenceExists`) go as
 * late-bound closures over the instance, so a double or spy set on the engine
 * is still the one a call reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import { referenceTargetOf, type EngineQueryOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { keepsFlowWriteReferenceCheck } from '@objectstack/core';
import { ValidationError, buildFieldError } from './validation/record-validator.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * member is a getter.
 */
export interface ReferentialIntegrityHost {
  readonly logger: ObjectQL['logger'];
  find: ObjectQL['find'];
  callerReadableReferenceExists: ObjectQL['callerReadableReferenceExists'];
  referenceExists: ObjectQL['referenceExists'];
}

/**
 * [#4441] "The caller did not name a record here."
 *
 * `null` / `undefined` / `''` mean NO LINK — exactly what
 * `deleteBehavior: 'set_null'` writes — and an empty array is the multi-value
 * spelling of the same thing. None of them is an id to resolve.
 */
function isEmptyReferenceValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0 || v.every((e) => e === null || e === undefined || e === '');
  return false;
}

/**
 * [#29029] The reference types whose target a non-system write may name only
 * when the caller's own read door returns it: `master_detail` (#22519), and
 * `lookup` and `user` with it. A target the caller cannot read answers
 * `reference_not_found`, exactly as a target that exists nowhere. `tree`, the
 * one other reference type, keeps the elevated existence probe: the rulings
 * that tightened this set (records 6573561091 and 6663849489) name `lookup`
 * and `user` only.
 */
const CALLER_READ_REFERENCE_TYPES: ReadonlySet<string> = new Set(['master_detail', 'lookup', 'user']);

/**
 * [#4441] Referential integrity on the WRITE path: a `lookup` (or any
 * reference-typed field) may not be given an id that exists in no row of the
 * object it declares.
 *
 * The field metadata is unambiguous — `{"type":"lookup","required":true,
 * "reference":"sys_permission_set"}` — and the DELETE side already reasons
 * about the edge (`deleteBehavior: 'set_null'`). Only the insert side never
 * checked, so `POST /data/sys_position_permission_set
 * {"permission_set_id":"ps_does_not_exist_at_all"}` created the row.
 *
 * On the RBAC link tables that is a security-surface record that resolves to
 * nothing: an administrator auditing permissions sees a binding whose target
 * cannot be inspected, and the audience-anchor gate had to resolve that very
 * set to evaluate the grant — so a dangling row was an unevaluable gate input,
 * not merely an untidy one. (That gate and `sys_position_permission_set` are
 * retired since C3 stage 8; the check stands for the link tables that remain.)
 *
 * ## Scope, deliberately narrow
 *
 * - **Caller-supplied keys only.** Server stamps (`owner_id`,
 *   `organization_id`, `created_by`/`updated_by`) are lookups too; they are
 *   written by hooks and middleware, not by the request, and re-validating
 *   them here would turn a platform stamp into a caller-facing rejection.
 * - **Non-system writes only**, like every other write-path guard in this
 *   engine (`stripReadonlyFields` — which since #14147 runs on the create
 *   path as well as the update one — and `stripRuntimeOwnedFields`). Seed
 *   replay,
 *   package install and boot-time provisioning legitimately write rows in an
 *   order that resolves only once the batch completes; failing them closed
 *   would turn an ordering detail into a boot failure. This leaves a real
 *   residual — an `isSystem` caller can still write a dangling reference —
 *   which is recorded on the issue rather than silently accepted.
 *   [#28881] ⛔ Except a flow run's elevated write (`runAs: 'system'`):
 *   its context carries the flow-write mark (`keepsFlowWriteReferenceCheck`,
 *   `@objectstack/core`, set by `resolveRunDataContext` in
 *   service-automation) and is checked like a user write. Its elevation is
 *   for authorization (other people's rows, past RLS and FLS), never for a
 *   link to a row that does not exist, and it keeps every authorization
 *   exemption `isSystem` gives it. A write it sets off (a hook's `ctx.api`,
 *   its `sudo()`, a cascade leg) spreads that context and is checked as
 *   the flow's own.
 * - **Empty values are not references.** `null` / `undefined` / `''` mean
 *   "no link", which is what `deleteBehavior: 'set_null'` produces.
 * - **Already-expanded objects are skipped.** A read round-trip can hand back
 *   `{id, name, …}` in the slot; that is not an id write.
 * - **A value the row already stores is not the write's (#29062).** The
 *   check judges only the references a write ADDS. An update's `storedRows`
 *   (the by-id prior row; a predicate update's matched rows) forgive a
 *   refused value, or a multi-valued member, that every one of those rows
 *   already holds: an edit form carries the whole record back, and a stored
 *   id that has since stopped resolving (the delete walk leaves a `user`
 *   value in place, `DELETE_SEMANTICS_REFERENCE_TYPES`) is not the editor's
 *   to answer for. A value new to any of the rows is refused as before, and
 *   an insert has no stored rows, so every value it supplies is judged.
 *
 * ## Why the existence probe bypasses RLS — and why it keeps the tenant wall
 *
 * Existence is a fact about the database, not about the caller's ROW-LEVEL
 * visibility — the same distinction the #4435 existence probe turns on. So
 * the existence probe ({@link referenceExists}) is elevated: `isSystem`
 * bypasses RBAC, RLS and FLS. Whether a NON-system caller may name the row is
 * the separate question the next section answers, and it is asked first, of
 * the caller's own read door, for every reference type but `tree`.
 *
 * That argument is about visibility, never about TENANCY, and the elevation
 * is therefore `sudo()`-shaped — `{ ...context, isSystem: true }`, see
 * {@link referenceExists} — not a bare `{ isSystem: true }` (#19808). The
 * bare spelling carried no `tenantId`, so the probe spanned every
 * organization: an org-bound caller could store a reference to another
 * organization's row, and could tell "exists in another organization" (the
 * write committed) from "exists nowhere" (refused) — a cross-tenant existence
 * oracle. With the caller's context spread first, `buildDriverOptions`
 * forwards its `tenantId` to the driver, a row stamped with another
 * organization is not found, and both cases answer the same
 * `reference_not_found`. The tenancy exemptions stay where they are decided:
 * `buildDriverOptions` withholds `tenantId` for a `tenancy.enabled: false`
 * (platform-global) object and for a federated one, so a reference to either
 * still resolves from an org-bound caller. A row with no organization is no
 * tenant's (ADR-0131 D1): the driver's scope is the organization equality,
 * with no `IS NULL` arm, so an org-bound caller's probe does not find one.
 *
 * ## A non-system caller may name only a row its own read door returns (#22519, #29029)
 *
 * A `master_detail`, `lookup` or `user` value a non-system caller supplies
 * must name a row the caller's own read door returns; a write naming a row
 * the caller cannot read answers exactly what a write naming a row that
 * exists nowhere answers: `reference_not_found`. So for those three types the
 * caller's read door is asked first ({@link callerReadableReferenceExists}),
 * then the elevated, tenant-kept existence probe for a row it returned. A
 * multi-valued field is judged per member: one unreadable member refuses the
 * write. Nothing upstream of this check settles it: ADR-0055 §3 gates a
 * detail write on its header (master edit) only for a `controlled_by_parent`
 * detail, and nothing gates a lookup on its target, so an elevated probe
 * alone would let a caller bind its row to a row it has no access to, and
 * tell "exists" apart from "exists nowhere". #22519 (ruling A) set the rule
 * for `master_detail`; ruling records 6573561091 and 6663849489 extended it
 * to `lookup` and `user` as the default, with no field-level opt-out. A
 * system caller keeps the exemption above (its read door returns every row),
 * and a value the row already stores is not judged again (#29062). `tree`
 * keeps the elevated probe alone.
 *
 * Fails OPEN when the target cannot be checked (unregistered object, no
 * driver, a probe that throws): an integrity check that cannot run must not
 * invent a rejection, and the alternative — refusing every write to an object
 * whose target lives on an unreachable datasource — converts a connectivity
 * problem into data loss. A caller's read door that fails is the exception:
 * it did not return the row, so the row is missing for that caller, for a
 * `master_detail`, `lookup` or `user` value alike
 * (see {@link masterDetailHeadersCallerReads}).
 */
export async function assertReferencesResolve(
  this: Pick<ReferentialIntegrityHost, 'callerReadableReferenceExists' | 'referenceExists'>,
  schema: any,
  data: Record<string, unknown> | null | undefined,
  supplied: Record<string, unknown> | null | undefined,
  context: any,
  msgCtx?: { locale?: string; translate?: any; objectName?: string },
  storedRows?: StoredReferenceRows,
): Promise<void> {
  // [#28881] A system caller is exempt, except a flow run's elevated write:
  // its elevation is for authorization, and it keeps this check (see
  // `keepsFlowWriteReferenceCheck`, @objectstack/core).
  if (context?.isSystem && !keepsFlowWriteReferenceCheck(context)) return;
  const fields = schema?.fields;
  if (!fields || !data) return;

  const refused: Array<{ name: string; def: any; value: unknown; target: string }> = [];
  for (const name of Object.keys(fields)) {
    // [#4441, narrowing kept by #4743] A `readonly` field is never the
    // caller's to answer for — BY CONSTRUCTION, not by exemption.
    //
    // This check answers for exactly one thing: "the reference the CALLER
    // named". `stripReadonlyFields` removes a non-system caller's value from
    // a readonly field before the write — on BOTH write paths since #14147
    // moved the create-side strip into this engine and deleted the boundary
    // copy it used to live in. So a value still sitting in one at
    // this point was minted by the PLATFORM — outside this check's own stated
    // scope, whatever it happens to hold. That argument stands on its own and
    // depends on no particular field: deleting the `continue` would start
    // rejecting the platform's own writes, which is why it is recorded here
    // (AGENTS.md PD #13) rather than left to be re-derived.
    //
    // Historical note, kept because it is how the narrowing was FOUND (the
    // dogfood gate, not reasoning) and because the audit next door re-scoped
    // itself on its removal: `sys_metadata_history.recorded_by` is a
    // `Field.lookup('sys_user', { readonly: true })` that the metadata
    // repository once filled with `actor ?? 'system'` — a SENTINEL STRING,
    // not a user id, on a write carrying no `isSystem`; checking it rejected
    // ordinary metadata authoring (package create / publish / clone). #4556
    // replaced that sentinel with NULL, so no platform write puts a non-id in
    // a reference column any more. The narrowing survives it unchanged
    // because it never rested on it — but #4551's blanket audit skip did, and
    // #4743/#5719 duly re-scoped that one (see `inspectDanglingReferences`).
    //
    // This does NOT weaken #4441: the fields the issue names —
    // `sys_position_permission_set.permission_set_id` and
    // `showcase_task.project` — are ordinary author-facing lookups with no
    // `readonly`, and both stay enforced (pinned in the unit suite).
    if (fields[name]?.readonly === true) continue;
    // Only a value the CALLER actually supplied is theirs to answer for.
    //
    // Key presence is not enough: a form serializes an unpicked control as
    // an explicit `null`, and `applyFieldDefaults` then fills it from
    // `defaultValue` — including the `current_user` token (#2706). The key is
    // in the payload, but the ID that lands is the PLATFORM's, so validating
    // it would report a server-derived value as the caller's bad reference
    // (and reject a perfectly ordinary insert against a driver that has no
    // `sys_user` row for the acting principal).
    //
    // So the value read for the check comes from the post-normalization
    // `data` (multi-value strings are already split by then), while WHETHER
    // to check is decided by the caller's own raw value being non-empty.
    if (!supplied || isEmptyReferenceValue((supplied as Record<string, unknown>)[name])) continue;
    if (!(name in data)) continue;
    const def = fields[name];
    const target = referenceTargetOf(def);
    if (!target) continue;
    const raw = (data as Record<string, unknown>)[name];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'object') continue;
      // [#22519, #29029] A master-detail header, a lookup target and a user
      // must also be one the caller can read.
      const resolved = CALLER_READ_REFERENCE_TYPES.has(def?.type)
        ? await this.callerReadableReferenceExists(target, v, context)
        : await this.referenceExists(target, v, context);
      if (resolved === false) refused.push({ name, def, value: v, target });
    }
  }
  if (refused.length === 0) return;
  // [#29062] A refused value every row this write lands on already stores
  // is not a reference the write ADDS, so it is not this caller's to answer
  // for. The stored rows are read only now, once a probe has refused.
  const stored = storedRows ? (await storedRows() ?? []).filter(isRow) : [];
  const failures = refused
    .filter((r) => stored.length === 0 || !stored.every((row) => storedReferenceIds(row[r.name]).has(String(r.value))))
    .map((r) => buildFieldError(
      {
        field: r.name,
        code: 'reference_not_found',
        def: r.def,
        value: String(r.value),
        constraint: { target: r.target },
      },
      msgCtx as any,
    ));
  if (failures.length > 0) throw new ValidationError(failures);
}

/**
 * [#29062] The rows a write lands on, as stored before it, read on demand by
 * {@link assertReferencesResolve}: the by-id update's prior row, or the
 * matched rows of a predicate update. Absent (an insert), every value the
 * caller supplied is the write's own.
 */
export type StoredReferenceRows = () => Promise<ReadonlyArray<Record<string, unknown> | null | undefined> | null>;

function isRow(row: unknown): row is Record<string, unknown> {
  return row !== null && typeof row === 'object';
}

/** The ids a stored reference value holds: each member of a multi-valued one, or the one scalar. */
function storedReferenceIds(value: unknown): ReadonlySet<string> {
  const members = Array.isArray(value) ? value : [value];
  const ids = new Set<string>();
  for (const m of members) if (typeof m === 'string' || typeof m === 'number') ids.add(String(m));
  return ids;
}

/**
 * [#22519] Read 1 of the write's master-detail header read: which of `ids`
 * the caller's READ DOOR returns — one `find` for the whole batch, under the
 * caller's own context, so every enforcement layer in the middleware chain
 * (RBAC, RLS, sharing, row scope) answers it, as it answers the preview's
 * first read ({@link resolvePreviewParents}). Projected to `id`: what the
 * header HOLDS is read 2's question, never this one's.
 *
 * A header it does not return binds as a header that exists nowhere binds:
 * the reference check answers `reference_not_found` for it
 * ({@link callerReadableReferenceExists}), and the write's header resolution
 * leaves `parent` unbound for it ({@link resolveMasterDetailParent},
 * {@link resolveMasterDetailParents}). A read that fails — a refusal of the
 * read itself included — returned no header, so every header binds as
 * missing, as the preview binds them and as the write's own failed header
 * read does; ⛔ never as readable.
 *
 * A SYSTEM caller (seed replay, boot) has no read door to ask: every id goes
 * straight to read 2, and its write resolves exactly as before.
 */
export async function masterDetailHeadersCallerReads(
  this: Pick<ReferentialIntegrityHost, 'find' | 'logger'>,
  master: string,
  ids: ReadonlyArray<unknown>,
  context: ExecutionContext | undefined,
): Promise<ReadonlySet<string>> {
  const asked = new Map<string, unknown>();
  for (const id of ids) if (id != null) asked.set(String(id), id);
  if (context?.isSystem || asked.size === 0) return new Set(asked.keys());
  // One id is asked by equality, the predicate shape the elevated probe
  // already sends; a batch by `$in`, as read 2 of the batch reads it.
  const values = [...asked.values()];
  try {
    const rows = await this.find(master, {
      where: { id: values.length === 1 ? values[0] : { $in: values } },
      fields: ['id'],
      context,
    } as EngineQueryOptions) as Array<Record<string, unknown>>;
    const served = new Set<string>();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.id != null && asked.has(String(row.id))) served.add(String(row.id));
    }
    return served;
  } catch (err) {
    this.logger?.warn?.('the caller\'s read of the master-detail header failed — the header binds as a missing header', {
      object: master, error: err,
    });
    return new Set();
  }
}
