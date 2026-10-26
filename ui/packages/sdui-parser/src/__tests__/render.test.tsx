/** M2 — JSX source compiles and renders through the REAL SchemaRenderer.
 *  Runs under the objectui workspace + vitest (jsdom). The render contract:
 *  SchemaRenderer passes the node as `props.schema`; containers render their
 *  own children from `schema.children`. */
import { beforeAll, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { compile, manifestFromConfigs } from '../index.js';

const Kids = ({ nodes }: { nodes?: unknown[] }) => (
  <>{(nodes ?? []).map((n, i) => (typeof n === 'string' ? n : <SchemaRenderer key={i} schema={n as any} />))}</>
);

beforeAll(() => {
  ComponentRegistry.register(
    'flex',
    (p: any) => <div className="flex" data-gap={p.gap}><Kids nodes={p.schema?.children} /></div>,
    { namespace: 'ui', isContainer: true },
  );
  ComponentRegistry.register(
    'text',
    (p: any) => <span className="text"><Kids nodes={p.schema?.children} /></span>,
    { namespace: 'ui', isContainer: true },
  );
  ComponentRegistry.register('object-table', (p: any) => <table data-object={p.object} />, {
    namespace: 'plugin-grid',
  });
});

// Containment is the declared `children` slot input (objectui#9910); the two
// containers below nest children in the source, so both declare it.
const manifest = manifestFromConfigs([
  { type: 'flex', namespace: 'ui', isContainer: true, inputs: [{ name: 'gap', type: 'number' }, { name: 'children', type: 'slot' }] },
  { type: 'text', namespace: 'ui', inputs: [{ name: 'children', type: 'slot' }] },
  { type: 'object-table', namespace: 'plugin-grid', inputs: [{ name: 'object', type: 'string', required: true, binding: 'object' }] },
]);

describe('M2: JSX source → tree → real SchemaRenderer', () => {
  it('renders a nested tree with the binding threaded through', () => {
    const { tree, ok } = compile(
      `<flex gap={8}><text>Hello SDUI</text><object-table object="account" /></flex>`,
      manifest,
    );
    expect(ok).toBe(true);
    const html = renderToStaticMarkup(<SchemaRenderer schema={tree as any} />);
    expect(html).toContain('class="flex"');
    expect(html).toContain('data-gap="8"');
    expect(html).toContain('Hello SDUI');
    expect(html).toContain('data-object="account"');
  });
});
