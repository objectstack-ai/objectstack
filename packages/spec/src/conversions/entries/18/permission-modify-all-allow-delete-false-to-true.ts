// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `permission-modify-all-allow-delete-false-to-true`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `permissionModifyAllAllowDeleteFalseToTrue` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict } from '../shared.js';

/**
 * `allowDelete: false` beside `modifyAllRecords: true` → `allowDelete: true`
 * (protocol 18, #25575 — ruling letter A: keep the Modify All semantics,
 * refuse the contradictory pair at authoring and publish; the D3 semantic entry
 * `permission-modify-all-allow-delete-false-refused`).
 *
 * `modifyAllRecords` is the write bypass for edit, delete and transfer: the
 * permission evaluator grants delete on the bypass bit and never reads
 * `allowDelete`. An object-permission entry declaring both therefore parsed,
 * was stored, and let its holder delete every record. The authoring schema now
 * refuses the pair, and writes `allowDelete: true` into an entry that omits the
 * key under `modifyAllRecords: true`.
 *
 * **Why data at rest needs this entry.** The pair reaches data at rest two
 * ways. Authors wrote it: HotCRM's `sales_manager` profile declares
 * `crm_forecast` with `allowDelete: false` beside `modifyAllRecords: true`, and
 * its built 17.1 artifact carries that entry. And every parse before this
 * release filled an omitted `allowDelete` with its `false` default, so every
 * built artifact and every stored permission set whose source set
 * `modifyAllRecords: true` without naming `allowDelete` carries the pair too
 * (the showcase's `showcase_ops` among them). JSON cannot say which `false` was
 * authored and which was the default, so the rewrite takes both; an author
 * who rebuilds from a source that still declares the pair meets the refusal.
 *
 * **Lossless against the runtime.** The value written is the one the
 * evaluator already acted on: the holder could delete before, and still can.
 * No access decision changes. What changes is that the stored entry stops
 * claiming a restriction nobody enforced.
 *
 * **Retired from the load path, from day one.** The authoring funnel does not
 * replay it, so a live author meets the parse's refusal and its prescription
 * (remove `modifyAllRecords` and grant the edit with a `criteria` sharing rule
 * with `accessLevel: 'edit'`) instead of being rewritten to keep a delete grant
 * they meant to withhold. Stored rows (`applyConversionsToStoredItem`) and a
 * built artifact inside its declared-floor window get the rewrite. Idempotent:
 * a converted entry carries `allowDelete: true`, which this transform never
 * touches again.
 */
const permissionModifyAllAllowDeleteFalseToTrue: MetadataConversion = {
  id: 'permission-modify-all-allow-delete-false-to-true',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.1.0',
  surface: 'permission.objects.*.allowDelete — false beside modifyAllRecords: true',
  summary:
    "object-permission 'allowDelete: false' beside 'modifyAllRecords: true' → 'allowDelete: true' "
    + '(Modify All Records includes delete: the evaluator never read the false, so the holder could '
    + 'always delete; the entry now says so, and no access decision changes)',
  apply(stack, emit) {
    return mapCollection(stack, 'permissions', (ps, path) => {
      const objects = (ps as { objects?: unknown }).objects;
      if (!isDict(objects)) return ps;
      let touched = false;
      const next: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(objects)) {
        if (isDict(entry) && entry.modifyAllRecords === true && entry.allowDelete === false) {
          emit({ from: 'false', to: 'true', path: `${path}.objects.${name}.allowDelete` });
          next[name] = { ...entry, allowDelete: true };
          touched = true;
        } else {
          next[name] = entry;
        }
      }
      return touched ? { ...ps, objects: next } : ps;
    });
  },
  fixture: {
    before: {
      permissions: [{
        name: 'sales_manager',
        label: 'Sales Manager',
        objects: {
          // The pair, authored or filled in by an earlier parse.
          crm_forecast: { allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: true, modifyAllRecords: true },
          // No Modify All: the false is enforced and is left alone.
          crm_contact: { allowRead: true, allowEdit: true, allowDelete: false },
          // Already consistent: untouched.
          crm_account: { allowRead: true, allowEdit: true, allowDelete: true, modifyAllRecords: true },
        },
      }],
    },
    after: {
      permissions: [{
        name: 'sales_manager',
        label: 'Sales Manager',
        objects: {
          crm_forecast: { allowRead: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
          crm_contact: { allowRead: true, allowEdit: true, allowDelete: false },
          crm_account: { allowRead: true, allowEdit: true, allowDelete: true, modifyAllRecords: true },
        },
      }],
    },
    // One notice: the one entry carrying the pair.
    expectedNotices: 1,
  },
};

export { permissionModifyAllAllowDeleteFalseToTrue };
