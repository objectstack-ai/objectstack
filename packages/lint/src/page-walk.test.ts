// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { walkPageComponents, isSourceAuthoredPage } from './page-walk.js';

const paths = (page: Record<string, unknown>) =>
  walkPageComponents(page, 'pages[0]').map((w) => w.path);

describe('walkPageComponents — where components actually live', () => {
  it('walks regions[].components[]', () => {
    expect(
      paths({
        regions: [
          { name: 'main', components: [{ type: 'a' }, { type: 'b' }] },
          { name: 'side', components: [{ type: 'c' }] },
        ],
      }),
    ).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[1]',
      'pages[0].regions[1].components[0]',
    ]);
  });

  it('walks slots, normalizing a single component to a list', () => {
    expect(
      paths({
        kind: 'slotted',
        slots: {
          highlights: { type: 'a' },
          tabs: [{ type: 'b' }, { type: 'c' }],
        },
      }),
    ).toEqual([
      'pages[0].slots.highlights',
      'pages[0].slots.tabs[0]',
      'pages[0].slots.tabs[1]',
    ]);
  });

  it('finds nothing in a top-level `components` array — PageSchema has none', () => {
    // Guards the bug this module exists to prevent: a walker reading
    // `page.components` visits nothing on a real stack while looking correct.
    expect(paths({ components: [{ type: 'a' }] })).toEqual([]);
  });

  it('recurses through properties.children — the layout-container shape', () => {
    expect(
      paths({
        regions: [
          {
            name: 'main',
            components: [
              {
                type: 'flex',
                properties: {
                  children: [
                    { type: 'flex', properties: { children: [{ type: 'leaf' }] } },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[0].properties.children[0]',
      'pages[0].regions[0].components[0].properties.children[0].properties.children[0]',
    ]);
  });

  it('recurses through properties.items[].children, body and footer', () => {
    expect(
      paths({
        regions: [
          {
            name: 'main',
            components: [
              { type: 'page:tabs', properties: { items: [{ children: [{ type: 'x' }] }] } },
              { type: 'page:card', properties: { body: [{ type: 'y' }], footer: [{ type: 'z' }] } },
            ],
          },
        ],
      }),
    ).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[0].properties.items[0].children[0]',
      'pages[0].regions[0].components[1]',
      'pages[0].regions[0].components[1].properties.body[0]',
      'pages[0].regions[0].components[1].properties.footer[0]',
    ]);
  });
});

describe('walkPageComponents — object binding precedence', () => {
  const bindings = (page: Record<string, unknown>) =>
    walkPageComponents(page, 'pages[0]').map((w) => w.objectName);

  it('inherits the page object, and lets dataSource then properties override', () => {
    expect(
      bindings({
        object: 'page_obj',
        regions: [
          {
            name: 'main',
            components: [
              { type: 'a' },
              { type: 'b', dataSource: { object: 'ds_obj' } },
              { type: 'c', properties: { object: 'prop_obj' } },
              // dataSource wins over properties.
              { type: 'd', dataSource: { object: 'ds_obj' }, properties: { object: 'prop_obj' } },
            ],
          },
        ],
      }),
    ).toEqual(['page_obj', 'ds_obj', 'prop_obj', 'ds_obj']);
  });

  it('propagates an overridden binding down to nested children', () => {
    const walked = walkPageComponents(
      {
        object: 'page_obj',
        regions: [
          {
            name: 'main',
            components: [
              {
                type: 'flex',
                dataSource: { object: 'ds_obj' },
                properties: { children: [{ type: 'leaf' }] },
              },
            ],
          },
        ],
      },
      'pages[0]',
    );
    expect(walked.map((w) => w.objectName)).toEqual(['ds_obj', 'ds_obj']);
  });
});

describe('isSourceAuthoredPage', () => {
  it('treats html/react/jsx as source-authored and skips their regions', () => {
    for (const kind of ['html', 'react', 'jsx']) {
      expect(isSourceAuthoredPage({ kind })).toBe(true);
      expect(
        paths({ kind, regions: [{ name: 'main', components: [{ type: 'a' }] }] }),
      ).toEqual([]);
    }
  });

  it('treats full/slotted (and an absent kind) as authored metadata', () => {
    expect(isSourceAuthoredPage({ kind: 'full' })).toBe(false);
    expect(isSourceAuthoredPage({ kind: 'slotted' })).toBe(false);
    expect(isSourceAuthoredPage({})).toBe(false);
  });
});
