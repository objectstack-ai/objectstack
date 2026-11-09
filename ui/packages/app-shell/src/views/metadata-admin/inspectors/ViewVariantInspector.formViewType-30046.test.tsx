// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30046 (Scope 8) — a form view's 视图类型 reads a real type.
 *
 * The view inspector's type picker offered the LIST-view types alone (grid,
 * kanban, calendar, …), read off the spec's list-variant schema, for every
 * view it was shown on. A form view's `type` is a form layout (`simple`,
 * `tabbed`, `wizard`, `FormViewSchema.type`), which that roster does not
 * carry, so every form view read 「simple（未找到）」: its own, valid type
 * flagged as not found, beside list types it can never take.
 *
 * The picker now reads the roster of the view's own family: a form view's
 * from the spec's form-variant schema, a list view's unchanged. Both sides
 * are pinned, through the rendered home panel, in both designer locales.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const state = vi.hoisted(() => {
  const metadataClient: Record<string, unknown> = {
    get: vi.fn(async () => undefined),
    list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'crm_lead', label: 'Lead' }] : ([] as unknown[]))),
  };
  // The bound object's field read goes through the draft-overlaid door.
  metadataClient.withPreviewDrafts = () => metadataClient;
  return { metadataClient };
});
vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return { ...mod, useMetadataClient: () => state.metadataClient };
});

import { ViewDefaultInspector } from './ViewInspector';
import { t } from '../i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

// The zh designer strings are a lazy namespace: loaded before any case reads them.
await loadStudioCatalogue('zh');

afterEach(cleanup);

type Locale = 'en-US' | 'zh-CN';

/** A view item as the server serves it: `{ name, object, viewKind, config }` (ADR-0017). */
function renderView(locale: Locale, viewKind: 'form' | 'list', config: Record<string, unknown>) {
  render(
    <ViewDefaultInspector
      type="view"
      name={`crm_lead.${viewKind}`}
      draft={{ name: `crm_lead.${viewKind}`, object: 'crm_lead', viewKind, config }}
      onPatch={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={locale as never}
    />,
  );
  return screen.getByRole('combobox', { name: t('engine.inspector.view.type', locale) });
}

/**
 * The options the open picker offers, by their text: read in the listbox this
 * trigger controls, so a list another case left in the document is never read.
 */
async function optionsOf(trigger: HTMLElement): Promise<string[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await waitFor(() => {
    const id = trigger.getAttribute('aria-controls');
    const el = id ? document.getElementById(id) : null;
    expect(el).not.toBeNull();
    expect(within(el!).queryAllByRole('option').length).toBeGreaterThan(0);
    return el!;
  });
  return within(listbox).getAllByRole('option').map((o) => (o.textContent ?? '').trim());
}

const formType = (value: string, locale: Locale) => t(`engine.inspector.pageBlock.option.formType.${value}`, locale);
const listType = (value: string, locale: Locale) => t(`engine.inspector.view.type.${value}`, locale);

describe('a form view’s 视图类型 reads a real type (objectstack#30046)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s — a form view reads its layout, never flagged as not found', async (locale) => {
    const trigger = renderView(locale, 'form', { type: 'simple', sections: [] });
    expect(trigger.textContent).toContain(formType('simple', locale));
    expect(trigger.textContent).not.toContain(t('engine.form.notFound', locale));
    // The form family's own roster, and none of the list types.
    expect(await optionsOf(trigger)).toEqual([formType('simple', locale), formType('tabbed', locale), formType('wizard', locale)]);
  });

  it.each(['en-US', 'zh-CN'] as const)('%s — a form view with no type reads the spec’s default layout', (locale) => {
    const trigger = renderView(locale, 'form', { sections: [] });
    expect(trigger.textContent).toContain(formType('simple', locale));
    expect(trigger.textContent).not.toContain(listType('grid', locale));
  });

  // The list-view side, unchanged: the same inspector, the list roster.
  it.each(['en-US', 'zh-CN'] as const)('%s — CONTROL: a list view still offers the list types', async (locale) => {
    const trigger = renderView(locale, 'list', { type: 'kanban', columns: ['name'] });
    expect(trigger.textContent).toContain(listType('kanban', locale));
    const offered = await optionsOf(trigger);
    expect(offered).toContain(listType('grid', locale));
    expect(offered).toContain(listType('kanban', locale));
    expect(offered).not.toContain(formType('simple', locale));
  });

  it.each(['en-US', 'zh-CN'] as const)('%s — CONTROL: a list type the spec does not carry is still flagged', (locale) => {
    const trigger = renderView(locale, 'list', { type: 'simple', columns: ['name'] });
    expect(trigger.textContent).toContain(t('engine.form.notFound', locale));
  });
});
