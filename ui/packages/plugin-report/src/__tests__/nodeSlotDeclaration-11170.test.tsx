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
 * for the census this file is the plugin half of: a node authored at every
 * declared position reaches the DOM through the real `SchemaRenderer`, under
 * every registry key of the row, and the row lists exactly the positions this
 * file exercises.
 *
 * `report-viewer` is the one registration here that hands authored nodes
 * back: `report.sections[].content`. The bare `report` node unwraps its
 * `report` key and routes to a dataset renderer, a spec-report presentation
 * or the legacy renderer, none of which reads an authored node, so it has no
 * row — asserted below so a later read is a measured change, not a drift.
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
  'report.sections[].content': {
    report: { title: 'R', sections: [{ type: 'text', title: 'S', content: [MARK_NODE] }] },
    data: [],
    showToolbar: false,
  },
};

describe.each(['report-viewer', 'plugin-report:report-viewer'])('`%s` — declared ⇔ rendered (objectui#11170)', (type) => {
  it('is registered, and the declaration lists exactly the positions this file exercises', () => {
    expect(ComponentRegistry.has(type)).toBe(true);
    expect(nodeSlotsFor(type).map((s) => s.path).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it.each(Object.keys(FIXTURES))('renders an authored node at `%s`', (path) => {
    expect(rendersMark({ type, ...FIXTURES[path] })).toBe(true);
  });

  it('the probe can fail: a node under a key the row does not name stays off the page', () => {
    expect(rendersMark({ type, report: { title: 'R', sections: [] }, data: [], footer: [MARK_NODE] })).toBe(false);
  });
});

describe('`report` has no node slot (objectui#11170)', () => {
  it('declares none, and an authored node under `report.sections[].content` is not what it renders', () => {
    expect(ComponentRegistry.has('report')).toBe(true);
    expect(nodeSlotsFor('report')).toEqual([]);
    expect(nodeSlotsFor('plugin-report:report')).toEqual([]);
  });
});
