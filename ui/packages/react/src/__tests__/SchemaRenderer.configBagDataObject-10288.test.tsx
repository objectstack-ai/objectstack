/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10288: a DATA OBJECT in a node's config bag reaches the renderer
 * whole, even when it carries a `source` field.
 *
 * The per-value `properties` / `props` loops handed every value to
 * `ExpressionEvaluator.evaluate`, which unwraps ANY object with a string
 * `source` to that bare string. The loops now hand an object on a
 * non-predicate key to `evaluate` only when it is a spec Expression envelope
 * (it carries a string `dialect`). The end-to-end probe (`action:button` ->
 * runner) lives in `@object-ui/components`, as
 * `action-config-bag-source-key-10288.test.tsx`; this file pins the fix site.
 *
 * ## The key table
 *
 * `CENSUS_KEYS` names the object-valued inputs found on this path when the card
 * was worked: every registered input whose `type` carries an `object` arm, read
 * off `ComponentRegistry.getAllConfigs()` with the whole registration graph
 * loaded (`@object-ui/components` plus the console's `register-plugins`), plus
 * the object-valued keys the action renderers forward off the node without
 * declaring them as inputs. It is a SAMPLE of that census, not a live copy of
 * it, and nothing here claims it is complete: the loop reads a key's NAME only
 * to recognise `params` and the predicate chain, so the rule below holds for
 * every other key, listed or not. The table exists so that each census row is
 * named in a failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

const CENSUS_KEYS = [
  // Registered inputs with an `object` arm.
  'action', 'actions', 'add', 'aggregate', 'body', 'compareTo', 'content', 'data',
  'dataSource', 'dateRange', 'defaultValues', 'description', 'drillDown',
  'emptyText', 'exportOptions', 'feed', 'footer', 'grouping', 'header',
  'initialData', 'initialValues', 'label', 'listViews', 'metrics', 'mobile',
  'navigation', 'operations', 'options', 'pagination', 'placeholder',
  'rightContent', 'rowColor', 'search', 'selection', 'submitBehavior',
  'subtitle', 'systemActions', 'title', 'trend', 'value', 'values',
  // Object-valued keys `action:button` / `action:icon` forward off the node.
  'bodyExtra', 'bodyShape', 'patch', 'resultDialog', 'onSuccess', 'toast',
];

/** A data object whose `source` is a FIELD, not an expression. */
const BODY = { source: 'web', campaign: 'spring' };

const DATA = { status: 'draft' };

/** The evaluated schema a renderer is handed: the keys this file reads off it. */
type Seen = Record<string, unknown> & {
  properties?: Record<string, unknown>;
  props?: Record<string, unknown>;
};

/** Records every schema the probe is handed; the last one is what it rendered. */
const handed = vi.fn<(schema: Seen | undefined) => void>();

const Probe = (props: { schema?: Seen }) => {
  handed(props.schema);
  return <div data-testid="probe" />;
};

/** The schema the probe was last handed. */
const seen = (): Seen | undefined => handed.mock.lastCall?.[0];

/**
 * `DATA` is injected as the `data` ROOT of the expression scope, not as an
 * adapter; see the objectui#7912 note in
 * `SchemaRenderer.predicateEnvelopeConfigBag.test.tsx` for why it crosses the
 * `DataSource` type.
 */
function mount(schema: Record<string, unknown>) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
      <SchemaRendererContext.Provider value={{ dataSource: DATA as unknown as DataSource }}>
        <SchemaRenderer schema={{ type: 'probe-10288', ...schema } as never} />
      </SchemaRendererContext.Provider>
    </PredicateScopeProvider>,
  );
}

beforeEach(() => {
  handed.mockClear();
  ComponentRegistry.register('probe-10288', Probe as never);
});

afterEach(() => {
  cleanup();
  ComponentRegistry.unregister?.('probe-10288');
});

describe('objectui#10288: a data object carrying `source` is not collapsed to that string', () => {
  it.each(CENSUS_KEYS)('properties.%s arrives whole, in the bag and on the node', (key) => {
    mount({ properties: { [key]: BODY } });
    expect(seen()?.properties?.[key]).toEqual(BODY);
    // The hoist copies the evaluated value onto the node, which is where most
    // renderers read it.
    expect(seen()?.[key]).toEqual(BODY);
  });

  it.each(CENSUS_KEYS)('props.%s arrives whole', (key) => {
    mount({ props: { [key]: BODY } });
    expect(seen()?.props?.[key]).toEqual(BODY);
  });

  it('a dialect-less `{ source }` on a non-predicate key is DATA now, and is not interpolated', () => {
    // The behaviour change, stated as a pin: the spec's Expression envelope
    // always carries `dialect`, so this object is a value, like the server's
    // `defaultValue` reading of the same shape.
    const authored = { source: '${data.status}' };
    mount({ properties: { caption: authored } });
    expect(seen()?.properties?.caption).toEqual(authored);
  });
});

describe('objectui#10288 CONTROLS: what the loops still evaluate', () => {
  it('a string template is still interpolated', () => {
    mount({ properties: { caption: 'S-${data.status}' } });
    expect(seen()?.properties?.caption).toBe('S-draft');
  });

  it('a spec `template` envelope on a non-predicate key still collapses to its interpolated value', () => {
    mount({ properties: { caption: { dialect: 'template', source: '${data.status}' } } });
    expect(seen()?.properties?.caption).toBe('draft');
  });

  it('a dialect-less `{ source }` on a PREDICATE key is still an expression (ExpressionWire, objectui#7530)', () => {
    mount({ properties: { visible: { source: '${data.status === "draft"}' } } });
    const holds = screen.queryByTestId('probe') !== null;
    cleanup();
    mount({ properties: { visible: { source: '${data.status === "published"}' } } });
    const fails = screen.queryByTestId('probe') !== null;
    expect({ holds, fails }).toEqual({ holds: true, fails: false });
  });

  it('a CEL envelope on a predicate key is still preserved, not flattened (objectui#9100)', () => {
    const envelope = { dialect: 'cel', source: 'has(data.status) && data.status == "draft"' };
    mount({ properties: { visible: envelope } });
    expect(seen()?.properties?.visible).toEqual(envelope);
  });
});
