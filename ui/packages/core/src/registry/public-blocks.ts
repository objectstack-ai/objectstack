/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0080 — the curated PUBLIC block contract (capability ≠ contract).
 *
 * The subset of registered components that form the platform's *contract* and
 * AI-authoring vocabulary: type-checked, api-surface-ratcheted, documented, and
 * offered to the JSX-source authoring surface. The full ~244 registered types
 * remain a rendering *capability* (`getAllConfigs`); only these are the
 * contract (`getPublicConfigs`).
 *
 * Shaped like Salesforce App Builder standard components — small, object-centric
 * — plus a thin layout/content layer and one escape hatch. A component not yet
 * registered is simply skipped (the list is aspirational-safe). Registrations
 * may also opt in individually via `tier: 'public'`.
 *
 * This is a single, reviewable source of truth for the public surface — prefer
 * editing this list over scattering `tier` flags across registration sites.
 *
 * ⛔ The html tier's intrinsic elements (`h1`, `p`, `a`, the sectioning tags, …)
 * do NOT belong here. They reach the published manifest through the second
 * roster beside this one, `HTML_TIER_INTRINSICS`, stamped `tier: 'html'`, so
 * that the manifest's other reader — the objectstack gate that whitelists a
 * `kind:'html'` page's tags — accepts them without this curated JSON-surface
 * vocabulary growing (objectui#10735). Listing one here would widen the
 * vocabulary silently; `html-tier-intrinsics.test.ts` pins the two disjoint.
 */
export const PUBLIC_BLOCKS: readonly string[] = [
  // ── Tier A — object-aware blocks (the contract core) ──────────────────────
  'object-grid',
  'list-view',
  'object-form',
  'embeddable-form',
  'object-master-detail-form',
  'object-kanban',
  'object-calendar',
  'object-gantt',
  'object-timeline',
  'object-map',
  // Curated by objectui#10064, which is a NARROWING being undone rather than a
  // widening: `@objectstack/spec` already declares `object-tree` on
  // `ComponentPropsMap`, and @object-ui/plugin-tree has registered the renderer
  // all along — this roster was the one face that withheld it, so the tier sat
  // narrower than the declaration. Everything downstream reported that
  // faithfully and could not fix it: `getPublicConfigs()` is what both manifest
  // producers serialize, so the framework's tracked `sdui.manifest.json` could
  // never carry a block the contract says exists, and moving the objectui pin
  // could not help while the pinned source had nothing to carry
  // (objectstack#18407, whose parity-gate half waits on this entry).
  //
  // The `tree` alias the same module registers is deliberately NOT here: it is
  // a second spelling of this one block and @objectstack/spec declares no such
  // key, so curating it would widen the vocabulary past the declaration — the
  // opposite act — and leave an authoring model two names for one block, which
  // is the ground `record:chatter` is held out on above.
  'object-tree',
  'object-metric',
  'object-chart',
  'dashboard',
  'object-pivot',
  'record:details',
  'record:highlights',
  'record:related_list',
  'record:path',
  // `record:`-prefixed, like its four siblings above. @object-ui/plugin-form
  // registers this one with `skipFallback: true`, so the bare `line_items` key
  // it was listed under here never existed — the block has shipped all along
  // but could never resolve through the contract (objectui#2953 follow-up).
  'record:line_items',
  // Configurable as of objectui#3023 follow-up: these shipped with renderers
  // but no declared `inputs`, so a model could only emit them bare — which is
  // why they sat outside the contract. Their inputs now mirror what the
  // renderers actually read, so they are authorable and belong here.
  //
  // `record:chatter` is deliberately NOT in this list: it is the same renderer
  // as `record:discussion` under a Salesforce-familiar name, kept for schemas
  // already in the wild. Two spellings of one block is ambiguity an authoring
  // model has no way to resolve, so the vocabulary carries the spec's name.
  'record:activity',
  'record:discussion',
  'record:history',
  'record:quick_actions',
  'record:reference_rail',
  'record:alert',
  // ── Tier A, continued — page-semantic blocks (the spec ui/page vocabulary) ─
  // The `page:` / `element:` / `action:` families the Studio page designer
  // offers and @objectstack/spec's page schema enumerates. Same standing as
  // the `record:` family above: semantic page blocks, not primitives.
  //
  // Deliberately NOT here (each guarded, with its reason, by the console's
  // reverse-coverage test):
  //   action:bar               record:quick_actions covers the record action
  //                            strip, and the spec blesses button/group/icon/
  //                            menu but not bar
  //   element:image            duplicates the curated `image` primitive below —
  //                            one spelling per concept
  //   element:record_picker    record picking is a field widget, not a page
  //                            block (Studio palette exclusion)
  //   element:text_input       bare inputs belong to a form, not a page block
  //                            (Studio palette exclusion)
  //   element:metadata_viewer  internal metadata debugging surface
  'page:tabs',
  'page:card',
  'page:accordion',
  'page:section',
  'page:footer',
  'page:sidebar',
  'element:text',
  'element:number',
  'element:button',
  'element:definition-list',
  'element:repeater',
  'action:button',
  'action:group',
  'action:menu',
  'action:icon',
  // ── Tier B — layout / content primitives ──────────────────────────────────
  'flex',
  'grid',
  'stack',
  'card',
  'tabs',
  'accordion',
  'container',
  // The neutral block container, minted by the 2026-08-29 ruling as the JSON
  // surface's replacement for the deprecated `div` (objectui#3965, PR #6878).
  // It landed on every other declaration face — interface, zod mirror,
  // `SchemaRegistry`, registration, docs page, and 27 catalog fixtures — and
  // this list was the one face it missed, so the vocabulary taught a type the
  // contract did not carry (`3619792bf`).
  //
  // MEASURED before it was added, because "add it and see" is how a gate
  // discovers a new population at merge time. `registry-inputs-spec-parity`
  // (apps/console) does NOT judge it, and not by tolerance: its coverage set is
  // SPEC-shaped — `Object.keys(ComponentPropsMap)`, filtered to what this repo
  // registers with inputs. It never reads this list, and membership here is
  // neither necessary nor sufficient for being judged: `element:record_picker`
  // is judged while absent from this list, and `flex` / `grid` / `stack` /
  // `card` / `container` are all listed here and all unjudged, because
  // `@objectstack/spec@17` carries no entry for ANY Tier B layout primitive. So
  // `box` joins a spec-less population five types deep rather than opening a
  // new one; it needs no spec entry, and no gate needed loosening to accept it.
  //
  // ⚠️ And "not on this list" never meant "not on an authoring surface". `box`
  // has been validated all along through the OTHER consumer of the same
  // `inputs`: `components/src/renderers/layout/page.tsx` builds the JSX-page
  // compiler's manifest from `getKnownTypes()`, registry-wide. What this list
  // gates is `getPublicConfigs()` — the curated AI-authoring vocabulary, and
  // through `sdui-parser/scripts/gen-manifest.ts` the published
  // `sdui.manifest.json` and `sdui-intrinsics.d.ts`. THAT is the surface `box`
  // was missing from, which is a narrower and truer statement of the gap than
  // "the contract does not know it".
  //
  // The measurement is pinned next to the roster census in `apps/console`, over
  // the DERIVED container population rather than over this list.
  'box',
  'page:header',
  'text',
  'image',
  'icon',
  'markdown',
  'element:divider',
  'badge',
  'alert',
  'button',
  // ── Tier C — escape hatch (flagged, second-class) ─────────────────────────
  'html',
];

/** Fast membership set built from {@link PUBLIC_BLOCKS}. */
export const PUBLIC_BLOCK_SET: ReadonlySet<string> = new Set(PUBLIC_BLOCKS);
