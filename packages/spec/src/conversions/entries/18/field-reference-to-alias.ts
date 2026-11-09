// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `field-reference-to-alias` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helper
// `mapObjectFieldsKey` is read by this conversion alone). A LEAF: it imports
// neither `registry.ts` nor another conversion's module. `registry.ts` imports
// `fieldReferenceToAlias` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';
import { type Dict, type Emit, isDict } from '../shared.js';

/** Rename a key on every field of every object (and object extension). Fields
 *  are a RECORD keyed by field name, so `mapCollection` does not reach them. */
function mapObjectFieldsKey(stack: Dict, collection: string, from: string, to: string, emit: Emit): Dict {
  return mapCollection(stack, collection, (owner, path) => {
    const fields = owner.fields;
    if (!isDict(fields)) return owner;
    let changed = false;
    const next: Dict = {};
    for (const [name, def] of Object.entries(fields)) {
      if (!isDict(def)) {
        next[name] = def;
        continue;
      }
      const renamed = renameKey(def, from, to);
      if (renamed) {
        emit({ from, to, path: `${path}.fields.${name}.${to}` });
        next[name] = renamed;
        changed = true;
      } else {
        next[name] = def;
      }
    }
    return changed ? { ...owner, fields: next } : owner;
  });
}

/**
 * Field `reference_to` → `reference` (protocol 18, #13700 — ui#6837 half 1).
 *
 * One concept — the target object of a `lookup`/`master_detail` field — with
 * two spellings, one per layer. `FieldSchema` declares `reference` and has
 * always REFUSED `reference_to` by name (`unrecognized_keys`, carrying the
 * rename: "Did you mean `reference_to` → `reference`?"); `reference_to` is the
 * legacy objectql runtime dialect, which is exactly the spelling a row written
 * by a seam that goes around Zod carries (`registerObject` deliberately skips
 * the parse, #3896). The consumer-side reads of the dialect have been retired
 * one by one — the SQL DDL door (#11567), the Mongo schema-sync door (#13222),
 * the verify deriver (#13250) — each replaced by a loud refusal. What none of
 * those doors reach is metadata AT REST.
 *
 * **Why a conversion when the schema already rejects** — the load-bearing
 * half, and the reason this card blocks ui#6837. A stored `sys_metadata` row
 * is runtime JSON: it is served without ever meeting the Zod gate, and the
 * rejection surface does not reach back in time to rows already written. Today
 * objectui still carries `reference ?? reference_to` fallback arms, so such a
 * row still renders; ui#6837 half 2 deletes those arms ("the backend's
 * metadata must be right; the frontend executes the protocol" — maintainer
 * ruling on that card). Without this entry the deletion would silently degrade
 * every at-rest `reference_to` lookup to a targetless picker — a raw-UUID
 * text box, the #3405 failure shape, with no diagnostic anywhere. This entry
 * makes the serve face own that history: `applyConversionsToStoredItem`
 * replays the FULL chain (retired entries included) on every stored-row
 * rehydration, so the wire only ever carries `reference`.
 *
 * **`retiredFromLoadPath` from day one** — the pre-launch one-step-rename
 * shape ({@link MetadataConversion.retiredFromLoadPath}): the key never had a
 * live authoring window to expire, because the schema never accepted it. The
 * authoring surface keeps teaching with its named rejection; this entry covers
 * the two paths that serve or rewrite EXISTING data — stored rehydration and
 * `os migrate meta`. The DDL doors above keep guarding the third path
 * (metadata handed straight to a driver, around both the gate and the stored
 * pass); they are downstream of this entry, not replaced by it.
 *
 * Deliberately NOT converted here: `referenceTo` (camelCase). That spelling is
 * objectui's *resolved action-param* dialect — a different surface with its
 * own alias table (`ACTION_PARAM_KEY_ALIASES`, `ui/action.zod.ts`) — and it is
 * not the spelling the objectql runtime wrote into stored object rows. Widening
 * this entry to a spelling with no measured at-rest population would be scope
 * invented at conversion time; the schema's rejection covers it either way.
 *
 * Precedence is the house rule {@link renameKey} encodes (#4923) and nothing
 * new: an already-canonical `reference` WINS — a redundant twin is dropped, a
 * DISAGREEING pair is left for the author to reconcile rather than the loader
 * picking a target. Covers object fields and object-extension fields: the same
 * `FieldSchema`, so the same dialect (`field-conditionalRequired-to-requiredWhen`,
 * retired with the protocol-16.x kits in #25767, was the precedent one protocol back).
 */
const fieldReferenceToAlias: MetadataConversion = {
  id: 'field-reference-to-alias',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface: 'field.reference_to',
  summary:
    "field key 'reference_to' → 'reference' (the legacy objectql runtime dialect for a "
    + "lookup/master_detail target; normalising to the protocol is the server's job and the "
    + 'renderer only executes the protocol, so stored rows must serve the canonical spelling '
    + 'before objectui deletes its `reference ?? reference_to` fallback arms)',
  apply(stack, emit) {
    const withObjects = mapObjectFieldsKey(stack, 'objects', 'reference_to', 'reference', emit);
    return mapObjectFieldsKey(withObjects, 'objectExtensions', 'reference_to', 'reference', emit);
  },
  fixture: {
    before: {
      objects: [{
        name: 'crm_contact',
        label: 'Contact',
        fields: {
          // The dialect spelling — the shape a legacy stored row carries.
          company_id: { type: 'lookup', label: 'Company', reference_to: 'crm_company' },
          // Canonical only: untouched.
          owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
          // Both spellings, SAME target: the redundant twin goes (#4923).
          account_id: { type: 'lookup', label: 'Account', reference: 'crm_account', reference_to: 'crm_account' },
          // Both spellings, DIFFERENT targets: kept, so the author reconciles
          // the two rather than the loader picking where the field points.
          parent_id: { type: 'lookup', label: 'Parent', reference: 'crm_account', reference_to: 'crm_branch' },
        },
      }],
      objectExtensions: [{
        extend: 'crm_task',
        fields: {
          project_id: { type: 'master_detail', label: 'Project', reference_to: 'crm_project' },
        },
      }],
    },
    after: {
      objects: [{
        name: 'crm_contact',
        label: 'Contact',
        fields: {
          company_id: { type: 'lookup', label: 'Company', reference: 'crm_company' },
          owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
          account_id: { type: 'lookup', label: 'Account', reference: 'crm_account' },
          parent_id: { type: 'lookup', label: 'Parent', reference: 'crm_account', reference_to: 'crm_branch' },
        },
      }],
      objectExtensions: [{
        extend: 'crm_task',
        fields: {
          project_id: { type: 'master_detail', label: 'Project', reference: 'crm_project' },
        },
      }],
    },
    // company_id (rename), account_id (redundant twin dropped), project_id
    // (extension rename). owner_id and the disagreeing parent_id emit nothing.
    expectedNotices: 3,
  },
};

export { fieldReferenceToAlias };
