/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The node-slot declaration ⇔ this plugin's renderers (objectui#11170).
 *
 * `NODE_SLOT_DECLARATIONS` (`@object-ui/types`) says through which keys other
 * than `children` a renderer hands authored nodes back to `SchemaRenderer`,
 * and the `objectui check` gate, core's `validateChildren` and the SDUI
 * parser walk those positions. The components-side census holds the rows
 * registered by `@object-ui/components`; this file holds the rows registered
 * HERE, the same way: a node authored at every declared position reaches the
 * DOM through the real `SchemaRenderer`, under every registry key of the row,
 * and the row lists exactly the positions this file exercises — so a position
 * added to the declaration without a renderer read, or a read the declaration
 * drops, is red here.
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

/** The detail view's slots: a fixture per declared position, nothing else at it. */
const DETAIL_BASE = { objectName: 'thing', title: 'Fixture', data: { id: 'X1', qty: 3 } };
const DETAIL_FIXTURES: Record<string, Record<string, unknown>> = {
  header: { header: [MARK_NODE] },
  footer: { footer: [MARK_NODE] },
  actions: { actions: [MARK_NODE] },
  'tabs[].content': { tabs: [{ key: 't', label: 'T', content: [MARK_NODE] }] },
  'sections[].fields[].render': { sections: [{ title: 'S', fields: [{ name: 'qty', render: MARK_NODE }] }] },
  'fields[].render': { fields: [{ name: 'qty', render: MARK_NODE }] },
};

const SECTION_FIXTURES: Record<string, Record<string, unknown>> = {
  'fields[].render': { title: 'S', fields: [{ name: 'qty', render: MARK_NODE }], data: { qty: 3 } },
};

describe.each([
  ['detail-view', DETAIL_BASE, DETAIL_FIXTURES],
  ['plugin-detail:detail-view', DETAIL_BASE, DETAIL_FIXTURES],
  ['detail', DETAIL_BASE, DETAIL_FIXTURES],
  ['view:detail', DETAIL_BASE, DETAIL_FIXTURES],
  ['detail-section', {}, SECTION_FIXTURES],
  ['plugin-detail:detail-section', {}, SECTION_FIXTURES],
] as const)('`%s` — declared ⇔ rendered (objectui#11170)', (type, base, fixtures) => {
  it('is registered, and the declaration lists exactly the positions this file exercises', () => {
    expect(ComponentRegistry.has(type)).toBe(true);
    expect(nodeSlotsFor(type).map((s) => s.path).sort()).toEqual(Object.keys(fixtures).sort());
  });

  it.each(Object.keys(fixtures))('renders an authored node at `%s`', (path) => {
    expect(rendersMark({ type, ...base, ...fixtures[path] })).toBe(true);
  });

  it('the probe can fail: a node under a key the row does not name stays off the page', () => {
    expect(nodeSlotsFor(type).some((s) => s.path === 'trigger')).toBe(false);
    expect(rendersMark({ type, ...base, trigger: [MARK_NODE] })).toBe(false);
  });
});
