/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9642 — THE PAGE-KIND to NODE-TYPE CHANNEL, declared.
 *
 * ## The channel
 *
 * A stored page document's `type` field is the spec's page KIND, enumerated by
 * `PageTypeSchema` in `@objectstack/spec/ui`. `PageView` in `@object-ui/app-shell`
 * hands that document to `SchemaRenderer` with the kind written VERBATIM into
 * `type` — the SchemaNode discriminator `ComponentRegistry` dispatches on — and
 * a copy on `pageType` (the comment there opens "`type` stays the SchemaNode
 * discriminator ComponentRegistry dispatches on").
 *
 * ⇒ The `ComponentRegistry.register(..., PageRenderer, ...)` calls in
 * `renderers/layout/page.tsx` exist BECAUSE of that line. They are not a
 * component family; they are the renderer half of `PageTypeSchema`, which is
 * why one of them is labelled "App Page".
 *
 * ## Why this file exists rather than another comment
 *
 * A comment stating the channel was already present at the writing end, and two
 * cards were nevertheless reasoned to the opposite conclusion from the reading
 * end: an auditor who opens the registry sees names registered with no schema
 * declaring them and concludes "registered but never declared" — a real defect
 * shape in this repository. objectui#9263 ruled on that reading and reached a
 * draft PR that would have stopped every stored kind-`app` page rendering
 * (OBJUI-001 in place of the page); objectui#9576 proposed the same disposition
 * for the other kinds. objectui#9263 was re-ruled letter E — "⛔ not a defect"
 * — and re-attributed the account to this undeclared channel.
 *
 * A comment cannot fail. This file can, and the assertions below are written so
 * that the failure NAMES the channel instead of looking like a component bug.
 *
 * ## ⭐ `app` is ONE TOKEN carrying TWO VOCABULARIES (objectui#9642 scope note)
 *
 * `AppComponentSchema` (`@object-ui/types`) declares the type literal `'app'`
 * for the APP-LEVEL DOCUMENT (`app.json`: tabs, navigation, areas), which the
 * runner / layout path reads STRUCTURALLY — it is never resolved through
 * `ComponentRegistry`, and `@object-ui/types`' `SchemaRegistry` map has no
 * `'app'` key.
 *
 * The spec page kind `app` is a different vocabulary: a stored PAGE document
 * with regions, served by `PageRenderer` through `PageView`'s passthrough, and
 * the registry key `'app'` answers for THAT one alone.
 *
 * ⇒ Two vocabularies sharing one token. Neither is a duplicate of the other and
 * ⛔ neither may be removed as a collision with the other. The `registryAppKeyServesThePageKind`
 * case below is the mechanical half of this paragraph.
 *
 * ## What this file deliberately does NOT do
 *
 * It does ⛔ not change the render path. Making page kinds stop riding the node
 * discriminator (`PageView` mapping every kind to `type: 'page'` plus
 * `pageType`) moves every stored document's render path; that option was in
 * front of the maintainer on objectui#9263 and is ⛔ not this card's to pick.
 * ⛔ No registration is added, removed or renamed here, and the upstream enum is
 * read, never edited.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { PageTypeSchema } from '@objectstack/spec/ui';
// Module scope, not a hook: a cold `await import()` inside a hook is billed to
// `hookTimeout` and races the assertions (AGENTS.md §测试纪律, objectui#3010).
// This import is what puts the page registrations into `ComponentRegistry`.
import '../renderers';
import { PageRenderer } from '../renderers/layout/page';

/**
 * The page kinds whose documents reach `ComponentRegistry` at all.
 *
 * ⚠️ NOT every member of `PageTypeSchema` does. An INTERFACE-MODE kind is
 * short-circuited before the renderer: `PageView` branches on
 * `interfaceConfig?.source` and renders `InterfaceListPage` directly, "rendered
 * directly, not via regions" in its own words, so `SchemaRenderer` is never
 * reached and the kind needs no registry key. Today `list` is the only such
 * kind — every stored `list` page carries `interfaceConfig.source`, which is
 * ADR-0047 interface mode.
 *
 * ⇒ A kind listed here must resolve to `PageRenderer`; a kind listed below in
 * `INTERFACE_MODE_KINDS` must NOT. The union of the two must be exactly
 * `PageTypeSchema.options`, and the case that checks that is what goes red when
 * the upstream enum grows a kind nothing serves.
 */
const INTERFACE_MODE_KINDS = ['list'] as const;

/**
 * ⚠️ `'page'` is NOT a member of `PageTypeSchema` — the spec refuses it.
 *
 * It is the FALLBACK half of the same two-line mapping: `PageView` writes
 * `type: (page as any).type || 'page'`, so a stored document with no `type` at
 * all still resolves. It is also the key `PageNodeSchema` pins (`z.literal('page')`)
 * and the only page key `@object-ui/types`' `SchemaRegistry` map declares.
 */
const FALLBACK_NODE_TYPE = 'page';

function pageKinds(): string[] {
  // `PageTypeSchema` is a lazy schema; `.options` is the enum's member list.
  return [...(PageTypeSchema as unknown as { options: readonly string[] }).options];
}

describe('objectui#9642 — page kind ↔ node type channel', () => {
  it('every region-composed page kind resolves to PageRenderer', () => {
    const served = pageKinds().filter(
      (kind) => !(INTERFACE_MODE_KINDS as readonly string[]).includes(kind),
    );

    // Firing control: the set under test is non-empty, so a green below is a
    // reading and not an empty loop.
    expect(served.length).toBeGreaterThan(0);

    for (const kind of served) {
      expect(
        ComponentRegistry.get(kind),
        `page kind '${kind}' is a member of @objectstack/spec PageTypeSchema and PageView writes it ` +
          `verbatim into the SchemaNode discriminator, so ComponentRegistry must answer it with ` +
          `PageRenderer. It does not. Either the registration was removed — every stored '${kind}' ` +
          `page then renders OBJUI-001 instead of the page (objectui#9263) — or the upstream enum ` +
          `grew a kind nothing serves. ⛔ Do not close this by deleting the kind from the fixture.`,
      ).toBe(PageRenderer);
    }
  });

  it('interface-mode page kinds are NOT served by PageRenderer', () => {
    for (const kind of INTERFACE_MODE_KINDS) {
      // Firing control on this instrument: the key IS registered, to some other
      // renderer. Without this line an unregistered key would read `undefined`
      // and satisfy `.not.toBe(PageRenderer)` — absence scoring as a reading.
      expect(
        ComponentRegistry.get(kind),
        `node type '${kind}' is expected to be registered to a NON-page renderer; reading undefined ` +
          `means this probe measured nothing, ⛔ not that the kind is unserved.`,
      ).toBeDefined();

      expect(
        ComponentRegistry.get(kind),
        `page kind '${kind}' is interface mode: PageView branches on interfaceConfig.source and ` +
          `renders InterfaceListPage directly, so this kind never reaches the registry as a page. ` +
          `Something now answers '${kind}' with PageRenderer — the channel's shape changed and the ` +
          `declaration in this file's header has to be re-derived before this is made green.`,
      ).not.toBe(PageRenderer);
    }
  });

  it('the registry key set over page kinds is exactly the enum, split two ways', () => {
    const kinds = pageKinds();
    const servedByRenderer = kinds.filter((kind) => ComponentRegistry.get(kind) === PageRenderer);
    const interfaceMode = kinds.filter((kind) =>
      (INTERFACE_MODE_KINDS as readonly string[]).includes(kind),
    );

    expect(
      [...servedByRenderer, ...interfaceMode].sort(),
      `every member of PageTypeSchema must be accounted for exactly once: served by PageRenderer, ` +
        `or short-circuited by PageView's interface-mode branch. A kind in neither column is a ` +
        `false affordance — it validates at authoring time and breaks at runtime, which the ` +
        `PageTypeSchema docblock calls "especially dangerous when templates are AI-authored".`,
    ).toEqual([...kinds].sort());
  });

  it('the page-kind registrations are absent from the published ComponentType union, deliberately', async () => {
    // `keyof SchemaRegistry` IS the published `ComponentType` union, and that
    // map's own docblock makes its key set "the Single Source of Truth for
    // component type lookups". The page KINDS are deliberately not keys there:
    // adding one would widen `ComponentType`, which is a ruling and not a
    // by-product of this declaration (objectui#9642 Clause-②: no).
    //
    // ⇒ This case pins the ASYMMETRY that mis-framed objectui#9263 and
    // objectui#9576, so that a future reader meets it as a checked fact instead
    // of re-deriving "registered but never declared" from the gap.
    const kinds = pageKinds();
    const servedByRenderer = kinds.filter((kind) => ComponentRegistry.get(kind) === PageRenderer);

    expect(servedByRenderer.length).toBeGreaterThan(0);

    expect(
      ComponentRegistry.get(FALLBACK_NODE_TYPE),
      `'${FALLBACK_NODE_TYPE}' is the untyped-document fallback PageView writes and the only page ` +
        `key the SchemaRegistry map declares; it must keep resolving to PageRenderer.`,
    ).toBe(PageRenderer);

    expect(
      kinds.includes(FALLBACK_NODE_TYPE),
      `'${FALLBACK_NODE_TYPE}' must NOT be a member of PageTypeSchema — the spec refuses it, and a ` +
        `page kind by that name would collide with the fallback this channel depends on.`,
    ).toBe(false);
  });

  it('registryAppKeyServesThePageKind — one token, two vocabularies', () => {
    // The scope note on objectui#9642, mechanised. `AppComponentSchema`'s `app`
    // is the app-level document, read structurally by the runner / layout path
    // and never resolved through this registry; the registry key `'app'` answers
    // only for the spec PAGE KIND `app`, through PageView's passthrough.
    expect(
      PageTypeSchema.safeParse('app').success,
      `'app' must stay a member of PageTypeSchema — the registry key below exists to serve it.`,
    ).toBe(true);

    expect(
      ComponentRegistry.get('app'),
      `the registry key 'app' answers for the spec PAGE KIND 'app' (a stored page document with ` +
        `regions, served by PageRenderer through PageView's passthrough), ⛔ NOT for ` +
        `AppComponentSchema's 'app' (the app-level document, read structurally by the runner and ` +
        `layout path). Two vocabularies share this one token; ⛔ neither is a collision to be ` +
        `resolved by removing the other — that reading produced objectui#9263 and objectui#9576.`,
    ).toBe(PageRenderer);

    // Firing control on the same instrument: an ordinary component key resolves
    // to something OTHER than PageRenderer, so `.toBe(PageRenderer)` above is a
    // discriminating read and not a tautology over a registry that answers
    // PageRenderer for everything.
    expect(ComponentRegistry.get('grid')).toBeDefined();
    expect(ComponentRegistry.get('grid')).not.toBe(PageRenderer);

    // Absent-token control: an unregistered key reads undefined, so a zero from
    // this instrument means absence rather than a broken probe.
    expect(ComponentRegistry.get('zzz-not-a-registered-node-type')).toBeUndefined();
  });
});
