// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ruling 7000907189 point 4 · ADR-0049] A `transferBehavior: 'cascade'`
// declaration the Change Owner action can never offer, refused where the
// author is.
//
// The runtime is safe on its own: `transferCascadeRelations`
// (`@objectstack/core`'s `change-record-owner.ts`) re-judges every
// relationship on every call and offers only the ones that can act, and the
// endpoint refuses a whole call on a parent that does not offer Change Owner.
// What the runtime cannot do is tell the author, so three declarations parse
// and then do nothing — a key nothing honours, which ADR-0049 forbids:
//
//  1. {@link TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER} — the reference
//     points at a parent in this stack that does not offer Change Owner
//     (`ownership: 'org' | 'none' | 'business_unit'`, `managedBy`, a pinned or
//     unprovable owner, or `userActions.transfer` off). The cascade runs only
//     inside a Change Owner of the parent, so it never runs. Cross-object, so
//     no field or object parse can judge it. A `sys_` parent is the field
//     parse's (`FieldSchema` refuses `'cascade'` on a reference to one) and is
//     not judged again here.
//  2. {@link TRANSFER_CASCADE_EXTENSION_CHILD_INELIGIBLE} — the field is added
//     to its object through `ObjectExtensionSchema.fields`, and that object
//     cannot take a Change Owner cascade. `ObjectSchema`'s refinement
//     (`refuseIneligibleTransferCascades`) refuses the same declaration on a
//     field the object declares itself, but an extension's field never passes
//     through that parse. `fieldPatches` cannot carry the key at all: a patch
//     sets display properties only, and its schema refuses `transferBehavior`
//     as an unrecognized key, so there is nothing to walk there.
//  3. {@link TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED} — the child's declared
//     API exposure (`enable.apiEnabled` / `enable.apiMethods`) does not serve
//     `update`. The cascade moves the child's rows as updates through the data
//     door, so `transferCascadeRelations` leaves such a child out.
//
// All judgement lives in the SHARED predicates the runtime reads, imported
// from `@objectstack/spec/data`: `resolveUserActionTransfer` /
// `transferIneligibilityReason` (does the parent offer Change Owner — the
// endpoint's `changeOwnerOffReason` asks the same), `transferCascadeIneligibilityReason`
// (can the child take a cascade — the parse refinement and
// `transferCascadeRelations` ask the same) and `apiExposureDenialReason` (the
// exposure filter, whose boolean face `canServeApiOperation` is what
// `transferCascadeRelations` calls). This file is only the walk. If a verdict
// seems wrong, fix the predicate, never this walk.
//
// Objects are judged as the registry SERVES them (`objectsAsServed`: every
// `objectExtensions` field folded in), because `transferCascadeRelations`
// reads the registered, merged definitions. An object the stack does not
// declare (another package's) cannot be judged and is skipped, whichever side
// of the relationship it is on.
//
// Only the fields the runtime reads are judged: a single-value `lookup` or
// `master_detail` field. Any other type, a multi-value reference and a
// reference to a `sys_` object are refused by the field parse with their own
// prescription, so judging them here would report one mistake twice.

import {
  apiExposureDenialReason,
  referenceTargetOf,
  resolveUserActionTransfer,
  transferCascadeIneligibilityReason,
  transferIneligibilityReason,
  type EnableLike,
} from '@objectstack/spec/data';

import { collectionEntries } from './collection-entries.js';
import { objectExtensionsByTarget, objectsAsServed } from './object-graph.js';

/** Case 1: the referenced parent does not offer Change Owner. */
export const TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER = 'transfer-cascade-parent-without-change-owner';
/** Case 2: an extension's field declares a cascade on an object that cannot take one. */
export const TRANSFER_CASCADE_EXTENSION_CHILD_INELIGIBLE = 'transfer-cascade-extension-child-ineligible';
/** Case 3: the child's declared API exposure does not serve `update`. */
export const TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED = 'transfer-cascade-child-update-unexposed';

export interface TransferCascadeFinding {
  /**
   * Always `error`: each verdict is decidable from the stack's own
   * declarations, and the declaration would ship as a key nothing honours
   * (the `object/managed-api-method-unaffordable` precedent, and the parse's
   * own refusal of the declaring object's half).
   */
  severity: 'error';
  rule:
    | typeof TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER
    | typeof TRANSFER_CASCADE_EXTENSION_CHILD_INELIGIBLE
    | typeof TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED;
  /** e.g. `field "deal_note.account"`. */
  where: string;
  /** e.g. `objects[1].fields.account.transferBehavior`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** One `transferBehavior: 'cascade'` declaration, where it was written. */
interface CascadeSite {
  /** The object whose records the cascade would move (the field's owner as served). */
  child: string;
  field: string;
  def: AnyRec;
  /** Path of the field record itself, without `.transferBehavior`. */
  fieldPath: string;
  /** Set when the field comes from an `objectExtensions` entry. */
  viaExtension: boolean;
}

/** The field records of an authored `fields` value, each with its own path. */
function fieldSites(fields: unknown, base: string): Array<{ name: string; def: AnyRec; path: string }> {
  if (Array.isArray(fields)) {
    return fields.flatMap((def, i) =>
      isRec(def) && typeof def.name === 'string' ? [{ name: def.name, def, path: `${base}[${i}]` }] : []);
  }
  if (!isRec(fields)) return [];
  return Object.entries(fields).flatMap(([name, def]) => (isRec(def) ? [{ name, def, path: `${base}.${name}` }] : []));
}

/** The fields `transferCascadeRelations` reads: a single-value relationship declaring `'cascade'`. */
function declaresCascade(def: AnyRec): boolean {
  return def.transferBehavior === 'cascade'
    && (def.type === 'lookup' || def.type === 'master_detail')
    && def.multiple !== true;
}

/** The parent a reference field points at, or `undefined` (an unreadable carrier included). */
function parentOf(def: AnyRec): string | undefined {
  try {
    return referenceTargetOf(def);
  } catch {
    return undefined;
  }
}

/**
 * Why `parent` does not offer Change Owner, or `undefined` when it does. The
 * verdict is `resolveUserActionTransfer`'s; the clause names the structural
 * reason (`transferIneligibilityReason`, which carries its own arm's
 * prescription) or which switch keeps the action off.
 */
function parentOffReason(def: AnyRec): string | undefined {
  if (resolveUserActionTransfer(def).enabled) return undefined;
  const structural = transferIneligibilityReason(def);
  if (structural !== undefined) return structural;
  const authored = isRec(def.userActions) ? def.userActions.transfer : undefined;
  if (authored !== undefined && authored !== null) {
    return 'its userActions.transfer is off; to offer it, turn userActions.transfer on';
  }
  return 'it is a controlled_by_parent detail, on which Change Owner is off unless it sets ' +
    'userActions.transfer to true';
}

/** Every cascade declaration of the stack: the objects' own fields, then the extensions' fields. */
function cascadeSites(stack: AnyRec): CascadeSite[] {
  const sites: CascadeSite[] = [];
  for (const { rec, path } of collectionEntries(stack.objects, 'objects')) {
    if (typeof rec.name !== 'string') continue;
    for (const f of fieldSites(rec.fields, `${path}.fields`)) {
      if (declaresCascade(f.def)) {
        sites.push({ child: rec.name, field: f.name, def: f.def, fieldPath: f.path, viaExtension: false });
      }
    }
  }
  for (const [target, entries] of objectExtensionsByTarget(stack)) {
    for (const ext of entries) {
      if (ext.stored) continue;
      for (const def of ext.fields) {
        if (typeof def.name !== 'string' || !declaresCascade(def)) continue;
        sites.push({ child: target, field: def.name, def, fieldPath: `${ext.path}.fields.${def.name}`, viaExtension: true });
      }
    }
  }
  return sites;
}

/**
 * Refuse each `transferBehavior: 'cascade'` declaration in the stack that the
 * Change Owner action can never offer. One finding per case per field: the
 * cases have different fixes, and a field can fail more than one.
 */
export function validateTransferCascades(stack: unknown): TransferCascadeFinding[] {
  const out: TransferCascadeFinding[] = [];
  if (!isRec(stack)) return out;

  const served = new Map<string, AnyRec>();
  for (const obj of objectsAsServed(stack).objects) {
    if (typeof obj.name === 'string') served.set(obj.name, obj);
  }

  for (const site of cascadeSites(stack)) {
    const where = `field "${site.child}.${site.field}"`;
    const path = `${site.fieldPath}.transferBehavior`;
    const declared = `Field '${site.field}' on '${site.child}' declares transferBehavior: 'cascade'`;

    const parent = parentOf(site.def);
    const parentDef = parent !== undefined && !parent.startsWith('sys_') ? served.get(parent) : undefined;
    const parentReason = parentDef !== undefined ? parentOffReason(parentDef) : undefined;
    if (parent !== undefined && parentReason !== undefined) {
      out.push({
        severity: 'error',
        rule: TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER,
        where,
        path,
        message:
          `${declared} to '${parent}', but '${parent}' does not offer Change Owner: ${parentReason}. ` +
          'A cascade runs only inside a Change Owner of the parent, so it never runs.',
        hint:
          `Set transferBehavior to 'none' or remove it; or, if '${parent}' should offer Change Owner, ` +
          'change it as the reason says.',
      });
    }

    const childDef = served.get(site.child);
    if (childDef === undefined) continue;

    if (site.viaExtension) {
      const childReason = transferCascadeIneligibilityReason(childDef);
      if (childReason !== undefined) {
        out.push({
          severity: 'error',
          rule: TRANSFER_CASCADE_EXTENSION_CHILD_INELIGIBLE,
          where,
          path,
          message:
            `${declared} through an object extension, but '${site.child}' cannot take a Change Owner ` +
            `cascade: ${childReason}. A cascade moves this object's records by the Change Owner action, so ` +
            'it acts only on an object that offers that action itself.',
          hint: "Set transferBehavior to 'none' or remove it from the extension's field.",
        });
      }
    }

    const denial = apiExposureDenialReason(
      isRec(childDef.enable) ? (childDef.enable as EnableLike) : undefined,
      'update',
    );
    if (denial !== null) {
      const exposure = denial === 'api-disabled'
        ? 'its enable.apiEnabled is false'
        : 'its enable.apiMethods does not include update';
      out.push({
        severity: 'error',
        rule: TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED,
        where,
        path,
        message:
          `${declared}, but '${site.child}' does not serve update through the data API: ${exposure}. ` +
          "A cascade moves this object's records as updates through the data API, so Change Owner never " +
          'offers it.',
        hint: denial === 'api-disabled'
          ? `Set transferBehavior to 'none' or remove it; or turn enable.apiEnabled on for '${site.child}'.`
          : `Set transferBehavior to 'none' or remove it; or add 'update' to enable.apiMethods of '${site.child}'.`,
      });
    }
  }
  return out;
}
