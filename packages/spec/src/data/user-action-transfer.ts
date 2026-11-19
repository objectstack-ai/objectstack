// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveInjectedSystemColumns } from './injected-system-columns';
import type { RowCrudPredicates } from './object.zod';

/**
 * Which objects offer the dedicated Change Owner action: the structural test,
 * the object switch `userActions.transfer`, and the one resolution both server
 * and console call (maintainer ruling 7000907189, point 1).
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
 * ({@link resolveInjectedSystemColumns}`(def).owner`) and the object does not
 * declare `owner_id` read-only. So `ownership: 'business_unit' | 'org' | 'none'`,
 * every `managedBy` object, every `sys_*` object and `systemFields: false` never
 * offer the action. A declared `readonly: true` on `owner_id` is how an author
 * pins the owner: nothing moves it, so a Change Owner entry would only fail.
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

/** Does the object declare its `owner_id` field `readonly: true`? */
function ownerFieldDeclaredReadonly(obj: AnyRec): boolean {
  const fields = asRecord(obj.fields);
  if (!fields || !Object.prototype.hasOwnProperty.call(fields, OWNER_FIELD)) return false;
  return asRecord(fields[OWNER_FIELD])?.readonly === true;
}

/**
 * Why `def` cannot offer the Change Owner action, as one clause naming the
 * structural fact — or `undefined` when it is eligible. The ONE structural
 * test: {@link isTransferEligible} is this answer's absence, and the parse
 * refusal names the clause it returns.
 *
 * The owner-column clauses follow {@link resolveInjectedSystemColumns}'s own
 * order, so the reason named is the one that withheld the column.
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
      return 'it declares systemFields: false, so the platform gives it no owner_id column';
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
      return "it is owned by a business unit (ownership: 'business_unit'), not by a person, so it has no owner_id column";
    }
    if (typeof ownership === 'string') {
      return `it declares ownership: '${ownership}', so its records have no per-record owner`;
    }
    return 'the platform gives it no owner_id column';
  }
  if (ownerFieldDeclaredReadonly(obj)) {
    return 'it declares owner_id readonly, which pins the owner so no change of owner can be made';
  }
  return undefined;
}

/**
 * Is `def` structurally eligible for the Change Owner action — does the
 * platform inject its reassignable `owner_id`, and is that field not declared
 * read-only? Derived from the object's own keys and never overridable: the
 * switch `userActions.transfer` can only narrow an eligible object.
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
 * The one resolution: the server's Change Owner endpoint refuses an object this
 * answers `enabled: false` for, and the console shows the action only where it
 * answers `true` — both then ask the caller's transfer verdict per record.
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
