// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The view anchor's create form gates its two layout pickers on `viewKind`
 * through `visibleWhen` (objectui#12696).
 *
 * `anchors.ts` used to write the retired `visibleOn` spelling on the create
 * schema's `kind` and `formType` properties, and `SchemaForm` folded it back in
 * with `visibleWhen ?? visibleOn`. Both halves now speak `visibleWhen` only, so
 * this renders the REAL registered create schema (not a hand-written mirror)
 * and flips `viewKind`: if the anchor regresses to `visibleOn`, both pickers
 * show for every family and the hidden-picker assertions go red.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import { registerBuiltinAnchors } from './anchors';
import { getMetadataResource } from './registry';

registerBuiltinAnchors();
afterEach(cleanup);

function viewCreateSchema(): Record<string, unknown> {
  const schema = getMetadataResource('view')?.createSchema;
  if (!schema) throw new Error('view resource must define createSchema');
  return schema as Record<string, unknown>;
}

describe('view create form — layout pickers follow viewKind via visibleWhen (objectui#12696)', () => {
  it('a list draft shows the list layout picker and hides the form one', () => {
    render(<SchemaForm schema={viewCreateSchema()} value={{ viewKind: 'list' }} onChange={() => {}} />);
    expect(screen.getByText('List layout')).toBeInTheDocument();
    expect(screen.queryByText('Form layout')).not.toBeInTheDocument();
  });

  it('a form draft shows the form layout picker and hides the list one', () => {
    render(<SchemaForm schema={viewCreateSchema()} value={{ viewKind: 'form' }} onChange={() => {}} />);
    expect(screen.getByText('Form layout')).toBeInTheDocument();
    expect(screen.queryByText('List layout')).not.toBeInTheDocument();
  });
});
