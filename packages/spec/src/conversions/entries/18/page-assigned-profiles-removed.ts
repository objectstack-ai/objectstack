// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-assigned-profiles-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageAssignedProfilesRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPages } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `page.assignedProfiles` removed (protocol 18, ADR-0090 D2 / ADR-0049).
 *
 * The key named the Profile concept ADR-0090 D2 deleted, and it enforced
 * nothing anywhere: measured across this repository and objectui, every hit was
 * a declaration, a generated artifact, prose or a round-trip test — no renderer,
 * route or metadata read door ever read it. A page that "assigned profiles"
 * therefore stayed open to every caller who could reach it, which is the
 * declared-not-enforced class ADR-0049 retires. Maintainer ruling 2026-09-12.
 *
 * **A strip, not a rewrite.** There is no lossless target: page audience is the
 * permission set's, and which set a given page's profile list corresponds to is
 * a judgement no walker can make. So the mechanical half deletes the key (here)
 * and the judgement half is a D3 semantic TODO
 * (`page-assigned-profiles-audience-to-permission-set`) that names the route.
 * The two halves are deliberate: a conversion that silently dropped an audience
 * declaration with no TODO would read as "handled".
 *
 * ⚠️ Coverage boundary: this walks `stack.pages[]` ({@link mapPages}), the one
 * collection the key was authorable on. `assignedProfiles` has no nested
 * spelling — it was a top-level `PageSchema` key — so there is no second site.
 */
const pageAssignedProfilesRemoved: MetadataConversion = {
  id: 'page-assigned-profiles-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'page.assignedProfiles',
  summary:
    "page key 'assignedProfiles' removed (ADR-0090 D2 deleted the Profile concept it was named "
    + 'for, and no renderer, route or read door ever enforced it — the page stayed open to '
    + 'everyone; ADR-0049 enforce-or-remove)',
  apply(stack, emit) {
    return mapPages(stack, (page, path) => stripKeys(page, ['assignedProfiles'], emit, path));
  },
  fixture: {
    before: {
      pages: [
        // The authored shape: a page whose author believed the list gated it.
        { name: 'deal_desk', label: 'Deal Desk', assignedProfiles: ['admin', 'sales_manager'] },
        // A page with nothing to strip keeps its identity (copy-on-write).
        { name: 'team_home', label: 'Team Home' },
      ],
    },
    after: {
      pages: [
        { name: 'deal_desk', label: 'Deal Desk' },
        { name: 'team_home', label: 'Team Home' },
      ],
    },
    expectedNotices: 1,
  },
};

export { pageAssignedProfilesRemoved };
