/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10287 — every navigation item type the spec declares gets a row
 * the Navigation Designer can draw.
 *
 * `NAV_TYPE_META` is a `Record` keyed by the spec-derived `NavigationItemType`,
 * so the compiler already refuses a missing entry. This pin is the runtime
 * half, and it reads the vocabulary from the INSTALLED `@objectstack/spec`'s
 * `NavigationItemSchema` discriminants rather than from a list written here,
 * so it follows whatever spec it is run against:
 *
 *  - against the pinned release it covers that release's members;
 *  - against a spec built from objectstack `main` (the Spec Main Shape Gate's
 *    injected install) it also covers members the pin does not have yet —
 *    objectstack#19789's `doc` was the one that went unhandled.
 *
 * The map may carry MORE keys than the spec it is run against (`doc` ahead of
 * the pin bump), so this asserts spec ⊆ map, never equality.
 *
 * A missing entry fails as a render error: every row reads `meta.Icon` from
 * the map. An entry whose label key has no English fallback fails the
 * raw-key assertion.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import type { NavigationItem } from '@object-ui/types';
import { NavigationDesigner } from '../NavigationDesigner';

/**
 * Walk `.unwrap()` (the spec wraps its schemas lazily) until the node carries
 * `key`. Bounded, and answers `undefined` rather than looping on a shape it
 * does not recognise.
 */
function unwrapUntil(node: unknown, key: string): Record<string, unknown> | undefined {
  let current = node as Record<string, unknown> | undefined;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (key in current) return current;
    const unwrap = current.unwrap;
    if (typeof unwrap !== 'function') return undefined;
    current = unwrap.call(current) as Record<string, unknown> | undefined;
  }
  return current && key in current ? current : undefined;
}

/** The discriminant values of the spec's nav-item union. Throws when unreadable. */
function specNavItemTypes(): string[] {
  const union = unwrapUntil(NavigationItemSchema, 'options');
  const options = union?.options;
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('could not read NavigationItemSchema options from @objectstack/spec');
  }
  return options.flatMap((option, index) => {
    const shape = unwrapUntil(option, 'shape')?.shape as Record<string, unknown> | undefined;
    const literal = shape?.type as { values?: unknown } | undefined;
    if (!(literal?.values instanceof Set) || literal.values.size === 0) {
      throw new Error(`could not read the \`type\` literal of NavigationItemSchema option ${index}`);
    }
    return [...literal.values].map(String);
  });
}

const SPEC_NAV_ITEM_TYPES = specNavItemTypes();

describe('NavigationDesigner — a row for every spec navigation item type (#10287)', () => {
  it('reads a non-empty vocabulary from the installed spec', () => {
    // Non-vacuity: an empty or mis-read list would make every case below pass.
    expect(SPEC_NAV_ITEM_TYPES).toContain('object');
    expect(SPEC_NAV_ITEM_TYPES).toContain('group');
    expect(new Set(SPEC_NAV_ITEM_TYPES).size).toBe(SPEC_NAV_ITEM_TYPES.length);
  });

  it.each(SPEC_NAV_ITEM_TYPES)('draws the `%s` type in the tree and the live preview', (type) => {
    // Cast at the fixture boundary only: the type comes from the installed
    // spec at runtime, which can name a member the pinned types do not have.
    const item = { id: `probe_${type}`, type, label: 'Probe item' } as unknown as NavigationItem;

    render(<NavigationDesigner items={[item]} onChange={() => {}} showPreview />);

    const row = screen.getByTestId(`nav-designer-item-probe_${type}`);
    // The type badge resolves to a label, not to its raw translation key.
    expect(row.textContent ?? '').not.toMatch(/appDesigner\./);
  });
});
