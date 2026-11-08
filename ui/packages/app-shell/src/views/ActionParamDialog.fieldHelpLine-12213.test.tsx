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

/**
 * objectstack#28266 — a param's own `helpText` may be an inline per-locale map
 * (`{ en, 'zh-CN' }`), the form an inline action — a page button's, which no
 * translation bundle reaches — writes its hint in. The resolver narrows it for
 * the active language exactly as it narrows `label`, so the line under the
 * control is the viewer's language, and it still wins over the field's help.
 */
describe('objectstack#28266 — a param’s own `helpText` locale map resolves to the active language', () => {
  const ROLE_HELP = { en: 'Owner: full control.', 'zh-CN': '所有者：完全控制。', 'ja-JP': '所有者：完全な管理権限。' };

  async function openIn(locale: string, param: RawActionParam) {
    const params = resolveActionParams([param], {
      objectName: 'ticket',
      objects: [TICKET] as never,
      fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
      locale,
    });
    render(<ActionParamDialog state={{ open: true, params, resolve: vi.fn() }} onOpenChange={() => {}} />);
    return { param: params[0], input: await screen.findByLabelText(params[0].label) };
  }

  it('a zh-CN session reads the zh-CN entry under the control, over the field’s help', async () => {
    const { param, input } = await openIn('zh-CN', { field: 'note', helpText: ROLE_HELP as never });
    expect(param.helpText).toBe('所有者：完全控制。');
    const help = screen.getByText('所有者：完全控制。');
    expect(input.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Shown under the note')).toBeNull();
  });

  it('an inline param resolves the map too; a locale the map omits reads the shared fallback (en)', async () => {
    const { param } = await openIn('es-ES', { name: 'role', label: 'Role', type: 'text', helpText: ROLE_HELP as never });
    expect(param.helpText).toBe('Owner: full control.');
  });

  it('CONTROL: an envelope with no `source` is not a map: the field’s help is drawn', async () => {
    const { param } = await openIn('zh-CN', { field: 'note', helpText: { dialect: 'template' } as never });
    expect(param.helpText).toBe('Shown under the note');
  });
});
