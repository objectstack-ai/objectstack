// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform's page-component walkers must reach the same components
 * (#6775, #20940).
 *
 * There are three and there has to be: `walkPageComponents` (here) yields
 * nodes for the lint rules to judge, `mapPageComponents` (`@objectstack/spec`'s
 * conversion layer) rewrites them copy-on-write, and the exported
 * `walkAddressedPageComponents` (`@objectstack/spec/system`) hands them to
 * `translatePage`, the CLI extractor and objectui's validator. What must NOT
 * differ is which components each one arrives at:
 *
 *   - a conversion that reaches less than the rule judging its result
 *     normalizes part of a corpus and leaves the rest looking converted —
 *     what #6775 measured: `page-header-subtitle-alias` rewrote a header in a
 *     region and skipped the identical header in a slot or inside a card;
 *   - an exported walk that reaches less than lint leaves a node judged by
 *     `os lint` and by nobody downstream — what #20940 measured: a card's
 *     `footer` was walked here and skipped by every consumer of the exported
 *     walk, because each walk kept its own list of positions.
 *
 * All three now read ONE list, spec's `pageComponentSlotPositions()`, derived
 * from the component rows. This file is the only place that can see all
 * three, since `@objectstack/lint` depends on `@objectstack/spec` and not the
 * other way round. The parity is asserted BEHAVIOURALLY — which probes each
 * walk reaches on one fixture page — rather than by comparing implementations,
 * so it keeps holding if any walk is rewritten.
 *
 * Two differences are deliberate and pinned below, and both make the
 * conversion walker reach MORE:
 *
 *   - a RETIRED slot spelling (`page:card.body`, tombstoned by #5775) is
 *     descended by the conversion walker and by neither authoring walk — the
 *     renderers still read it for stored documents, which are the conversion
 *     walker's population, and it is not an authorable spelling;
 *   - source-authored pages (`kind: 'html' | 'react' | 'jsx'`) are skipped
 *     here and visited there. Lint skips them so it does not report findings
 *     about a DERIVED region cache the author never wrote; a conversion still
 *     has to normalize that cache, or a stored page rehydrates in a shape the
 *     runtime no longer serves.
 */

import { applyConversions } from '@objectstack/spec';
import { walkAddressedPageComponents } from '@objectstack/spec/system';
import { pageComponentSlotPositions } from '@objectstack/spec/ui';
import { describe, expect, it } from 'vitest';

import { walkPageComponents } from './page-walk.js';

/**
 * A page-header authored with the retired `description` spelling — the probe.
 * `page-header-subtitle-alias` rewrites it to `subtitle` and emits a notice
 * whose path names the site, so "did the conversion reach here?" is answerable
 * for any position without exporting the walker itself.
 */
const probe = (title: string) => ({ type: 'page:header', properties: { title, description: 'Second line' } });

/**
 * Every authoring position in one page: both region slots, a single-component
 * slot and an array slot, and each container a component nests a sub-tree in
 * (`children`, `items[].children`, `footer` — and the retired `body`),
 * including two levels of nesting. Every probe's title is unique, so a title
 * names the position it sits at.
 */
const page = {
  name: 'parity',
  kind: 'slotted',
  object: 'account',
  regions: [
    {
      name: 'main',
      components: [
        probe('region'),
        { type: 'page:section', properties: { children: [probe('children')] } },
        {
          type: 'page:tabs',
          properties: { tabStyle: 'line', items: [{ label: 'T', children: [probe('tab panel')] }] },
        },
        {
          type: 'page:card',
          properties: {
            body: [probe('card body')],
            footer: [probe('card footer'), { type: 'page:section', properties: { children: [probe('two deep')] } }],
          },
        },
      ],
    },
  ],
  slots: {
    header: probe('single slot'),
    details: [probe('array slot 0'), probe('array slot 1')],
  },
};

/** The positions the lint walk yields that carry the probe. */
const walkedProbePaths = () =>
  walkPageComponents(page as unknown as Record<string, unknown>, 'pages[0]')
    .filter((w) => w.component.type === 'page:header')
    .map((w) => w.path);

/**
 * The positions the conversion layer actually rewrote the probe at.
 *
 * Filtered to this one entry: the fixture page also carries a `page:card` with
 * a `body`, which `page-card-body-to-children` rewrites — a real notice about a
 * different key, and not a position the probe sits at.
 */
const convertedProbePaths = () => {
  const paths: string[] = [];
  applyConversions(
    { pages: [structuredClone(page)] },
    {
      includeRetired: true,
      onNotice: (n) => { if (n.conversionId === 'page-header-subtitle-alias') paths.push(n.path); },
    },
  );
  // The notice names the rewritten KEY; the component is its parent.
  return paths.map((p) => p.replace(/\.properties\.subtitle$/, ''));
};

/** The probe a `pages[0]…` path names on the fixture page — its title. */
const probeTitleAt = (path: string): string => {
  const steps = path.replace(/^pages\[0\]\.?/, '').replace(/\]/g, '').split(/[.[]/).filter(Boolean);
  const node = steps.reduce<any>((at, step) => at?.[/^\d+$/.test(step) ? Number(step) : step], page);
  return node?.properties?.title;
};

/** The probes each of the three walks reaches, by title. */
const reachedBy = () => ({
  lint: new Set(walkedProbePaths().map(probeTitleAt)),
  conversion: new Set(convertedProbePaths().map(probeTitleAt)),
  exportedWalk: (() => {
    const titles = new Set<string>();
    walkAddressedPageComponents(structuredClone(page) as Parameters<typeof walkAddressedPageComponents>[0], (component) => {
      if (component.type === 'page:header') titles.add(component.properties?.title as string);
      return component;
    });
    return titles;
  })(),
});

describe('#6775 — walkPageComponents and the conversion walk reach the same components', () => {
  it('the probe sits at every position the lint walk knows about', () => {
    // Guards the fixture itself: if a container shape is added to the lint walk
    // and not to this page, the parity assertion below would pass vacuously.
    expect(walkedProbePaths()).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[1].properties.children[0]',
      'pages[0].regions[0].components[2].properties.items[0].children[0]',
      'pages[0].regions[0].components[3].properties.footer[0]',
      'pages[0].regions[0].components[3].properties.footer[1].properties.children[0]',
      'pages[0].slots.header',
      'pages[0].slots.details[0]',
      'pages[0].slots.details[1]',
    ]);
  });

  it('a conversion rewrites the probe at every one of them, spelling the same paths — and at the retired `body` besides', () => {
    // Order-insensitive: the walks are free to visit in different orders, but
    // the conversion walker may not miss a component lint judges. What it
    // reaches BEYOND lint is exactly the retired spelling's probe.
    const walked = new Set(walkedProbePaths());
    const converted = new Set(convertedProbePaths());
    expect([...walked].filter((p) => !converted.has(p))).toEqual([]);
    expect([...converted].filter((p) => !walked.has(p))).toEqual([
      'pages[0].regions[0].components[3].properties.body[0]',
    ]);
  });

  it('source-authored pages are the one deliberate difference', () => {
    // Lint yields nothing for them (the regions are a derived cache, not
    // authored metadata); the conversion still normalizes that cache.
    const jsxPage = { name: 'j', kind: 'jsx', source: '<div/>', regions: [{ name: 'main', components: [probe('cached')] }] };
    expect(walkPageComponents(jsxPage as unknown as Record<string, unknown>, 'pages[0]')).toEqual([]);

    const notices: string[] = [];
    applyConversions(
      { pages: [structuredClone(jsxPage)] },
      {
        includeRetired: true,
        // `kind: 'jsx'` itself converts (`page-kind-jsx-to-html`, protocol 11);
        // what this pins is the component inside the derived cache.
        onNotice: (n) => { if (n.conversionId === 'page-header-subtitle-alias') notices.push(n.path); },
      },
    );
    expect(notices).toEqual(['pages[0].regions[0].components[0].properties.subtitle']);
  });
});

describe('#20940 — the three page walks read one slot list and reach the same positions', () => {
  it('lint, the exported walk and the conversion walker reach the same probes on one page — the retired spelling aside', () => {
    const { lint, exportedWalk, conversion } = reachedBy();
    // Guards the fixture: a walk reaching nothing would agree with another
    // reaching nothing.
    expect([...lint].sort()).toEqual([
      'array slot 0', 'array slot 1', 'card footer', 'children', 'region', 'single slot', 'tab panel', 'two deep',
    ]);
    // The two authoring walks: identical, `card footer` and `two deep`
    // (under the footer) included — the pair #20940 found apart.
    expect([...exportedWalk].sort()).toEqual([...lint].sort());
    // The conversion walker: the same, plus exactly the probe under a
    // position the list marks retired.
    expect([...conversion].filter((title) => !lint.has(title))).toEqual(['card body']);
    expect([...lint].filter((title) => !conversion.has(title))).toEqual([]);
  });

  it('the difference IS the list\'s retired entries — no walk keeps a position of its own', () => {
    const positions = pageComponentSlotPositions();
    expect(positions.filter((p) => p.retired).map((p) => p.key)).toEqual(['body']);
    // Every authorable position has a probe on the fixture page, so the
    // equality above covers the whole list, not a sample of it.
    const authorable = positions.filter((p) => !p.retired)
      .map(({ key, panelKey }) => (panelKey === undefined ? key : `${key}[].${panelKey}`));
    expect(authorable).toEqual(['children', 'footer', 'items[].children']);
  });
});
