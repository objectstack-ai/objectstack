// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28179 — `onRequiredRowFieldsChange` reports the rows the form
 * OFFERS whose served layout says `required: true`, and only those: the host
 * holds Save on an unset one, so a row the author cannot reach or edit must
 * never be reported. The page half is pinned in
 * `ResourceEditPage.requiredRow-28179.test.tsx`.
 */

import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SchemaForm, type FormViewSpec } from './SchemaForm';

const schema = {
  type: 'object',
  properties: {
    kind: { type: 'string' },
    label: { type: 'string' },
    code: { type: 'string' },
    gated: { type: 'string' },
    locked: { type: 'string' },
    frozen: { type: 'string' },
    advanced: { type: 'string' },
  },
};

function reported(form: FormViewSpec, opts: { value?: Record<string, unknown>; createMode?: boolean; readOnly?: boolean; hiddenFields?: string[] } = {}) {
  const calls: string[][] = [];
  render(
    <SchemaForm
      schema={schema}
      form={form}
      value={opts.value ?? {}}
      onChange={() => {}}
      createMode={opts.createMode}
      readOnly={opts.readOnly}
      hiddenFields={opts.hiddenFields}
      onRequiredRowFieldsChange={(fields) => calls.push([...fields].sort())}
    />,
  );
  return calls;
}

const form: FormViewSpec = {
  type: 'simple',
  sections: [
    {
      label: 'Identity',
      fields: [
        { field: 'label', required: true },
        // Not a row override: the schema decides this one, so it is not reported.
        { field: 'code' },
        { field: 'gated', required: true, visibleWhen: { dialect: 'cel', source: "data.kind == 'shown'" } },
        { field: 'locked', required: true, readonly: true },
        { field: 'frozen', required: true, immutable: true },
        { field: 'missing_from_schema', required: true },
      ],
    },
    {
      label: 'Advanced',
      collapsible: true,
      collapsed: true,
      fields: [{ field: 'advanced', required: true }],
    },
  ],
};

afterEach(() => cleanup());

describe('SchemaForm reports the required rows it offers (objectstack#28179)', () => {
  it('reports an offered required row, including one in a collapsed section', () => {
    const calls = reported(form, { createMode: true });
    expect(calls.at(-1)).toEqual(['advanced', 'frozen', 'label']);
  });

  it('leaves out a row its predicate hides, until the predicate shows it', () => {
    expect(reported(form, { createMode: true }).at(-1)).not.toContain('gated');
    cleanup();
    expect(reported(form, { createMode: true, value: { kind: 'shown' } }).at(-1)).toContain('gated');
  });

  it('leaves out read-only rows: `readonly`, `immutable` outside create, and a read-only form', () => {
    expect(reported(form, { createMode: false }).at(-1)).toEqual(['advanced', 'label']);
    cleanup();
    expect(reported(form, { readOnly: true }).at(-1) ?? []).toEqual([]);
  });

  it('leaves out a row the host hides', () => {
    expect(reported(form, { createMode: true, hiddenFields: ['label'] }).at(-1)).toEqual(['advanced', 'frozen']);
  });

  it('reports nothing for a form that falls back to the flat face (no layout row matches the schema)', () => {
    const calls = reported({ type: 'simple', sections: [{ label: 'X', fields: [{ field: 'nope', required: true }] }] });
    expect(calls.flat()).toEqual([]);
  });

  it('reports none once the sectioned form unmounts', () => {
    const calls: string[][] = [];
    const { unmount } = render(
      <SchemaForm schema={schema} form={form} value={{}} onChange={() => {}} onRequiredRowFieldsChange={(f) => calls.push([...f])} />,
    );
    expect(calls.at(-1)?.length).toBeGreaterThan(0);
    unmount();
    expect(calls.at(-1)).toEqual([]);
  });
});
