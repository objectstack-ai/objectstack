// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * A stored `view` row's `columnState` leaves the wire surface (protocol 18,
 * #36403 — ADR-0049 enforce-or-remove; the spec half of #35955, where the
 * maintainer ruled column widths browser-only and the server-side per-user
 * list preference layer retired, 2026-11-21).
 *
 * The key was a runtime-only console round-trip key (`VIEW_CONSOLE_ROUND_TRIP_KEYS`
 * in `ui/view.zod.ts`), declared on two wire doors: the view item RECORD
 * (`viewItemWireFields()`, member 1 of the `view` union) and the FLATTENED
 * overlay (`flattenedViewOverlayFields()`, members 3 and 4). The console's grid
 * wrote one column order and set of widths there and read it back. Both ends are
 * gone: the overlay writer retired with objectui#12504, and since #35955 a column
 * drag goes to the list's draft while widths live in the reader's browser. Writer
 * census before removal, at `main` 97b9d1e6: none in this framework, its examples
 * or its console, none in the HotCRM app or the gallery; cloud was not reachable.
 *
 * **Retired from the load path** — the key is a `retiredKey()` tombstone on both
 * doors, so a live author is refused at parse with the prescription. The entry
 * exists because a STORED row can carry it: the write door accepted and persisted
 * it until this release, and every read of a stored `view` row replays the chain
 * through `applyConversionsToStoredItem` as `{ views: [row] }` before it is served
 * or badged. It also lets `os migrate meta --from 17` list the edits for sources.
 *
 * **One family, both spellings.** Unlike the `owner` / `hidden` pair, which
 * retired from the two doors in two cards and so carries two entries, this key
 * retires from both at once: a record (`viewKind` list/form with a `config`
 * object) and a flattened overlay (no `config`, no container slot) are both
 * stripped here. A container (`list` / `form` / `listViews` / `formViews`)
 * never declared the key and is left alone.
 *
 * What the strip leaves depends on what else the row holds — two classes:
 *
 * - **Content-bearing** — a record, or an overlay with any view key besides the
 *   identity the write path stamps (`name` / `object` / `viewKind` / `label`):
 *   served and badged valid without the key, a GET then a PUT of the whole row
 *   saves (if it was otherwise valid), and `os migrate meta --stored --apply`
 *   rewrites it.
 * - **Column-state-only overlay** — identity plus `columnState` and nothing else,
 *   the shape a column drag on a system view wrote before objectui#12504: the
 *   strip leaves IDENTITY ONLY, which the `view` door's identity precondition
 *   refuses (#7741, "only identity fields"). The row is served without the key
 *   but badged invalid; `--apply` reports it `failed` and leaves it as stored,
 *   and every read strips it again. Remedy: delete the row — the maintainer
 *   ruled the stored layout is not carried forward (#35955, 「清掉」).
 *
 * **Two collections**, like the `owner` / `hidden` entries: `views` is the stack
 * collection and the stored-row seam's wrapping; `viewItems`
 * ({@link ASSEMBLED_VIEW_ITEMS_KEY}) is the assembled-manifest channel, whose
 * registration parse (`AssembledViewArtifactSchema`, built from the same
 * members) now refuses the key too. Deletion is the whole conversion, and it
 * changes no render: no reader applies a stored column layout any more.
 */
const viewColumnStateRemoved: MetadataConversion = {
  id: 'view-column-state-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'view.columnState — on a view item record ({ name, object, viewKind, config }) and on a flattened view overlay ({ name, object, viewKind, …, no config })',
  summary:
    "view key 'columnState' removed (ADR-0049 — the console's per-user column order and widths, "
    + 'stored on a shared view row; nothing writes or reads it since column widths moved to the '
    + "reader's browser and a column order is saved into the view itself)",
  apply(stack, emit) {
    const stripFromRow = (view: Dict, path: string): Dict => {
      if (view.config !== undefined) {
        const kind = view.viewKind;
        if ((kind !== 'list' && kind !== 'form') || !isDict(view.config)) return view;
        return stripKeys(view, ['columnState'], emit, path);
      }
      if (view.list !== undefined || view.form !== undefined) return view;
      if (view.listViews !== undefined || view.formViews !== undefined) return view;
      return stripKeys(view, ['columnState'], emit, path);
    };
    return mapCollection(
      mapCollection(stack, 'views', stripFromRow),
      ASSEMBLED_VIEW_ITEMS_KEY,
      stripFromRow,
    );
  },
  fixture: {
    before: {
      // The assembled-manifest channel: a record a package export carried
      // before this release.
      viewItems: [
        {
          name: 'crm_case.open',
          object: 'crm_case',
          viewKind: 'list',
          columnState: { order: ['subject', 'status'] },
          config: { type: 'grid', columns: ['subject', 'status'] },
        },
      ],
      views: [
        // A flattened overlay: the key goes, the live round-trip keys beside
        // it (`isDefault`, `label`) are untouched.
        {
          name: 'crm_case.all',
          object: 'crm_case',
          viewKind: 'list',
          label: 'All cases',
          isDefault: true,
          columnState: { order: ['status', 'subject'], widths: { subject: 240 } },
        },
        // A record: the key goes, `config` is untouched.
        {
          name: 'crm_case.mine',
          object: 'crm_case',
          viewKind: 'list',
          columnState: { widths: { subject: 180 } },
          config: { type: 'grid', columns: ['subject'] },
        },
        // A row that never carried the key rides through untouched.
        { name: 'crm_case.by_status', object: 'crm_case', viewKind: 'list', order: 3 },
        // A container is not a row of either door: untouched.
        { object: 'crm_case', list: { type: 'grid', columns: ['subject'] } },
      ],
    },
    after: {
      viewItems: [
        {
          name: 'crm_case.open',
          object: 'crm_case',
          viewKind: 'list',
          config: { type: 'grid', columns: ['subject', 'status'] },
        },
      ],
      views: [
        { name: 'crm_case.all', object: 'crm_case', viewKind: 'list', label: 'All cases', isDefault: true },
        {
          name: 'crm_case.mine',
          object: 'crm_case',
          viewKind: 'list',
          config: { type: 'grid', columns: ['subject'] },
        },
        { name: 'crm_case.by_status', object: 'crm_case', viewKind: 'list', order: 3 },
        { object: 'crm_case', list: { type: 'grid', columns: ['subject'] } },
      ],
    },
    // One notice per KEY removed: two in `views`, one in `viewItems`.
    expectedNotices: 3,
  },
};

export { viewColumnStateRemoved };
