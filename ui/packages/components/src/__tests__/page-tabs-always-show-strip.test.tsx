/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `page:tabs.alwaysShowStrip` — the published key, on the spelling it is
 * published as (objectui#4668).
 *
 * The key opts a one-tab strip back into visibility: `PageTabsRenderer` hides
 * the strip entirely at length 1, because a lone pill labelled "Details" is
 * clutter rather than an affordance. @objectstack/spec 17.0.0 GA declares the
 * key on `PageTabsProps`, the renderer has honoured it since the suppression
 * landed, and `inputs` omitted it — so `gen-manifest.ts` left it out of
 * `sdui.manifest.json` and `sdui-intrinsics.d.ts`, `sdui-parser`'s prop walk
 * reported `unknown-prop` on an author who wrote it, and the renderer honoured
 * it anyway. objectui#4668 declares it.
 *
 * WHY THIS FILE EXISTS RATHER THAN A DECLARATION ASSERTION ALONE. Declaring the
 * input was not sufficient, and the measurement is what said so. `inputs`
 * publishes TOP-LEVEL keys — that is the shape `validate.ts` walks, the shape
 * `sdui-intrinsics.d.ts` types, and the shape the JSX-page compiler whitelists —
 * while this renderer's only read was `schema.properties.alwaysShowStrip`.
 * Measured on a one-tab schema before the change: the wrapped form showed the
 * strip, the flat form did not. Publishing the key on a spelling the renderer
 * drops would have reproduced the parity gate's own failure mode one layer in —
 * a manifest telling an author to write a key the platform throws away — so the
 * canonical arm was added with the declaration, and both spellings are pinned
 * here.
 *
 * `SchemaRenderer` hoists `properties.*` onto the schema, so the canonical arm
 * covers the wrapped form as well; the `properties` arm survives for paths that
 * reach this renderer without that hoist. Deleting either arm turns exactly one
 * test below red, which is what keeps the pair honest.
 *
 * Module-scope registration import, not a hook: the cold transform belongs to
 * the import phase, which carries no test/hook timeout (AGENTS.md §测试纪律,
 * objectui#3010).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { PageTabsProps } from '@objectstack/spec/ui';
import '../renderers';

const ONE_TAB = [{ label: 'Details', value: 'details', children: [] }];
const TWO_TABS = [
  { label: 'Details', value: 'details', children: [] },
  { label: 'Related', value: 'related', children: [] },
];

/** Is the tab strip in the DOM? Radix renders it as `role="tablist"`. */
const stripVisible = (schema: unknown): boolean => {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  return container.querySelector('[role="tablist"]') !== null;
};

describe('page:tabs alwaysShowStrip — the read (objectui#4668)', () => {
  it('hides a one-tab strip when the key is absent', () => {
    // The control, FIRST. Every positive assertion below is "the strip is
    // there", and a renderer that always drew the strip would satisfy all of
    // them; this is the only test that fails in that case.
    expect(stripVisible({ type: 'page:tabs', id: 't-default', items: ONE_TAB })).toBe(false);
  });

  it('shows a one-tab strip for the PUBLISHED top-level spelling', () => {
    // The spelling `inputs`, the manifest and the generated `.d.ts` all
    // advertise. Red before objectui#4668 added the canonical arm — measured,
    // not assumed.
    expect(
      stripVisible({ type: 'page:tabs', id: 't-flat', items: ONE_TAB, alwaysShowStrip: true }),
    ).toBe(true);
  });

  it('shows a one-tab strip for the wrapped `properties` spelling', () => {
    // The spec-bridge form, which `SchemaRenderer` hoists. Green before the
    // change and green after: the point of asserting it is that the widening
    // did not cost the form that already worked.
    expect(
      stripVisible({
        type: 'page:tabs',
        id: 't-wrapped',
        properties: { items: ONE_TAB, alwaysShowStrip: true },
      }),
    ).toBe(true);
  });

  it('treats `false` and a non-boolean as "not set" — only `true` opts in', () => {
    // The read is `=== true`, deliberately: the contract types the key boolean,
    // so a truthy string is off-contract input rather than a second way to say
    // yes, and the renderer must not invent one (AGENTS.md #0.1).
    expect(
      stripVisible({ type: 'page:tabs', id: 't-false', items: ONE_TAB, alwaysShowStrip: false }),
    ).toBe(false);
    expect(
      stripVisible({ type: 'page:tabs', id: 't-str', items: ONE_TAB, alwaysShowStrip: 'true' }),
    ).toBe(false);
  });

  it('leaves multi-tab pages alone in every spelling', () => {
    // Scope guard: the key can only ever ADD a strip at length 1. A regression
    // that made it a general gate would show up here.
    expect(stripVisible({ type: 'page:tabs', id: 't-multi', items: TWO_TABS })).toBe(true);
    expect(
      stripVisible({ type: 'page:tabs', id: 't-multi-off', items: TWO_TABS, alwaysShowStrip: false }),
    ).toBe(true);
  });
});

describe('page:tabs alwaysShowStrip — the declaration (objectui#4668)', () => {
  const inputs = () => ComponentRegistry.getConfig('page:tabs')?.inputs ?? [];
  const input = (name: string) => inputs().find((i) => i.name === name);

  it('publishes the key as a boolean, with a description', () => {
    // Non-empty FIRST: an emptied `inputs` list would satisfy a bare
    // `toBeDefined()` for the wrong reason, the vacuous-green trap
    // objectui#3808's reverse run documented.
    expect(inputs().length).toBeGreaterThan(0);
    expect(inputs().map((i) => i.name)).toContain('alwaysShowStrip');
    expect(input('alwaysShowStrip')?.type).toBe('boolean');
    expect((input('alwaysShowStrip')?.description ?? '').length).toBeGreaterThan(0);
  });

  it('declares the single arm the contract really has', () => {
    // A VALUE verdict, so the criterion is a full parse either way — the
    // declared `boolean` has to be the shape the spec accepts, and the arms it
    // does NOT have have to be refused rather than merely stripped. `items` is
    // required on this props schema, so it rides along on every probe.
    const withItems = (value: unknown) =>
      PageTabsProps.safeParse({ items: ONE_TAB, alwaysShowStrip: value });

    expect(withItems(true).success).toBe(true);
    expect(withItems(true).data?.alwaysShowStrip).toBe(true);
    expect(withItems(false).success).toBe(true);
    expect(withItems(false).data?.alwaysShowStrip).toBe(false);

    for (const rejected of [1, 0, 'true', null]) {
      const parsed = withItems(rejected);
      expect(parsed.success, `spec accepted ${JSON.stringify(rejected)}`).toBe(false);
      expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('alwaysShowStrip');
    }
  });
});
