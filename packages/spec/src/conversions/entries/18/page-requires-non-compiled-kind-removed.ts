// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-requires-non-compiled-kind-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageRequiresNonCompiledKindRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPages } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `page.requires` removed from the page kinds whose source is never compiled at
 * save — `react`, `full` and `slotted`, a page that omits `kind` included
 * (protocol 18, #21459; ruling record 5964312254, letter A).
 *
 * `requires` is the plugin-namespace list ADR-0080 §5 derives from an html
 * page's source at save. `PageSchema` used to admit it on every kind, yet on
 * these three nothing derives it: the save door compiles only `html` / `jsx`
 * (`COMPILED_PAGE_KINDS`), the Studio page editor drops the key on every save,
 * and its one reader there was the load report's warning. The parse now refuses
 * it on these kinds (`checkPageRequiresKind` in `ui/page.zod.ts`).
 *
 * **A strip — a pure lossless delete.** On these kinds the list never derived,
 * gated or rendered anything, so deleting it changes nothing a page does; it is
 * what a Studio save of the same page already does. The paired D3 entry is
 * `page-requires-non-compiled-kind-refused`.
 *
 * Scoped by `kind`, exactly as the refusal is: the kinds stripped are
 * `PageSchema`'s kind vocabulary minus `COMPILED_PAGE_KINDS` (pinned in
 * `ui/page-requires-compiled-kinds.test.ts`), an absent `kind` reading as the
 * spec default `full`. An `html` / `jsx` page keeps its list — the save door
 * judges it — and an unknown `kind` is left as stored: that refusal is the kind
 * enum's, not this entry's.
 *
 * ⚠️ Coverage boundary: this walks `stack.pages[]` ({@link mapPages}).
 * `requires` is a top-level `PageSchema` key with no nested spelling.
 */
const pageRequiresNonCompiledKindRemoved: MetadataConversion = {
  id: 'page-requires-non-compiled-kind-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface: 'page.requires',
  summary:
    "page key 'requires' removed from react, full and slotted pages (a page with no kind is "
    + 'full) — the plugin-namespace list is derived from the source at save only on html / jsx '
    + 'pages; on the other kinds nothing derived or enforced it, and the Studio page editor drops it',
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      if (page.requires === undefined) return page;
      const kind = page.kind ?? 'full';
      if (kind !== 'full' && kind !== 'slotted' && kind !== 'react') return page;
      return stripKeys(page, ['requires'], emit, path);
    });
  },
  fixture: {
    before: {
      pages: [
        // A react page whose author listed the plugins its source uses.
        { name: 'crm_workbench', kind: 'react', source: '<Workbench />', requires: ['ui'] },
        // A slotted record page, and a page with no kind (the `full` default).
        { name: 'lead_record', type: 'record', kind: 'slotted', requires: ['plugin-kanban'] },
        { name: 'team_home', label: 'Team Home', requires: [] },
        // An html page keeps its list: the save door derives and judges it.
        { name: 'command_center', kind: 'html', source: '<flex />', requires: ['ui'] },
      ],
    },
    after: {
      pages: [
        { name: 'crm_workbench', kind: 'react', source: '<Workbench />' },
        { name: 'lead_record', type: 'record', kind: 'slotted' },
        { name: 'team_home', label: 'Team Home' },
        { name: 'command_center', kind: 'html', source: '<flex />', requires: ['ui'] },
      ],
    },
    // One per stripped key: the react, slotted and kind-less pages. The html
    // page emits none.
    expectedNotices: 3,
  },
};

export { pageRequiresNonCompiledKindRemoved };
