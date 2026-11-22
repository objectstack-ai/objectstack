// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveInjectedSystemColumns } from './injected-system-columns';
import { isOwnerAnchorUnprovable } from './injected-system-column-provenance';
import type { RowCrudPredicates } from './object.zod';

/**
 * Which objects offer the dedicated Change Owner action: the structural test,
 * the object switch `userActions.transfer`, and the one resolution the server's
 * Change Owner endpoint and the console's action both read (maintainer
 * ruling 7000907189, point 1). The server's endpoint (`@objectstack/core`'s
 * `change-record-owner.ts`, card #35402) refuses an object this resolves off;
 * the console's action is card #35403.
 *
 * ## Visibility is three facts, and only two live here
 *
 * The action shows on a record when the object is structurally eligible, the
 * object's switch is on, and the caller holds the transfer verdict on that
 * record. The third fact is the permission engine's (edit with `allowTransfer`,
 * or `modifyAllRecords`, read from the explain engine's `transfer` operation);
 * this module answers the first two, which are properties of the object, not of
 * the caller.
 *
 * ## Structural eligibility (derived, never overridable)
 *
 * An object is eligible when the platform injects its reassignable owner column
 * ({@link resolveInjectedSystemColumns}`(def).owner`), an owner is provable for
 * it, and the object does not declare `owner_id` read-only. So
 * `ownership: 'business_unit' | 'org' | 'none'`, every `managedBy` object, every
 * `sys_*` object and `systemFields: false` never offer the action. An ADR-0015
 * `external` object whose owner anchor is unprovable
 * ({@link isOwnerAnchorUnprovable}: the injected `owner_id` has no storage
 * behind it and no `external.columnMap` entry maps a remote column onto it) has
 * no owner to change either, so it does not offer the action; declaring
 * `owner_id`, or mapping a remote column onto it, makes it eligible. A declared
 * `readonly: true` on `owner_id` is how an author pins the owner: nothing moves
 * it, so a Change Owner entry would only fail.
 *
 * ## The switch (`userActions.transfer`)
 *
 * The same shape as the CRUD entries beside it: a boolean, or
 * `{ enabled, visibleWhen, disabledWhen }` whose predicates read the record the
 * action acts on. Omitted, it derives from `sharingModel`: on for `private`,
 * `public_read` and `public_read_write`, and for an object that declares no
 * `sharingModel` (a custom object then resolves to `private`); off for a
 * `controlled_by_parent` detail, whose access already follows its master.
 * Authors override both ways — on for a detail with a real owner, off where the
 * owner is the actor by rule.
 *
 * `enabled: true` (or a bare `true`) on an ineligible object is refused at parse
 * (`ObjectSchema`'s refinement, ADR-0049: a key is enforced or not declared).
 * Closing the switch there restates what the structure already says and is
 * accepted.
 *
 * The switch gates the dedicated action — single, bulk and cascade — and not
 * the raw write: a plain `owner_id` update stays governed by `allowTransfer`
 * alone, so import mappings and hooks are unaffected (ruling point 2). An author
 * who wants a hard block declares `owner_id` read-only.
 *
 * Tolerant of bare, un-parsed metadata records (the same contract as
 * {@link resolveInjectedSystemColumns}), so a runtime reading a registered
 * schema and an author-time tool reading a draft get the same answer.
 */

type AnyRec = Record<string, unknown>;

const OWNER_FIELD = 'owner_id';

function asRecord(value: unknown): AnyRec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRec) : undefined;
}

/**
 * Does the object declare its `owner_id` field `readonly: true`? Reads both
 * registered `fields` shapes — the record shape (`fields: { owner_id: {...} }`)
 * and the array shape (`fields: [{ name: 'owner_id', ... }]`) — as
 * `readDeclaredFieldDef` in `injected-system-column-provenance.ts` does, so a
 * pinned owner reads the same in either.
 */
function ownerFieldDeclaredReadonly(obj: AnyRec): boolean {
  const fields = obj.fields;
  if (Array.isArray(fields)) {
    return fields.some((f) => {
      const field = asRecord(f);
      return field !== undefined && field.name === OWNER_FIELD && field.readonly === true;
    });
  }
  const record = asRecord(fields);
  if (!record || !Object.prototype.hasOwnProperty.call(record, OWNER_FIELD)) return false;
  return asRecord(record[OWNER_FIELD])?.readonly === true;
}

/**
 * Why `def` cannot offer the Change Owner action, as one clause naming the
 * structural fact — or `undefined` when it is eligible. The ONE structural
 * test: {@link isTransferEligible} is this answer's absence, and the parse
 * refusal names the clause it returns.
 *
 * Where the object can be made eligible by changing its own declaration, the
 * clause ends with that change (`to offer it, …`), so each arm carries its own
 * prescription: drop `systemFields: false`, set `ownership` to `user`, declare
 * or map an external owner, or drop `readonly` from `owner_id`. A `managedBy`
 * or `sys_*` object has none — the action is not for it.
 *
 * The owner-column clauses follow {@link resolveInjectedSystemColumns}'s own
 * order, so the reason named is the one that withheld the column; then whether
 * an owner is provable ({@link isOwnerAnchorUnprovable}); then a pinned owner.
 */
export function transferIneligibilityReason(def: unknown): string | undefined {
  // Fail closed: an unreadable definition offers nothing (an empty record would
  // otherwise read as `ownership` omitted, the owner-bearing default).
  const obj = asRecord(def);
  if (!obj) return 'it is not an object definition';
  if (!resolveInjectedSystemColumns(obj).owner) {
    const managedBy = obj.managedBy;
    const name = typeof obj.name === 'string' ? obj.name : '';
    const ownership = obj.ownership;
    if (obj.systemFields === false) {
      return 'it declares systemFields: false, so the platform gives it no owner_id column; ' +
        'to offer it, drop systemFields: false';
    }
    if (typeof managedBy === 'string' && managedBy.length > 0) {
      return `it is managedBy: '${managedBy}', a platform-managed table with no per-record owner`;
    }
    if (managedBy !== undefined && managedBy !== null) {
      return 'it declares managedBy, which makes it a platform-managed table with no per-record owner';
    }
    if (name.startsWith('sys_')) {
      return "it is a system object (its name starts with 'sys_'), which has no per-record owner";
    }
    if (ownership === 'business_unit') {
      return "it is owned by a business unit (ownership: 'business_unit'), not by a person, so it has no " +
        "owner_id column; to offer it, set ownership to 'user' or omit it";
    }
    if (typeof ownership === 'string') {
      return `it declares ownership: '${ownership}', so its records have no per-record owner; ` +
        "to offer it, set ownership to 'user' or omit it";
    }
    return 'the platform gives it no owner_id column';
  }
  if (isOwnerAnchorUnprovable(obj)) {
    return 'it is an external object whose owner_id has no remote column behind it (it neither declares ' +
      'owner_id nor maps a remote column onto it in external.columnMap), so no owner is provable; ' +
      'to offer it, declare owner_id or map the remote owner column onto it in external.columnMap';
  }
  if (ownerFieldDeclaredReadonly(obj)) {
    return 'it declares owner_id readonly, which pins the owner so no change of owner can be made; ' +
      'to offer it, drop readonly from owner_id';
  }
  return undefined;
}

/**
 * Is `def` structurally eligible for the Change Owner action — does the
 * platform inject its reassignable `owner_id`, is an owner provable for it, and
 * is that field not declared read-only? Derived from the object's own keys and
 * never overridable: `userActions.transfer` turns the action on or off only on
 * an eligible object, and cannot open it anywhere else.
 */
export function isTransferEligible(def: unknown): boolean {
  return transferIneligibilityReason(def) === undefined;
}

/**
 * The object's Change Owner switch, resolved: structural eligibility first,
 * then `userActions.transfer`, then the default `sharingModel` implies.
 */
export interface UserActionTransferResolution {
  /** Whether the object offers the action at all. The caller's transfer verdict is still owed per record. */
  enabled: boolean;
  /**
   * CEL predicates over the record the action acts on, present only when the
   * switch used the object form with at least one predicate (and the object is
   * eligible). Kept as authored, for the canonical CEL row-predicate evaluator:
   * `visibleWhen` false hides the action (fail-closed); `disabledWhen` true
   * renders it disabled (fail-soft).
   */
  predicates?: RowCrudPredicates;
}

/**
 * The switch's default when `userActions.transfer` is omitted: off on a
 * `controlled_by_parent` detail, on for every other `sharingModel` and for none.
 */
function derivedTransferDefault(obj: AnyRec): boolean {
  return obj.sharingModel !== 'controlled_by_parent';
}

/**
 * Resolve whether `def` offers the Change Owner action, and with which
 * per-record predicates. An ineligible object answers `{ enabled: false }`
 * whatever its switch says; an eligible one collapses `userActions.transfer`
 * (bare boolean or `{ enabled, visibleWhen, disabledWhen }`) onto the default
 * `sharingModel` implies, the same collapse the CRUD entries take onto their
 * `managedBy` default.
 *
 * The one resolution, for its two readers: the server's Change Owner endpoint
 * (card #35402) refuses an object this answers `enabled: false` for, and the
 * console (card #35403) shows the action only where it answers `true` — both
 * then asking the caller's transfer verdict per record.
 */
export function resolveUserActionTransfer(def: unknown): UserActionTransferResolution {
  if (!isTransferEligible(def)) return { enabled: false };
  const obj = asRecord(def) ?? {};
  const base = derivedTransferDefault(obj);
  const authored = asRecord(obj.userActions)?.transfer;
  if (authored === undefined || authored === null) return { enabled: base };
  if (typeof authored === 'boolean') return { enabled: authored };
  const override = asRecord(authored);
  if (!override) return { enabled: base };
  const enabled = typeof override.enabled === 'boolean' ? override.enabled : base;
  const visibleWhen = override.visibleWhen as RowCrudPredicates['visibleWhen'] | null | undefined;
  const disabledWhen = override.disabledWhen as RowCrudPredicates['disabledWhen'] | null | undefined;
  if (visibleWhen == null && disabledWhen == null) return { enabled };
  const predicates: RowCrudPredicates = {};
  if (visibleWhen != null) predicates.visibleWhen = visibleWhen;
  if (disabledWhen != null) predicates.disabledWhen = disabledWhen;
  return { enabled, predicates };
}
