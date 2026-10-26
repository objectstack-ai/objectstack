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
 * exported.
 *
 * What stays in the class: `referenceExists`, `resolveMasterDetailParent` and
 * `resolveMasterDetailParents`, which read the private static
 * `referenceCheckContext` and hold an erased query-options site; the bodies
 * that call a module helper `engine.ts` still needs elsewhere
 * (`settleMasterDetailLanding`, `resolvePreviewParents`,
 * `resolvePredicateRelated`, `resolveOneHopRelated`); and
 * `masterDetailHeaderExists`, `materializeParentHeader` and
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
 * they call (`find`, `masterDetailHeaderExists`, `referenceExists`) go as
 * late-bound closures over the instance, so a double or spy set on the engine
 * is still the one a call reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import { referenceTargetOf, type EngineQueryOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
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
  masterDetailHeaderExists: ObjectQL['masterDetailHeaderExists'];
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

/** The body of `ObjectQL#assertReferencesResolve`; the method's docblock there is its contract. */
export async function assertReferencesResolve(
  this: Pick<ReferentialIntegrityHost, 'masterDetailHeaderExists' | 'referenceExists'>,
  schema: any,
  data: Record<string, unknown> | null | undefined,
  supplied: Record<string, unknown> | null | undefined,
  context: any,
  msgCtx?: { locale?: string; translate?: any; objectName?: string },
): Promise<void> {
  if (context?.isSystem) return;
  const fields = schema?.fields;
  if (!fields || !data) return;

  const failures: any[] = [];
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
      // [#22519] A master-detail header must also be one the caller can read.
      const resolved = def?.type === 'master_detail'
        ? await this.masterDetailHeaderExists(target, v, context)
        : await this.referenceExists(target, v, context);
      if (resolved === false) {
        failures.push(buildFieldError(
          {
            field: name,
            code: 'reference_not_found',
            def,
            value: String(v),
            constraint: { target },
          },
          msgCtx as any,
        ));
      }
    }
  }
  if (failures.length > 0) throw new ValidationError(failures);
}

/** The body of `ObjectQL#masterDetailHeadersCallerReads`; the method's docblock there is its contract. */
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
