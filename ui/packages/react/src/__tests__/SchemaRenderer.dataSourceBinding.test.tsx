/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `PageComponentSchema.dataSource` is schema METADATA, not a React prop
 * (objectstack#5576).
 *
 * SchemaRenderer spreads every non-metadata schema key onto the resolved
 * component. `dataSource` was not on the strip list, so the spec's per-element
 * data BINDING (`{ object, view, filter, sort, limit }` — plain JSON) landed on
 * the `dataSource` PROP of every data-bound block, which is where the host
 * injects the runtime data-source ADAPTER. The plain object shadowed the
 * adapter, and the block's first `dataSource.find(…)` threw
 * `dataSource.find is not a function`: `list-view` reported that as
 * **"Couldn't load records"**, so a page component that wrote the binding the
 * spec documents was BROKEN by writing it, while the same component without it
 * worked. That is the single-variable reproduction in the issue.
 *
 * These tests pin the three facts that make the collision impossible to
 * reintroduce: the binding does not arrive as a prop, it is still readable off
 * `schema` (which is how a consumer is supposed to read it), and an explicit
 * React `dataSource` prop — how `ObjectView` and every test harness pass a real
 * adapter — still reaches the component untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';

/**
 * Props the probe was rendered with. An ARRAY that is pushed to, rather than a
 * variable reassigned from inside the component — `react-hooks/globals` (error
 * in this repo) forbids the latter.
 */
const renders: Array<Record<string, any>> = [];
const seen = () => renders[renders.length - 1];

const ProbeWidget: React.FC<any> = (props) => {
  renders.push(props);
  return <div data-testid="probe" />;
};

const BINDING = { object: 'account', view: 'hot' } as const;

describe('SchemaRenderer — schema.dataSource is metadata, not a prop', () => {
  beforeEach(() => {
    renders.length = 0;
    ComponentRegistry.register('probe-widget', ProbeWidget);
  });

  afterEach(() => {
    ComponentRegistry.unregister?.('probe-widget');
  });

  it('does not spread the schema binding onto the component as `dataSource`', () => {
    render(<SchemaRenderer schema={{ type: 'probe-widget', dataSource: { ...BINDING } } as any} />);
    // No provider is mounted, so there is no adapter either — the point is that
    // the METADATA is not standing in for one.
    expect(seen()?.dataSource).toBeUndefined();
  });

  it('keeps the binding readable on `schema` — the supported read path', () => {
    render(<SchemaRenderer schema={{ type: 'probe-widget', dataSource: { ...BINDING } } as any} />);
    expect(seen()?.schema?.dataSource).toEqual(BINDING);
  });

  it('still delivers an explicit React `dataSource` prop (a real adapter)', () => {
    const adapter = { find: async () => ({ data: [] }) };
    render(
      <SchemaRenderer
        schema={{ type: 'probe-widget', dataSource: { ...BINDING } } as any}
        dataSource={adapter}
      />,
    );
    expect(seen()?.dataSource).toBe(adapter);
    // …and the binding is still on the schema, so a block can consume both.
    expect(seen()?.schema?.dataSource).toEqual(BINDING);
  });

  it('leaves a `props.dataSource` written under the schema’s `props` bag alone', () => {
    // `schema.props` is the explicit visual-prop channel, spread after the
    // metadata strip. Nothing about #5576 changes it.
    const adapter = { find: async () => ({ data: [] }) };
    render(
      <SchemaRenderer
        schema={{ type: 'probe-widget', props: { dataSource: adapter } } as any}
      />,
    );
    expect(seen()?.dataSource).toBe(adapter);
  });
});
