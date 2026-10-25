/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The node-slot declaration ⇔ this plugin's renderers (objectui#11170). See
 * `packages/components/src/renderers/__tests__/node-slot-declaration-11170.test.tsx`
 * for the census this file is the plugin half of.
 *
 * Two renderers answer to `timeline` here: `view:timeline` (and the bare key
 * it claims) is the object-bound view and reads no authored node;
 * `plugin-timeline:timeline`, the presentational feed, hands each item's
 * `content` to `renderChildren`. Only the latter has a row.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
import { nodeSlotsFor } from '@object-ui/types';

// Module scope, not a hook: these imports ARE the registrations.
import '@object-ui/components';
import '../index';

afterEach(() => cleanup());

const MARK = 'slot-census-11170';
const MARK_NODE = { type: 'text', content: MARK };
const TYPE = 'plugin-timeline:timeline';

const rendersMark = (schema: unknown): boolean => {
  render(
    <AdapterCtx.Provider value={null as never}>
      <SchemaRenderer schema={schema as never} />
    </AdapterCtx.Provider>,
  );
  return (document.body.textContent ?? '').includes(MARK);
};

const FIXTURES: Record<string, Record<string, unknown>> = {
  'items[].content': { items: [{ title: 'T', content: [MARK_NODE] }] },
};

describe(`\`${TYPE}\` — declared ⇔ rendered (objectui#11170)`, () => {
  it('is registered, and the declaration lists exactly the positions this file exercises', () => {
    expect(ComponentRegistry.has(TYPE)).toBe(true);
    expect(nodeSlotsFor(TYPE).map((s) => s.path).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it.each(Object.keys(FIXTURES))('renders an authored node at `%s`', (path) => {
    expect(rendersMark({ type: TYPE, ...FIXTURES[path] })).toBe(true);
  });

  it('the probe can fail: a node under a key the row does not name stays off the page', () => {
    expect(rendersMark({ type: TYPE, items: [{ title: 'T' }], footer: [MARK_NODE] })).toBe(false);
  });

  it('the object-bound `timeline` / `view:timeline` has no row', () => {
    expect(ComponentRegistry.get('timeline')).not.toBe(ComponentRegistry.get(TYPE));
    expect(nodeSlotsFor('timeline')).toEqual([]);
    expect(nodeSlotsFor('view:timeline')).toEqual([]);
  });
});
