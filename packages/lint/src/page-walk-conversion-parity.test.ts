// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two page-component walkers must reach the same components (#6775).
 *
 * There are two of them and there has to be: `walkPageComponents` (here) yields
 * nodes for the lint rules to judge, and `mapPageComponents`
 * (`@objectstack/spec`'s conversion layer) rewrites them copy-on-write. What
 * must NOT differ is which components each one arrives at — a conversion that
 * reaches less than the rule judging its result normalizes part of a corpus and
 * leaves the rest looking converted, which is exactly what #6775 measured:
 * `page-header-subtitle-alias` rewrote a header in a region and skipped the
 * identical header in a slot or inside a card, with no diagnostic from any
 * layer (the props bag is unvalidated on the load path, and that key has no
 * tombstone to fall back on).
 *
 * This file is the only place that can see both, since `@objectstack/lint`
 * depends on `@objectstack/spec` and not the other way round. The parity is
 * asserted BEHAVIOURALLY — every position this walk yields is a position a
 * conversion notice names — rather than by comparing implementations, so it
 * keeps holding if either walk is rewritten.
 *
 * One difference is deliberate and pinned below: source-authored pages
 * (`kind: 'html' | 'react' | 'jsx'`) are skipped here and visited there. Lint
 * skips them so it does not report findings about a DERIVED region cache the
 * author never wrote; a conversion still has to normalize that cache, or a
 * stored page rehydrates in a shape the runtime no longer serves.
 */

import { applyConversions } from '@objectstack/spec';
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
 * (`children`, `items[].children`, `body`, `footer`), including two levels of
 * nesting.
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
            footer: [{ type: 'page:section', properties: { children: [probe('two deep')] } }],
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

describe('#6775 — walkPageComponents and the conversion walk reach the same components', () => {
  it('the probe sits at every position the lint walk knows about', () => {
    // Guards the fixture itself: if a container shape is added to the lint walk
    // and not to this page, the parity assertion below would pass vacuously.
    expect(walkedProbePaths()).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[1].properties.children[0]',
      'pages[0].regions[0].components[2].properties.items[0].children[0]',
      'pages[0].regions[0].components[3].properties.body[0]',
      'pages[0].regions[0].components[3].properties.footer[0].properties.children[0]',
      'pages[0].slots.header',
      'pages[0].slots.details[0]',
      'pages[0].slots.details[1]',
    ]);
  });

  it('a conversion rewrites the probe at every one of them, spelling the same paths', () => {
    // Order-insensitive: the two walks are free to visit in different orders,
    // but neither may reach a component the other cannot.
    expect(new Set(convertedProbePaths())).toEqual(new Set(walkedProbePaths()));
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
