// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-kind-jsx-to-html` conversion (`toMajor: 11`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageKindJsxToHtml` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPages } from '../../walk.js';

/**
 * Page `kind: 'jsx'` → `kind: 'html'` (protocol 11.4; retired from the load
 * path at 18, #23543 F5-jsx).
 *
 * `'jsx'` was the first name of the constrained-JSX page tier (ADR-0080), which
 * ADR-0081 renamed `'html'`. The `source` semantics are identical, so the
 * rename is lossless.
 *
 * ## Retired from the load path at 18 (#23543, ruling F5-jsx A)
 *
 * Through 17 it stayed live because `'jsx'` was still a declared member of
 * `PageSchema.kind` and of `COMPILED_PAGE_KINDS`, so retired alone it would
 * have left the value silently accepted at every door (the verdict #23487
 * recorded). The ruling retired the value: `PageSchema.kind` declares it
 * through `enumWithRetiredValues` with the prescription naming `html`
 * (`PAGE_KIND_RETIRED_GUIDANCE`, `ui/page.zod.ts`), and `COMPILED_PAGE_KINDS`
 * and every reader that branched on it dropped the member. So the authoring
 * funnel (`defineStack`, `os validate` / `os build` / `os lint`) no longer
 * replays this entry, and an author is taught the canonical kind instead of
 * being rewritten. Stored pages are the `includeRetired` seams: stored-row
 * rehydration (`applyConversionsToStoredItem`) still rewrites a `sys_metadata`
 * page row written as `jsx` before anything parses it, and so does the
 * artifact-ingestion door inside its window. `os migrate meta` does not reach
 * it: protocol 11 is below `MIGRATION_SUPPORT_FLOOR`. The family's D3 entry,
 * `page-kind-jsx-retired`, states the edit for authored sources.
 */
const pageKindJsxToHtml: MetadataConversion = {
  id: 'page-kind-jsx-to-html',
  toMajor: 11,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.kind',
  summary: "page kind 'jsx' → 'html' (ADR-0080 canonical spelling)",
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      if (page.kind !== 'jsx') return page;
      emit({ from: 'jsx', to: 'html', path: `${path}.kind` });
      return { ...page, kind: 'html' };
    });
  },
  fixture: {
    before: {
      pages: [{ name: 'landing', kind: 'jsx', source: '<div>hi</div>' }],
    },
    after: {
      pages: [{ name: 'landing', kind: 'html', source: '<div>hi</div>' }],
    },
    expectedNotices: 1,
  },
};

export { pageKindJsxToHtml };
