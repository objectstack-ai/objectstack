// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-component-responsive-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageComponentResponsiveRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * page.components[].responsive (#11027, ADR-0049 D2) — the LAST carrier of the
 * `ResponsiveConfig` layout block, and the destination the
 * `dashboard-widget-responsive-removed` tombstone (#4876) prescribed as the
 * live alternative. Measured across objectstack + objectui (tsc-probe
 * methodology, positive and negative controls): objectui's two implementations
 * of the contract (`useResponsiveConfig`, `ResponsiveProtocol`) had zero
 * callers, nothing read `.responsive` off a page component, and objectui's own
 * node interface never declared the key — so the prescribed migration moved an
 * inert key to an inert key. Zero authored instances exist in either repo, so
 * this is expected to be a no-op on every real source; it exists so a stored
 * page carrying the key is cleaned deterministically rather than meeting the
 * tombstone at load. The shape (`ResponsiveConfigSchema` + its breakpoint
 * maps + `BreakpointName`) leaves with the key — `RETIRED_DEFS_BY_MAJOR[18]`.
 *
 * Like its widget sibling it survived the earlier sweeps through an instrument
 * gap, not on evidence: `page/regions` is an undrilled container
 * (`undrilled-containers.baseline.json`), so no component-level key has ever
 * been classified (#4956's page-side instance).
 *
 * The reach is every position a component can be authored in
 * ({@link mapPageComponents}): `regions[].components[]`, `slots.<slot>`, and
 * the containers a component nests under its `properties`.
 */
const pageComponentResponsiveRemoved: MetadataConversion = {
  id: 'page-component-responsive-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface: 'page.components[].responsive',
  summary:
    "page component key 'responsive' removed (ADR-0049 enforce-or-remove — no renderer ever "
    + 'applied per-component breakpoint layout overrides, and the shared ResponsiveConfig shape '
    + 'leaves with its last carrier; use responsiveStyles (ADR-0065) for breakpoint behaviour '
    + 'that IS applied)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) =>
      stripKeys(component, ['responsive'], emit, path));
  },
  fixture: {
    before: {
      pages: [{
        name: 'ops_home',
        regions: [{
          name: 'main',
          components: [
            {
              type: 'element:text',
              id: 't1',
              responsive: { columns: { xs: 12, lg: 4 }, order: { xs: 2, lg: 1 }, hiddenOn: ['xs'] },
              // Control: the LIVE per-breakpoint channel is untouched.
              responsiveStyles: { small: { padding: 'var(--space-4)' } },
            },
            // The nested position (#6775's lesson): a component inside a
            // card's container is still a component.
            {
              type: 'page:card',
              id: 'c1',
              properties: {
                children: [
                  { type: 'element:divider', id: 'd1', responsive: { hiddenOn: ['xs'] } },
                ],
              },
            },
          ],
        }],
      }],
    },
    after: {
      pages: [{
        name: 'ops_home',
        regions: [{
          name: 'main',
          components: [
            {
              type: 'element:text',
              id: 't1',
              responsiveStyles: { small: { padding: 'var(--space-4)' } },
            },
            {
              type: 'page:card',
              id: 'c1',
              properties: {
                children: [
                  { type: 'element:divider', id: 'd1' },
                ],
              },
            },
          ],
        }],
      }],
    },
    // Two notices: one per stripped key site (the region-level component and
    // the nested one).
    expectedNotices: 2,
  },
};

export { pageComponentResponsiveRemoved };
