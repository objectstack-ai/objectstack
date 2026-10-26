/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The seven semantic sectioning tags and `aspect-ratio` declare the containment
 * they render (objectui#6764) — and the two CONTROLS that keep this a census
 * rather than a sweep.
 *
 * ## Why this file exists at all
 *
 * The same defect has now been found three times, one registration at a time:
 * objectui#3900 (`page-header`, closed), objectui#6740 (`flex`, PR #6762), and
 * this card. Each was filed as a one-off because nothing in the tree asks "does
 * this registration render a child list while declaring it takes none?".
 *
 * The reasoning that makes the declaration correct is objectui#3900's, written
 * out at `packages/layout/src/index.ts`: `children` is a BASE property of every
 * node in the JSON protocol (`BASE_PROPS` in `sdui-parser/src/validate.ts`), not
 * a per-component authoring key, so `isContainer` answers the protocol question
 * "does this node accept a child list?" and widens no spec surface. Omitting it
 * never made children illegal — nothing on the render path reads the flag — it
 * made `validateTree` LIE, and a warning that lies is worse than a missing one
 * because it trains authors (AI authors especially) to discount the TRUE
 * `not-a-container` reports on components that really are childless.
 *
 * ## MEASURED on b98352a15, over the live registry, not over the source
 *
 * Every registered key was rendered through the real `SchemaRenderer` with one
 * `text` child and put through `validateTree`. Of 131 bare authoring tags:
 *
 *   - 58 render `schema.children` (the child text reached the DOM);
 *   - 5 of those declared the flag — `flex`, `grid`, `card`, `container`,
 *     `stack`, exactly the control set objectui#6764 named, which is what makes
 *     the rest a reading rather than a broken scan;
 *   - 53 did not, and every one drew `not-a-container` on a child list it then
 *     rendered;
 *   - 73 render no children and correctly keep the diagnostic;
 *   - 0 failed to render, so nothing was scored on an exception.
 *
 * This file pins the 8 that this change declares. The other 45 are reported on
 * the card: they are NOT swept in here, because the three exception populations
 * below prove the predicate has real exceptions -- `tabs` (renders
 * `items[].content`), the void tags out of the same loop factory as 34 that do
 * render children, and the former `schema.body` readers, which objectui#6771
 * converged on `children` and objectui#6804's ruling keeps undeclared.
 *
 * ## Re-pointed by objectui#9910 (2026-09-24)
 *
 * The containment DECLARATION is no longer `isContainer`: it is the input
 * `{ name: 'children', type: 'slot' }`, and `validateTree` reads only that
 * (`acceptsChildren`). The eight still carry the flag -- they ARE layout
 * containers, which is what the flag now means (objectui#6804, Q2-A) -- and
 * they now also declare the slot, which is what keeps the assertions below
 * true. The `badge` / `alert` block flipped with the ruling: both declare the
 * slot, keep the flag off, and draw nothing.
 */

import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx } from '@object-ui/react';
import { CHILD_LIST_KEY, manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window).
import '../index';

const CONTAINMENT = 'not-a-container';
const MARK = 'census-child';

/** The eight registrations this change declares. */
const DECLARED_HERE = [
  // renderers/layout/semantic.tsx — one factory, seven tags
  'aside',
  'main',
  'header',
  'nav',
  'footer',
  'section',
  'article',
  // renderers/layout/aspect-ratio.tsx
  'aspect-ratio',
] as const;

/**
 * The manifest the running app validates against, built the way the app builds
 * it — keyed by every KNOWN registry tag rather than by `getAllConfigs()`, whose
 * `.type` is always the namespaced form. Mirrors `getJsxManifest()` in
 * `renderers/layout/page.tsx`. Key it off `getAllConfigs()` instead and the bare
 * tag an author writes is absent from the manifest, so every assertion below
 * would pass on `unknown-component` without reaching the containment check.
 */
const diagnose = (schema: unknown): Diagnostic[] => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  const manifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
  return validateTree(schema as SchemaElement, manifest).diagnostics;
};

const withChildren = (type: string) => ({ type, children: [{ type: 'text', content: MARK }] });

/** Does this registration put an authored child list on the page? */
const rendersChildren = async (type: string): Promise<boolean> => {
  const { container, unmount } = render(
    <AdapterCtx.Provider value={null as never}>
      <SchemaRenderer schema={withChildren(type) as never} />
    </AdapterCtx.Provider>,
  );
  try {
    await waitFor(() => expect(container.textContent).toBeDefined());
    return (container.textContent || '').includes(MARK);
  } finally {
    unmount();
  }
};

describe('the sectioning tags declare the containment they render (objectui#6764)', () => {
  it.each(DECLARED_HERE)('`%s` renders an authored child list', async (type) => {
    // The half that makes the declaration HONEST, and it comes first: the flag
    // is only correct because the renderer really does put the child on the
    // page. Asserted through the real render path rather than by reading the
    // source, because the source read is what the three previous rediscoveries
    // each did by hand.
    expect(await rendersChildren(type)).toBe(true);
  });

  it.each(DECLARED_HERE)('`%s` declares the `children` slot the tier reads (objectui#9910)', (type) => {
    // The declaration that now carries the fact the render above proves. The
    // flag stays too, as the layout fact it is; asserting the slot by name is
    // what keeps the diagnostic assertion below from passing on a fallback.
    const inputs = ComponentRegistry.getMeta(type)?.inputs ?? [];
    expect(inputs.find((i) => i.name === CHILD_LIST_KEY)?.type).toBe('slot');
    expect(ComponentRegistry.getMeta(type)?.isContainer).toBe(true);
  });

  it.each(DECLARED_HERE)('`%s` with children draws no `not-a-container`', (type) => {
    const diagnostics = diagnose(withChildren(type));

    // Reachability BEFORE absence — an empty result proves nothing if the
    // containment branch never ran. Two ways it silently would not: an
    // unresolved tag reports `unknown-component` and never reaches the check,
    // and the branch is guarded by `node.children?.length`.
    expect(diagnostics.filter((d) => d.code === 'unknown-component')).toEqual([]);
    expect(withChildren(type).children.length).toBeGreaterThan(0);

    // Filtered by code, not against an empty list: this file owns the
    // CONTAINMENT fact only, so a future diagnostic on some other key belongs to
    // that key's pin rather than here.
    expect(diagnostics.filter((d) => d.code === CONTAINMENT)).toEqual([]);
  });
});

describe('the declaration is confined to what was measured (objectui#6764)', () => {
  it('leaves `tabs` alone — it renders `items[].content`, not `schema.children`', async () => {
    // THE non-case objectui#6764 named, and the reason this card was not a mass
    // edit. `tabs` also lacks the flag, but it renders `item.content` off an
    // `items` array: a child list authored under `children` is genuinely
    // unrendered, so `not-a-container` on it is TRUE and must survive.
    //
    // It is also `PUBLIC` (`PUBLIC_BLOCKS`), so sweeping it in would have
    // deleted `<Tabs>` from the JSX scope of every `kind:'react'` page as well.
    expect(await rendersChildren('tabs')).toBe(false);
    expect(diagnose(withChildren('tabs')).map((d) => d.code)).toContain(CONTAINMENT);
  });

  it.each(['img', 'hr', 'br'])('leaves the void tag `%s` alone', async (type) => {
    // The second half of the same control, inside a LOOP FACTORY. `img`/`hr`/
    // `br` come out of the same `basic/html-elements.tsx` loop as 35 tags that
    // DO render children, and the factory skips `renderChildren` for them by
    // design (`VOID_TAGS`). A census that worked at file granularity — the
    // granularity a static reader can reach — would have declared all 38
    // together and told authors that `<br>` accepts children.
    expect(await rendersChildren(type)).toBe(false);
    expect(diagnose(withChildren(type)).map((d) => d.code)).toContain(CONTAINMENT);
  });

  it('`badge` and `alert` declare the slot with the flag OFF — objectui#6804 held, objectui#9910 paid', async () => {
    // These two used to render `renderChildren(schema.body)` and never touch
    // `schema.children`; objectui#6771 converged them onto `children`, and the
    // flag-keyed containment branch then fired on the only key they read.
    // objectui#6804 forbids the flag for them — it means LAYOUT containment,
    // and declaring it would delete `Badge` / `Alert` from every react page's
    // JSX scope (both are PUBLIC) — so for a while this pin recorded a FALSE
    // warning as a refusal.
    //
    // objectui#9910 dissolved the conflation: the slot input declares the
    // child read, the flag declares layout, and the tier reads the slot. So
    // both now render children, declare the slot, keep the flag off, and draw
    // nothing — with `Badge` and `Alert` still injected into react pages.
    for (const type of ['badge', 'alert']) {
      expect(await rendersChildren(type), `\`${type}\` lost its \`children\` read`).toBe(true);
      const inputs = ComponentRegistry.getMeta(type)?.inputs ?? [];
      expect(inputs.find((i) => i.name === CHILD_LIST_KEY)?.type, `\`${type}\` declares no slot`).toBe('slot');
      expect(ComponentRegistry.getMeta(type)?.isContainer, `\`${type}\` declared the layout flag — that overrides objectui#6804`).toBeFalsy();
      expect(diagnose(withChildren(type)).filter((d) => d.code === CONTAINMENT)).toEqual([]);
    }
  });
});

describe('the premise that made this change safe on the SECOND consumer (objectui#6764)', () => {
  it('none of the eight is in the curated public contract', () => {
    // `renderers/layout/react-page.tsx` builds the JSX scope of every
    // `kind:'react'` page with `if (!tag || cfg.isContainer || cfg.tier === 'html') continue;`,
    // so each declaration also REMOVES that tag as an injected identifier — the
    // consequence objectui#6764 recorded as unmeasured. It reads
    // `getPublicConfigs()`, not the whole registry, and none of these eight is
    // in it: there is no `<Aside>` / `<Main>` / `<AspectRatio>` wrapper for the
    // flag to delete. That is why this subset was safe and `button` — the one
    // member of the same census population that IS public — was left alone.
    //
    // Pinned rather than left as a comment so that promoting one of these into
    // `PUBLIC_BLOCKS` re-opens the question HERE, instead of silently dropping a
    // tag from every react page.
    //
    // objectui#10735 re-opened it, deliberately, and answered it: the seven
    // sectioning tags now ride `getPublicConfigs()` — the published manifest
    // must whitelist them for `kind:'html'` pages — but as HTML-TIER entries,
    // stamped `tier: 'html'`, never as curated blocks. `react-page.tsx` skips
    // them on that stamp as well as on the container flag, so the premise this
    // pin guards ("no injected wrapper exists for the flag to delete") holds,
    // and the CURATED contract is read here as the unstamped entries.
    const contract = ComponentRegistry.getPublicConfigs() as Array<{ type: string; tier?: string }>;
    const curatedTags = new Set(contract.filter((c) => c.tier !== 'html').map((c) => c.type));
    const htmlTierTags = new Set(contract.filter((c) => c.tier === 'html').map((c) => c.type));

    // Direction control first. Without it, "none of the eight is public" is
    // indistinguishable from "the public tier is empty / this reader broke",
    // and the assertion below would be green for nothing.
    expect(curatedTags.size).toBeGreaterThan(0);
    expect(curatedTags.has('flex')).toBe(true);
    expect(curatedTags.has('button')).toBe(true);

    expect(DECLARED_HERE.filter((t) => curatedTags.has(t))).toEqual([]);

    // The seven sectioning tags are declared for the html tier and nowhere
    // else; `aspect-ratio` is on neither roster (refused on stated merits,
    // objectui#8628).
    expect(DECLARED_HERE.filter((t) => htmlTierTags.has(t)).sort()).toEqual(
      ['article', 'aside', 'footer', 'header', 'main', 'nav', 'section'],
    );
    expect(htmlTierTags.has('aspect-ratio')).toBe(false);
  });
});
