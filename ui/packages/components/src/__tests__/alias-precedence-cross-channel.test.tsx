/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5123 — one key, one answer, through REAL production renderers.
 *
 * The companion pin in
 * `packages/react/src/__tests__/SchemaRenderer.aliasPrecedenceCrossChannel.test.tsx`
 * states the invariant against a probe, because `@object-ui/react` by design
 * does not depend on `@object-ui/components`. This file is the other half: the
 * same node shape driven through the two renderer FAMILIES the defect actually
 * split, with no stand-in for either read path.
 *
 *   - `element:text` is the `readProps()` family — it reads its config out of
 *     the CONFIG BAG (`{ ...schema.props, ...schema.properties }`). The five
 *     members on `main` are `elements.tsx`, `text-input.tsx`,
 *     `record-picker.tsx`, `data-list.tsx`, `metadata-viewer.tsx`; a sixth,
 *     `plugin-detail/src/renderers/record-alert.tsx`, merges
 *     `{ ...schema, ...schema.properties }` — a different expression of the
 *     same `properties`-wins order.
 *   - `badge` is the SPREAD path — it takes what `createElement` hands it as
 *     React props (`{ schema, ...props }`) and puts it on the DOM. Everything
 *     outside the `readProps()` family reads this way.
 *
 * Before the fix these two families disagreed about the SAME key on the SAME
 * node, in opposite directions: the bag read `properties`, the prop read
 * `props`. Which one reached the screen depended only on which family the
 * author's chosen component happened to belong to. Ruled 2026-08-18:
 * `properties` wins on BOTH — the bag order was already right and is untouched.
 *
 * Requirement (2) of that ruling is why this file exists at all: pinning only
 * the channel the fix edited would let the two drift apart again, which is the
 * defect CLASS rather than the one spread order. So the assertions below are
 * cross-family equalities, not per-file readings.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { undeclaredNode } from '@object-ui/test-support';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

describe('alias precedence across the two renderer families (objectui#5123)', () => {
  it('`element:text` (readProps family) renders the canonical `properties` value', () => {
    // Unchanged by the fix — this channel was already correct and the ruling
    // explicitly keeps it. Pinned so a future "unify the alias" change cannot
    // satisfy the invariant by flipping THIS side instead, which would be the
    // opposite of what was ruled.
    const { container } = render(
      <SchemaRenderer
        // The legacy `props` alias on `element:text` is deliberately the thing
        // under test, and the `element:text` node declares no `props`, so the
        // node crosses through the one test helper for that (objectui#11466).
        schema={undeclaredNode({
          type: 'element:text',
          className: 'xchan-text',
          props: { content: 'FROM_PROPS' },
          properties: { content: 'FROM_PROPERTIES' },
        })}
      />
    );

    expect(container.querySelector('.xchan-text')?.textContent).toBe('FROM_PROPERTIES');
  });

  it('`badge` (spread path) receives the canonical `properties` value as its React prop', () => {
    // The half the fix moved. `title` is an ordinary pass-through prop: the
    // hoist puts `properties.title` on the node, `badge` spreads whatever it is
    // handed onto the DOM. Before the fix the alias spread last and this read
    // FROM_PROPS.
    const { container } = render(
      <SchemaRenderer
        schema={{
          type: 'badge',
          label: 'b',
          // @ts-expect-error — `props` is not on the TS authoring face (objectui#8347, the `props` alias, option A); the runtime alias read is what this test measures
          props: { title: 'FROM_PROPS' },
          properties: { title: 'FROM_PROPERTIES' },
        }}
      />
    );

    const badge = container.querySelector('[data-obj-type="badge"]');
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute('title')).toBe('FROM_PROPERTIES');
  });

  it('the two families agree on one node — the invariant, stated as an equality', () => {
    // The actual regression guard. Same key, same authored pair of bags, one
    // node shape, read through both families; the assertion is that the two
    // readings are EQUAL, so re-inverting either side fails here even if the
    // per-family expectations above were edited to match a new reading.
    const bags = {
      props: { content: 'FROM_PROPS', title: 'FROM_PROPS' },
      properties: { content: 'FROM_PROPERTIES', title: 'FROM_PROPERTIES' },
    };

    const bagChannel = render(
      <SchemaRenderer
        schema={{ type: 'element:text', className: 'xchan-both', ...bags }}
      />
    );
    const bagRead = bagChannel.container.querySelector('.xchan-both')?.textContent;

    const propChannel = render(
      <SchemaRenderer schema={{ type: 'badge', label: 'b', ...bags }} />
    );
    const reactPropRead = propChannel.container
      .querySelector('[data-obj-type="badge"]')
      ?.getAttribute('title');

    expect(bagRead).toBe(reactPropRead);
    expect(bagRead).toBe('FROM_PROPERTIES');
  });

  it('a node carrying only the legacy `props` bag still works on both families', () => {
    // The blast radius is co-occurrence only. `props` remains a working alias
    // wherever `properties` does not also claim the key — the ruling narrowed
    // precedence, it did not retire the alias (that question is objectui#4795's
    // pending ②, and is NOT decided here).
    const text = render(
      <SchemaRenderer
        schema={undeclaredNode({
          type: 'element:text',
          className: 'xchan-legacy',
          props: { content: 'ONLY_PROPS' },
        })}
      />
    );
    expect(text.container.querySelector('.xchan-legacy')?.textContent).toBe('ONLY_PROPS');

    const badge = render(
      <SchemaRenderer
        schema={{
          type: 'badge',
          label: 'b',
          // @ts-expect-error — `props` is not on the TS authoring face (objectui#8347, the `props` alias, option A); the runtime alias read is what this test measures
          props: { title: 'ONLY_PROPS' },
        }}
      />
    );
    expect(
      badge.container.querySelector('[data-obj-type="badge"]')?.getAttribute('title')
    ).toBe('ONLY_PROPS');
  });
});
