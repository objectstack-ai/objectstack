/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12213 — a field-backed action param's help line reads the field's
 * `inlineHelpText`, in the order the record form reads it.
 *
 * `resolveActionParam` (`@object-ui/fields`) gives a field-backed param
 * (`{ field: 'x' }`) the field's help text when the param declares none of its
 * own. It read `field.help ?? field.description`, so the key the spec declares
 * for a field's help (`FieldSchema.inlineHelpText`, which Studio's object field
 * inspector writes) never reached the dialog. It now reads through
 * `fieldHelpText`, the one read the record form shares: `inlineHelpText`, then
 * `description`, an empty string reading as absent. A served `help` key is
 * ignored (ruled on objectui#12213: only an objectstack server older than spec
 * 17.7.0 serves one, and 17.7.0 serves the translated text on `description`).
 *
 * Each case resolves a REAL param against an object definition and renders the
 * real `ActionParamDialog`, so what is asserted is the line a user reads under
 * the control, not a field of the resolved object alone.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { resolveActionParams, type RawActionParam } from '@object-ui/fields';
import { ActionParamDialog } from './ActionParamDialog';

const TICKET = {
  name: 'ticket',
  fields: {
    note: { type: 'text', label: 'Note', inlineHelpText: 'Shown under the note', description: 'The note description' },
    summary: { type: 'text', label: 'Summary', description: 'The summary description' },
    blank: { type: 'text', label: 'Blank', inlineHelpText: '', description: 'The blank description' },
    served: { type: 'text', label: 'Served', help: 'Served translated help', description: 'Served source description' },
    helpOnly: { type: 'text', label: 'Help only', help: 'Served help alone' },
    plain: { type: 'text', label: 'Plain' },
  },
};

const resolve = (params: RawActionParam[]) =>
  resolveActionParams(params, {
    objectName: 'ticket',
    objects: [TICKET] as never,
    fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
  });

/** Resolve ONE field-backed param, render the dialog, return its control. */
async function openFor(param: RawActionParam) {
  const params = resolve([param]);
  render(<ActionParamDialog state={{ open: true, params, resolve: vi.fn() }} onOpenChange={() => {}} />);
  return { param: params[0], input: await screen.findByLabelText(params[0].label) };
}

afterEach(() => cleanup());

describe('objectui#12213 — a field-backed param’s help line reads `inlineHelpText`', () => {
  it('draws the field’s `inlineHelpText` under the control, over its `description`', async () => {
    const { param, input } = await openFor({ field: 'note' });
    expect(param.helpText).toBe('Shown under the note');
    const help = screen.getByText('Shown under the note');
    expect(input.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('The note description')).toBeNull();
  });

  it('CONTROL: a field with only `description` still lends it', async () => {
    const { param } = await openFor({ field: 'summary' });
    expect(param.helpText).toBe('The summary description');
    expect(screen.getByText('The summary description')).toBeTruthy();
  });

  it('an empty `inlineHelpText` reads as absent: the description is drawn', async () => {
    const { param } = await openFor({ field: 'blank' });
    expect(param.helpText).toBe('The blank description');
    expect(screen.getByText('The blank description')).toBeTruthy();
  });

  it('a served `help` key is ignored, as on the record form: the field lends its `description`', async () => {
    const { param } = await openFor({ field: 'served' });
    expect(param.helpText).toBe('Served source description');
    expect(screen.getByText('Served source description')).toBeTruthy();
    expect(screen.queryByText('Served translated help')).toBeNull();
  });

  it('a field whose only help is a served `help` key lends none', async () => {
    const { param } = await openFor({ field: 'helpOnly' });
    expect(param.helpText).toBeUndefined();
    expect(screen.queryByText('Served help alone')).toBeNull();
  });

  it('the param’s own `helpText` still wins over the field’s `inlineHelpText`', async () => {
    const { param } = await openFor({ field: 'note', helpText: 'Param help' });
    expect(param.helpText).toBe('Param help');
    expect(screen.getByText('Param help')).toBeTruthy();
    expect(screen.queryByText('Shown under the note')).toBeNull();
  });

  it('CONTROL: a field with no help text lends none', async () => {
    const { param } = await openFor({ field: 'plain' });
    expect(param.helpText).toBeUndefined();
  });
});
