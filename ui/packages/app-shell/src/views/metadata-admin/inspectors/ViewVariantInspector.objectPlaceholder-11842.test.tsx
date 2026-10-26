// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11842 — the view inspector's *Object* suggests no object of another
 * app.
 *
 * The view's object input is a combobox over the live object catalog. Its
 * placeholder came from the locale row `engine.inspector.view.objectPlaceholder`
 * and read `e.g. crm_lead` (zh `例如：crm_lead`): an example object of another
 * app, which in an app without it suggests a name that will not resolve. The
 * row is gone from every locale at once, and an unbound view's input shows the
 * combobox's own empty prompt, which names no object.
 *
 * Read through the rendered home panel, in both designer locales, with the
 * object catalog answered by a stubbed metadata client.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async () => undefined),
    list: vi.fn(async (type: string) =>
      type === 'object' ? [{ name: 'repairs_repair_ticket', label: 'Repair Ticket' }] : ([] as unknown[]),
    ),
  },
}));
vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return { ...mod, useMetadataClient: () => state.metadataClient };
});

import { ViewDefaultInspector } from './ViewInspector';
import { t } from '../i18n';

afterEach(cleanup);

/** The example objects of other apps Studio's object inputs named before this card. */
const FOREIGN_OBJECTS = ['contract', 'contracts', 'crm_account', 'showcase_task', 'crm_lead'];

/** A list view bound to no object yet: the input shows its empty state. */
function renderUnboundView(locale: 'en-US' | 'zh-CN') {
  render(
    <ViewDefaultInspector
      type="view"
      name="tickets"
      draft={{ name: 'tickets', label: '', list: { type: 'grid', columns: [] } }}
      onPatch={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={locale as never}
    />,
  );
}

describe('the view inspector’s Object suggests no object of another app (objectui#11842)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s — an unbound view’s Object input names no foreign object', async (locale) => {
    renderUnboundView(locale);
    const trigger = screen.getByRole('combobox', { name: t('engine.inspector.view.object', locale) });
    // Past the catalog read, so the trigger shows its empty prompt, not "Loading…".
    await waitFor(() => expect(state.metadataClient.list).toHaveBeenCalledWith('object'));
    await waitFor(() => expect(trigger.textContent).not.toBe(t('engine.inspector.combo.loading', 'en-US')));
    const shown = trigger.textContent ?? '';
    expect(
      FOREIGN_OBJECTS.filter((name) => shown.includes(name)),
      `${locale}: the Object input reads ${JSON.stringify(shown)}`,
    ).toEqual([]);
  });

  // Control: the Label input on the same panel keeps its placeholder, which
  // names a label, not an object. True before this card and after it.
  it.each(['en-US', 'zh-CN'] as const)('%s — the Label input keeps its placeholder', (locale) => {
    renderUnboundView(locale);
    expect(screen.getByPlaceholderText(t('engine.inspector.view.labelPlaceholder', locale))).toBeTruthy();
  });
});
