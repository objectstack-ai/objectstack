/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8348 — `object-map` is judged against ITS OWN protocol row.
 *
 * Decision batch #83, maintainer verbatim 「8348 以协议为准」: a renderer honours
 * the `data` spelling its block's PUBLISHED row declares. When that ruling
 * landed (objectui#9234) `@objectstack/spec` published no
 * `ComponentPropsMap['object-map']` row, so this block was judged through this
 * repo's own `ObjectMapSchema.data` as an interim. Ruling batch #136 item 3
 * (Q1-C) had the protocol gain the row, and "after it lands, this card's
 * remaining slice judges the three blocks against their protocol rows" — this
 * file is that judgement for the map.
 *
 * ⛔ The arm is DERIVED from the installed row at test time, never restated as
 * a constant, so a spec release that moves the row turns this red (AGENTS.md
 * #9). What the arm then does to rendering — the bare array refused, the
 * declared object form drawn, the host prop untouched — is pinned in
 * `ObjectMap.schemaDataShorthand.test.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { ComponentRegistry, recordSourceDataArmForType } from '@object-ui/core';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// Registers `object-map` through this package's own entry.
import './index';

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => <div aria-label="Map">{props.children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => null,
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

type DerivedArm = 'view-data' | 'array' | 'no data row' | 'no row' | 'both arms' | 'neither arm';

/**
 * The arm a `ComponentPropsMap` row's `data` member declares — READ from the
 * installed row by parsing one value of each arm, ⛔ never restated. Read
 * through `Record<string, any>` for the reason
 * `ObjectTree.schemaTyped-8655.test.ts` (plugin-tree) gives: `_def` is a zod
 * internal the spec publishes no type for.
 */
function armDeclaredByRow(type: string): DerivedArm {
  const entry = (ComponentPropsMap as unknown as Record<string, any>)[type];
  if (!entry?._def) return 'no row';
  const def = entry._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  const data = shape?.data;
  if (!data) return 'no data row';
  const takesObject = data.safeParse({ provider: 'value', items: [] }).success;
  const takesArray = data.safeParse([]).success;
  if (takesObject && takesArray) return 'both arms';
  if (takesObject) return 'view-data';
  if (takesArray) return 'array';
  return 'neither arm';
}

describe('object-map is judged against its installed protocol row (objectui#8348)', () => {
  it('every KEY this plugin registers onto the map renderer answers the arm the INSTALLED row declares', () => {
    const siblings = ComponentRegistry.getAllTypes().filter(
      (type) => ComponentRegistry.get(type) === ComponentRegistry.get('object-map'),
    );
    const declared = armDeclaredByRow('object-map');

    expect([...siblings].sort()).toEqual(['object-map', 'plugin-map:object-map']);
    expect(declared).toBe('view-data');
    for (const type of siblings) {
      expect([type, recordSourceDataArmForType(type)]).toEqual([type, declared]);
    }
  });

  it('⛔ CONTROL: the row reader discriminates — the array-arm row and an absent row read differently', () => {
    // Without these, a reader that answered `view-data` for everything would
    // make the row above a restatement instead of a measurement.
    expect(armDeclaredByRow('object-calendar')).toBe('array');
    expect(armDeclaredByRow('BOGUS_CONTROL_BLOCK')).toBe('no row');
  });
});
