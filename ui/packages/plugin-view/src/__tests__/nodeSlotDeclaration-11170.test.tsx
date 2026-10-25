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
 * for the census this file is the plugin half of. `view-switcher` renders the
 * active view's `schema` — one node or a list — through `SchemaRenderer`.
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

const rendersMark = (schema: unknown): boolean => {
  render(
    <AdapterCtx.Provider value={null as never}>
      <SchemaRenderer schema={schema as never} />
    </AdapterCtx.Provider>,
  );
  return (document.body.textContent ?? '').includes(MARK);
};

const FIXTURES: Record<string, Record<string, unknown>> = {
  'views[].schema': { views: [{ type: 'grid', label: 'G', schema: [MARK_NODE] }] },
};

describe.each(['view-switcher', 'view:view-switcher'])('`%s` — declared ⇔ rendered (objectui#11170)', (type) => {
  it('is registered, and the declaration lists exactly the positions this file exercises', () => {
    expect(ComponentRegistry.has(type)).toBe(true);
    expect(nodeSlotsFor(type).map((s) => s.path).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it.each(Object.keys(FIXTURES))('renders an authored node at `%s`', (path) => {
    expect(rendersMark({ type, ...FIXTURES[path] })).toBe(true);
  });

  it('the probe can fail: a node under a key the row does not name stays off the page', () => {
    expect(rendersMark({ type, views: [{ type: 'grid', label: 'G' }], footer: [MARK_NODE] })).toBe(false);
  });
});
