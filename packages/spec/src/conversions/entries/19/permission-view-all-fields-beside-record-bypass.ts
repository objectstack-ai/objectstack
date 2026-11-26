// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `permission-view-all-fields-beside-record-bypass` conversion
// (`toMajor: 19`), the field-axis split's step 3 (ruling of record 6912661484,
// letter A; stored-row reading by ruling of record 7177446075, option A). A
// LEAF: it imports neither `registry.ts` nor another conversion's module.
// `registry.ts` imports `permissionViewAllFieldsBesideRecordBypass` and lists
// it in `MAJOR_19_CONVERSIONS`.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict } from '../shared.js';

/**
 * `viewAllFields: true` written beside `viewAllRecords: true` or
 * `modifyAllRecords: true` (protocol 19).
 *
 * Until protocol 19 View All (`viewAllRecords`) and Modify All
 * (`modifyAllRecords`) cast a vote on every field of the object in the field
 * merge (`superuserFieldVote` in `@objectstack/core`, ruling of record
 * 6573563853): View All voted read, Modify All voted read and edit, so one
 * set's bit re-opened a field another set hid. From 19 the two bits widen
 * RECORDS only, and the one "every field" bit is `viewAllFields`, which votes
 * read and never edit (`viewAllFieldsReadVote`).
 *
 * ## What this rewrites
 *
 * Every `objects` entry of every permission set, the `'*'` entry included,
 * that carries `viewAllRecords: true` or `modifyAllRecords: true` and has no
 * `viewAllFields` key gets `viewAllFields: true`, so a source written while the
 * bits read every field keeps every read they cast. An entry whose author
 * already wrote `viewAllFields` — either value — has spoken and is left alone,
 * which is also what makes a second replay a no-op.
 *
 * What it does NOT keep, by ruling (it has no lossless rewrite and no
 * conversion can restore it):
 * - Modify All's EDIT vote. `viewAllFields` votes read only, so a field
 *   another set locks (`editable: false`) is no longer editable by a Modify All
 *   holder, and neither is a field the set's OWN field row names without
 *   `editable: true` (an omitted `editable` is false); an explicit
 *   `editable: true` row in the set that should edit it is the grant.
 * - Modify All overriding the set's OWN `readable: false` rows. Beside
 *   `viewAllFields` an own row binds (specific beats general inside one set),
 *   so after the rewrite such a row hides its field from the set's holders,
 *   which Modify All did not let it do before. View All already behaved that
 *   way (ADR-0066 D2 ⑧, note of 2026-11-15).
 * Both move toward FEWER fields seen or edited; no rewrite here opens a field.
 *
 * ## Where it replays — `os migrate meta --from 18`, and no load seam
 *
 * A DEFAULT FLIP, not a rename or a delete: an entry with View All and no
 * `viewAllFields` still parses, and now MEANS "every record, no field vote".
 * The rewrite changes what it means, so it is sound only where "this source
 * predates the flip" is a fact — the D3 chain alone, where the operator
 * asserts the source's age with `--from`. `retiredFromLoadPath: true` keeps it
 * off the authoring funnel (`normalizeStackInput`), where an author writing
 * View All against the 19 contract must not be handed a field bypass. That
 * flag's jurisdiction ends there, so every data-at-rest seam refuses this id
 * by name, as `flow-decision-mode-inclusive-explicit` is refused:
 * - the artifact-ingestion door (`DEFAULT_FLIPS_NOT_REPLAYED_HERE` in
 *   `@objectstack/metadata-core`): a scaffolded `^18` floor is a dependency
 *   range, not an age;
 * - every stored-row seam (`STORED_ROWS_NOT_REWRITTEN` in `stored.ts`, which
 *   `applyConversionsToStoredItem` applies for the database loader, the
 *   ObjectQL stored-row read, the metadata-protocol read and
 *   `os migrate meta --stored` alike): by ruling, a permission set stored in
 *   `sys_metadata` is read with the 19 meaning and never rewritten. Nothing
 *   about a stored row says it was saved before the flip; Studio saves sets
 *   today. The fix for a stored set is adding `viewAllFields: true` to the
 *   entry through the metadata API.
 */
const permissionViewAllFieldsBesideRecordBypass: MetadataConversion = {
  id: 'permission-view-all-fields-beside-record-bypass',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'permission.objects.*.viewAllFields — absent beside viewAllRecords: true or modifyAllRecords: true',
  summary:
    "object-permission entry ('*' included) with 'viewAllRecords: true' or 'modifyAllRecords: true' and no "
    + "'viewAllFields': 'viewAllFields: true' written beside it (from protocol 19 View All and Modify All widen "
    + 'records only and cast no field vote; the bit keeps every field read they cast. Modify All\'s edit vote '
    + 'is not kept, and the set\'s own readable: false rows now bind)',
  apply(stack, emit) {
    return mapCollection(stack, 'permissions', (ps, path) => {
      const objects = (ps as { objects?: unknown }).objects;
      if (!isDict(objects)) return ps;
      let touched = false;
      const next: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(objects)) {
        if (
          isDict(entry)
          && (entry.viewAllRecords === true || entry.modifyAllRecords === true)
          && entry.viewAllFields === undefined
        ) {
          const bit = entry.modifyAllRecords === true ? 'modifyAllRecords' : 'viewAllRecords';
          emit({
            from: `viewAllFields absent beside ${bit}: true (the bit voted on every field)`,
            to: 'true',
            path: `${path}.objects.${name}.viewAllFields`,
          });
          next[name] = { ...entry, viewAllFields: true };
          touched = true;
        } else {
          next[name] = entry;
        }
      }
      return touched ? { ...ps, objects: next } : ps;
    });
  },
  fixture: {
    // DISJOINT from every other permission fixture: no `allowDelete: false`
    // beside Modify All, no retired key, so the whole table hits only this one.
    before: {
      permissions: [
        {
          name: 'ops_auditor',
          label: 'Ops Auditor',
          objects: {
            // View All alone: rewritten.
            ops_ticket: { allowRead: true, viewAllRecords: true },
            // Modify All alone: rewritten.
            ops_asset: { allowRead: true, allowEdit: true, allowDelete: true, modifyAllRecords: true },
            // The wildcard entry: rewritten.
            '*': { allowRead: true, viewAllRecords: true, modifyAllRecords: true, allowEdit: true, allowDelete: true },
            // The author already spoke, either way: left alone.
            ops_secret: { allowRead: true, viewAllRecords: true, viewAllFields: false },
            ops_report: { allowRead: true, viewAllRecords: true, viewAllFields: true },
            // No record bypass: left alone.
            ops_note: { allowRead: true, allowEdit: true },
          },
          fields: {
            'ops_ticket.cost': { readable: false },
          },
        },
      ],
    },
    after: {
      permissions: [
        {
          name: 'ops_auditor',
          label: 'Ops Auditor',
          objects: {
            ops_ticket: { allowRead: true, viewAllRecords: true, viewAllFields: true },
            ops_asset: { allowRead: true, allowEdit: true, allowDelete: true, modifyAllRecords: true, viewAllFields: true },
            '*': { allowRead: true, viewAllRecords: true, modifyAllRecords: true, allowEdit: true, allowDelete: true, viewAllFields: true },
            ops_secret: { allowRead: true, viewAllRecords: true, viewAllFields: false },
            ops_report: { allowRead: true, viewAllRecords: true, viewAllFields: true },
            ops_note: { allowRead: true, allowEdit: true },
          },
          fields: {
            'ops_ticket.cost': { readable: false },
          },
        },
      ],
    },
    // Three notices: `ops_ticket`, `ops_asset` and the `'*'` entry.
    expectedNotices: 3,
  },
};

export { permissionViewAllFieldsBesideRecordBypass };
