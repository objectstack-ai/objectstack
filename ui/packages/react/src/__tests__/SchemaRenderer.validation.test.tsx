/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererProvider } from '../context/SchemaRendererContext';
import type { BaseSchema, DataSource } from '@object-ui/types';

/**
 * This file's registered hosts, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'valid-host': BaseSchema;
    'host-wrap': BaseSchema;
  }
}

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are placeholders for a provider that merely has to EXIST, and one probe
 * that pins the empty-object case by name.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

const PassthroughDiv: React.FC<any> = (props) => {
  const { schema, ...rest } = props;
  return <div data-testid="rendered" {...rest} />;
};

describe('SchemaRenderer — dev-mode validation', () => {
  // `ReturnType<typeof vi.spyOn>` resolves to the un-instantiated
  // `MockInstance<Procedure | Constructable>` union, whose `mock.calls` degrades
  // to an implicitly-`any` element type — so every `.filter((call) => ...)`
  // below was unchecked (objectui#4040). Naming the spied signature keeps
  // `calls` a real tuple array.
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    ComponentRegistry.register('valid-host', PassthroughDiv);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not warn for a well-formed schema', () => {
    render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
        <SchemaRenderer schema={{ type: 'valid-host', id: 'ok' }} />
      </SchemaRendererProvider>
    );
    const invalidCalls = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('[ObjectUI] Invalid schema')
    );
    expect(invalidCalls.length).toBe(0);
  });

  it('warns once when a required field is missing', () => {
    // missing `type` is the canonical structural error
    const badSchema: any = { id: 'oops' };
    // Wrap in a host component so the renderer never reaches the
    // "unknown component" path. We pass via children of a known type.
    const HostWithChild: React.FC<any> = ({ schema }) => (
      <div data-testid="host">{JSON.stringify(schema.children?.[0])}</div>
    );
    ComponentRegistry.register('host-wrap', HostWithChild);

    render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
        <SchemaRenderer
          schema={{
            type: 'host-wrap',
            id: 'wrap',
            children: [badSchema],
          }}
        />
      </SchemaRendererProvider>
    );

    const invalidCalls = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('[ObjectUI] Invalid schema')
    );
    expect(invalidCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('marks invalid host elements with data-obj-schema-invalid', () => {
    const bad: any = { id: 'noType' };
    // The validator inspects `schema.children` recursively; we can also
    // pass a top-level node that lacks the strict requirements. We mount
    // a node whose own outer shape is fine but whose contents fail —
    // children validation populates errors, and the attribute appears on
    // the rendered host element because the *same* schema object was
    // detected as invalid.
    ComponentRegistry.register('invalid-host', PassthroughDiv);
    const schema: any = {
      type: 'invalid-host',
      id: 'root',
      children: [bad],
    };
    const { getByTestId } = render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
        <SchemaRenderer schema={schema} />
      </SchemaRendererProvider>
    );
    expect(getByTestId('rendered').getAttribute('data-obj-schema-invalid')).toBe('true');
  });

  it('does not re-warn for the same schema object on re-render', () => {
    const bad: any = { id: 'noType' };
    const schema: any = {
      type: 'valid-host',
      id: 'root',
      children: [bad],
    };

    const { rerender } = render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
        <SchemaRenderer schema={schema} />
      </SchemaRendererProvider>
    );
    const firstCount = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[ObjectUI] Invalid schema')
    ).length;

    rerender(
      <SchemaRendererProvider dataSource={{ tick: 1 } as unknown as DataSource}>
        <SchemaRenderer schema={schema} />
      </SchemaRendererProvider>
    );
    const secondCount = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[ObjectUI] Invalid schema')
    ).length;

    expect(secondCount).toBe(firstCount);
  });
});
