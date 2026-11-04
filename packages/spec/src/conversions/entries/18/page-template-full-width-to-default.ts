// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-template-full-width-to-default` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageTemplateFullWidthToDefault` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPages } from '../../walk.js';

/**
 * `page.template: 'full-width'` → `'default'` (protocol 18). The #23610 ruling
 * (A on Q2, record 6190536588) closed the template set and retired `full-width`
 * by name; this entry is the data-at-rest half the P0 that followed it added.
 *
 * `full-width` was a second name for `default`: the console's template
 * registry mapped both names to the one `FullWidthTemplate` component
 * (objectui `renderers/layout/page.tsx`, read at the `.objectui-sha` pin), so
 * the re-spelling draws the page exactly as before — the enum re-spelling D2
 * was written for. The parse refuses the retired name with that prescription
 * (`PageTemplateSchema`); an installed or stored page still carrying it
 * converts here on read instead of failing the strict parse at an artifact
 * door or on a stored-row read.
 *
 * **Retired from the authoring surface from the day it lands**, like its
 * sibling `page-is-default-off-record-page-removed`: the authoring door keeps
 * the one-word refusal, data at rest replays this. Only the retired SPELLING
 * converts — an unregistered template name (`centered`, `two-column`) is not a
 * shape this entry positively recognizes and stays with the parse, and a
 * region a template does not place has no lossless rewrite at all (the D3
 * entry `page-template-closed-region-unplaced-refused` names the hand edit).
 *
 * ⚠️ Coverage boundary: this walks `stack.pages[]` ({@link mapPages}).
 * `template` is a top-level `PageSchema` key with no nested spelling.
 */
const pageTemplateFullWidthToDefault: MetadataConversion = {
  id: 'page-template-full-width-to-default',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.template',
  summary:
    "page template 'full-width' → 'default' (a second name for the same layout: the console drew "
    + 'both with one template component, so the page renders exactly as before)',
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      if (page.template !== 'full-width') return page;
      emit({ from: 'full-width', to: 'default', path: `${path}.template` });
      return { ...page, template: 'default' };
    });
  },
  fixture: {
    before: {
      pages: [
        { name: 'lead_detail_page', label: 'Lead', type: 'record', object: 'crm_lead', template: 'full-width', regions: [] },
        // A registered template is left as authored; so is a page with none.
        { name: 'sales_home_page', label: 'Sales Home', type: 'home', template: 'three-column', regions: [] },
        { name: 'team_home', label: 'Team Home', type: 'home' },
      ],
    },
    after: {
      pages: [
        { name: 'lead_detail_page', label: 'Lead', type: 'record', object: 'crm_lead', template: 'default', regions: [] },
        { name: 'sales_home_page', label: 'Sales Home', type: 'home', template: 'three-column', regions: [] },
        { name: 'team_home', label: 'Team Home', type: 'home' },
      ],
    },
    expectedNotices: 1,
  },
};

export { pageTemplateFullWidthToDefault };
