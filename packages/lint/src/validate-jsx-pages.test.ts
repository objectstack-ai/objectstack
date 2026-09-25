// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { validateJsxPages } from './validate-jsx-pages.js';

describe('validateJsxPages (ADR-0080 build gate)', () => {
  it('passes a well-formed jsx page', () => {
    const stack = { pages: [{ name: 'cc', kind: 'jsx', source: '<flex><text content="hi" /></flex>' }] };
    expect(validateJsxPages(stack)).toEqual([]);
  });
  it('flags an empty source on a jsx page', () => {
    expect(validateJsxPages({ pages: [{ name: 'cc', kind: 'jsx' }] }).some((f) => f.rule === 'jsx-page-empty-source')).toBe(true);
  });
  it('flags malformed jsx (mismatched close) loudly, at the source path', () => {
    const f = validateJsxPages({ pages: [{ name: 'cc', kind: 'jsx', source: '<flex><card>oops</flex>' }] });
    expect(f.some((x) => x.severity === 'error')).toBe(true);
    expect(f.every((x) => x.path === 'pages[0].source')).toBe(true);
  });
  it('rejects event handlers and dangerouslySetInnerHTML at parse level', () => {
    const f = validateJsxPages({ pages: [{ name: 'cc', kind: 'jsx', source: '<flex onClick="x()" dangerouslySetInnerHTML={{}} />' }] })
      .filter((x) => x.rule === 'jsx-forbidden-attr');
    expect(f).toHaveLength(2);
  });
  it('ignores non-jsx pages', () => {
    expect(validateJsxPages({ pages: [{ name: 'full', kind: 'full', regions: [] }] })).toEqual([]);
  });
  it('validates kind:\'html\' (the renamed tier) too', () => {
    expect(validateJsxPages({ pages: [{ name: 'cc', kind: 'html', source: '<flex><text content="hi" /></flex>' }] })).toEqual([]);
    expect(validateJsxPages({ pages: [{ name: 'cc', kind: 'html' }] }).some((f) => f.rule === 'jsx-page-empty-source')).toBe(true);
  });
  it('does NOT lint kind:\'react\' (real JS, not constrained JSX)', () => {
    const stack = { pages: [{ name: 'rx', kind: 'react', source: 'function P(){const[n]=React.useState(0);return <div>{n}</div>}' }] };
    expect(validateJsxPages(stack)).toEqual([]);
  });
});

describe('validateJsxPages — full validation with a manifest', () => {
  const manifest = {
    components: {
      // Containment is the declared `children` input, not `isContainer`
      // (objectui#9910, ported to the save gate by #19969) — the flag stays as
      // the layout fact it is.
      flex: { type: 'flex', namespace: 'ui', isContainer: true, inputs: [{ name: 'children', type: 'slot' }] },
      'object-table': { type: 'object-table', namespace: 'plugin-grid', inputs: [{ name: 'object', type: 'string', required: true }] },
    },
  };
  it('catches unknown components and missing required props', () => {
    const stack = { pages: [{ name: 'cc', kind: 'jsx', source: '<flex><object-table /><bogus /></flex>' }] };
    const f = validateJsxPages(stack, { manifest } as never);
    expect(f.some((x) => x.rule === 'jsx-missing-required-prop')).toBe(true);
    expect(f.some((x) => x.rule === 'jsx-forbidden-tag')).toBe(true);
  });
  it('passes when components + required props are satisfied', () => {
    const stack = { pages: [{ name: 'cc', kind: 'jsx', source: '<flex><object-table object="account" /></flex>' }] };
    expect(validateJsxPages(stack, { manifest } as never)).toEqual([]);
  });
});
