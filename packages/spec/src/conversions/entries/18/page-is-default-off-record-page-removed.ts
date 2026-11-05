// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-is-default-off-record-page-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageIsDefaultOffRecordPageRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPages } from '../../walk.js';
import { misplacedDefaultPageRefusal } from '../../../ui/default-record-page.js';
import { stripKeys } from '../shared.js';

/**
 * `page.isDefault` removed from a page that is not a record page bound to an
 * object (protocol 18). The #23610 ruling (A on Q1, record 6190536588) refused
 * the flag there at every door; this entry is the data-at-rest half the P0 that
 * followed it added: an installed or stored page still carrying the flag
 * converts at load instead of stopping the environment's kernel build.
 *
 * `isDefault` has one meaning — the default record page of the object a record
 * page binds — and on every other page nothing read it: the console opens an
 * app on its first navigation item and the root landing follows the app's own
 * `isDefault`. Deleting the flag from a `home`, `app`, `utility` or `list`
 * page, or from a record page with no `object`, therefore changes nothing a
 * page does — a pure lossless delete. The ONE judge of "misplaced" is the
 * parse's own, `misplacedDefaultPageRefusal` (`ui/default-record-page.ts`), so
 * this conversion strips exactly the pages `checkPageDefaultPlacement` and the
 * registry door refuse, and nothing else: a default record page bound to an
 * object keeps its flag.
 *
 * **Retired from the authoring surface from the day it lands.** A live author
 * meets the parse's refusal, which names where a landing is really set (the
 * app's navigation) — that decision is the author's, and the refusal is how
 * they are taught it. Data at rest has no author to teach: `sys_metadata` rows
 * replay this on read, a compiled artifact replays it inside the window its
 * manifest opens, and the kernel's package registration door
 * (`ObjectQL.registerApp`, `@objectstack/objectql`) replays it for a package
 * body that declares its protocol range — the seam a hosted environment's
 * installed packages reach without a parse. The paired D3 entry is
 * `page-is-default-off-record-page-refused`.
 *
 * ⚠️ Coverage boundary: this walks `stack.pages[]` ({@link mapPages}), the
 * collection every door reads a package's pages from. A nested `plugins[]`
 * entry's pages are code (`ObjectQL.registerPlugin`), never data at rest, and
 * keep meeting the registry's refusal.
 */
const pageIsDefaultOffRecordPageRemoved: MetadataConversion = {
  id: 'page-is-default-off-record-page-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.isDefault',
  summary:
    "page key 'isDefault' removed from a page that is not a record page bound to an object (a "
    + 'home, app, utility or list page, or a record page with no object): it marks the default '
    + 'record page of an object and nothing read it on any other page — an app opens on its first '
    + 'navigation item, so the flag decided nothing',
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      if (page.isDefault !== true || misplacedDefaultPageRefusal(page) === undefined) return page;
      return stripKeys(page, ['isDefault'], emit, path);
    });
  },
  fixture: {
    before: {
      pages: [
        // The shipped shape: a home page marked as a landing that never landed.
        { name: 'sales_home_page', label: 'Sales Home', type: 'home', isDefault: true, regions: [] },
        // A record page bound to no object — the flag places nothing here either.
        { name: 'draft_record', label: 'Draft', type: 'record', isDefault: true },
        // A default record page bound to an object keeps its flag: that is the
        // one meaning the key has.
        { name: 'lead_detail_page', label: 'Lead', type: 'record', object: 'crm_lead', isDefault: true },
        // `isDefault: false` says nothing and is left as authored.
        { name: 'team_home', label: 'Team Home', type: 'home', isDefault: false },
      ],
    },
    after: {
      pages: [
        { name: 'sales_home_page', label: 'Sales Home', type: 'home', regions: [] },
        { name: 'draft_record', label: 'Draft', type: 'record' },
        { name: 'lead_detail_page', label: 'Lead', type: 'record', object: 'crm_lead', isDefault: true },
        { name: 'team_home', label: 'Team Home', type: 'home', isDefault: false },
      ],
    },
    // One notice per stripped flag: the home page and the unbound record page.
    expectedNotices: 2,
  },
};

export { pageIsDefaultOffRecordPageRemoved };
