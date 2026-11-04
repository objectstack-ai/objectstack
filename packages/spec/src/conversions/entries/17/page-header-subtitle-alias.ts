// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-header-subtitle-alias` conversion (`toMajor: 17`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helper
// `PAGE_HEADER_COMPONENT_TYPES` is read by this conversion alone). A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageHeaderSubtitleAlias` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents, renameKey } from '../../walk.js';
import { isDict } from '../shared.js';

/**
 * The two spellings of the page-header node, both converted by
 * {@link pageHeaderSubtitleAlias}.
 *
 * `page:header` is the protocol type (`PageComponentType`, `ComponentPropsMap`);
 * `page-header` is objectui's kebab legacy alias (`@object-ui/layout`), which is
 * authorable here because `PageComponentSchema.type` is deliberately
 * `z.union([PageComponentType, z.string()])` — an open namespace for custom
 * components.
 */
const PAGE_HEADER_COMPONENT_TYPES = new Set(['page:header', 'page-header']);

/**
 * Page-header component prop `description` → `subtitle` (protocol 17,
 * objectui#3226 / #4827).
 *
 * One concept — the page's second line — carried two authorable spellings, one
 * per renderer. `@objectstack/spec`'s `PageHeaderProps` (`ui/component.zod.ts`)
 * declares `subtitle` and nothing else; objectui's kebab legacy alias
 * `page-header` advertised `description` in its registration `inputs` and its
 * renderer read a bare `subtitle ?? description`. That is the Prime Directive
 * #12 shape exactly: a producer dialect held up by a consumer fallback, with
 * the registry teaching the off-spec key on the way in.
 *
 * **Why a conversion and not a deletion** — the load-bearing half of this
 * entry. The alias's entire reason to exist is out-of-repo consumer schemas,
 * so "no in-repo author writes `description`" is not evidence that nobody
 * does; on this key in particular, in-repo evidence has zero coverage.
 * Deleting the consumer read would drop those pages' second line *silently* —
 * the title still renders, one line vanishes, nothing errors — which is the
 * least reportable failure shape there is. So the alias retires the ADR-0087
 * D2 way instead: rewritten to the canonical key at load, and at every stored
 * row's rehydration (`applyConversionsToStoredItem` walks `pages` for free),
 * declared, loud, tested and expiring. objectui#3226 deletes its `??` once
 * this ships.
 *
 * **Both spellings of the node are converted**, deliberately. `page-header` is
 * the alias the fallback served; `page:header` is the canonical type, where an
 * authored `description` is *already* dropped on the floor today because that
 * renderer only ever read `subtitle` — the same defect, one spelling over. The
 * alias here is the KEY, not the type: this entry does **not** rewrite
 * `page-header` → `page:header`. That registration is objectui's to retire, on
 * its own schedule, and rewriting a type over an open namespace is the class of
 * move {@link flowNodeHttpRename}'s conflict guard exists for.
 *
 * Precedence is the house rule {@link renameKey} encodes and nothing new: an
 * already-canonical `subtitle` WINS, and the shadowed `description` is left
 * exactly where it sits — unconverted, unreported, unremoved — as in
 * {@link flowNodeCrudObjectAlias}. Only header nodes are touched: `description`
 * is a live declared prop elsewhere on the same surface (`element:text_input`
 * helper text), and those components are not this entry's business.
 *
 * **This entry is why the walker's reach had to grow (#6775).** Every other
 * page-component entry leans on a tombstone to cover the sites a conversion
 * cannot reach; this one has none to lean on, because `description` stays a
 * live declared prop on other components, so `properties.description` parses
 * green at ANY position. Until the walker descended into `slots.*` (#6776) and
 * into container `properties` (#6775), a header on a `kind: 'slotted'` record
 * page or inside a card/tab panel was rewritten by nobody and reported by
 * nobody — and objectui's `subtitle ?? description` fallback could not retire
 * without those pages silently losing their second line, the exact failure
 * shape this entry exists to prevent. The fixture pins all three positions.
 *
 * **Retired from the load path at 18** — its one-major window (protocol 17)
 * has run (#23421). The authoring funnel no longer rewrites the old key, so an
 * author meets `PageHeaderProps`' own refusal, which names the rename
 * (`aliases: { description: 'subtitle' }`), at every door that judges page
 * props: `os validate` / `os build` / `os lint` and the metadata save door
 * alike, where before the first two converted silently and the save door
 * refused. Stored rows keep healing: stored-row rehydration replays the full
 * chain, this entry included (`applyConversionsToStoredItem`), and so do the
 * artifact-ingestion door (inside its window) and `os migrate meta`. The kebab
 * `page-header` type stays in its walk for those replays only — objectui no
 * longer registers that type, so a source node of it renders the unknown
 * component panel whatever its props say.
 */
const pageHeaderSubtitleAlias: MetadataConversion = {
  id: 'page-header-subtitle-alias',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component.page-header.description',
  summary:
    "page-header component prop 'description' → 'subtitle' (the off-spec spelling a renderer tolerated through a bare `subtitle ?? description` fallback; `subtitle` is the declared key, and the fallback retires)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      const type = component.type;
      if (typeof type !== 'string' || !PAGE_HEADER_COMPONENT_TYPES.has(type)) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const renamed = renameKey(properties, 'description', 'subtitle');
      if (!renamed) return component;
      emit({ from: 'description', to: 'subtitle', path: `${path}.properties.subtitle` });
      return { ...component, properties: renamed };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'crm_lead_detail',
          regions: [
            {
              name: 'header',
              components: [
                // The kebab legacy alias — the spelling the `??` fallback served.
                { type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } },
                // The canonical type authored with the legacy key: converted too,
                // because today this second line is dropped on the floor.
                { type: 'page:header', properties: { title: 'Lead', description: 'One lead' } },
                // Both spellings, DIFFERENT text (#4923): kept, so the author
                // reconciles the two second lines rather than the loader picking.
                { type: 'page:header', properties: { title: 'Both', subtitle: 'wins', description: 'other' } },
                // `description` is this component's OWN declared prop (helper text) — untouched.
                { type: 'element:text_input', properties: { label: 'Note', description: 'Helper text' } },
              ],
            },
          ],
        },
        // The slotted record page — `regions: []`, header in a named slot. This
        // is the shape objectui's own guide prescribes for a customized record
        // header, and a region-only walk visited none of it (#6776).
        {
          name: 'crm_account_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'page:header', properties: { title: '{name}', description: 'Account overview' } },
          },
        },
        // Container nesting (#6775): a header inside a card's `children`, one in
        // its `footer`, one inside a tab panel, and one two levels down. All are
        // spec-valid (`properties` is an open bag) and all were invisible to the
        // region-only walk — with no tombstone to catch them at parse time.
        {
          name: 'crm_pipeline_dashboard',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'page:card',
                  properties: {
                    title: 'Pipeline',
                    children: [
                      { type: 'page-header', properties: { title: 'Open', description: 'This quarter' } },
                    ],
                    footer: [
                      { type: 'page:header', properties: { title: 'Closed', description: 'Last quarter' } },
                    ],
                  },
                },
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Activity',
                        children: [
                          { type: 'page:header', properties: { title: 'Recent', description: 'Last 7 days' } },
                          // Two levels down — the recursion, not just one hop.
                          {
                            type: 'page:card',
                            properties: {
                              children: [
                                { type: 'page:header', properties: { title: 'Nested', description: 'Deep' } },
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'crm_lead_detail',
          regions: [
            {
              name: 'header',
              components: [
                { type: 'page-header', properties: { title: 'Leads', subtitle: 'All open leads' } },
                { type: 'page:header', properties: { title: 'Lead', subtitle: 'One lead' } },
                { type: 'page:header', properties: { title: 'Both', subtitle: 'wins', description: 'other' } },
                { type: 'element:text_input', properties: { label: 'Note', description: 'Helper text' } },
              ],
            },
          ],
        },
        {
          name: 'crm_account_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'page:header', properties: { title: '{name}', subtitle: 'Account overview' } },
          },
        },
        {
          name: 'crm_pipeline_dashboard',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'page:card',
                  properties: {
                    title: 'Pipeline',
                    children: [
                      { type: 'page-header', properties: { title: 'Open', subtitle: 'This quarter' } },
                    ],
                    footer: [
                      { type: 'page:header', properties: { title: 'Closed', subtitle: 'Last quarter' } },
                    ],
                  },
                },
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Activity',
                        children: [
                          { type: 'page:header', properties: { title: 'Recent', subtitle: 'Last 7 days' } },
                          {
                            type: 'page:card',
                            properties: {
                              children: [
                                { type: 'page:header', properties: { title: 'Nested', subtitle: 'Deep' } },
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    expectedNotices: 7,
  },
};

export { pageHeaderSubtitleAlias };
