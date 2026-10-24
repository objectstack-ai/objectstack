// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11252 — an unset enum driver-config property shows Studio's own
 * "Select…" word in the designer's locale, not an English literal.
 *
 * The create/edit dialog builds its config form from the driver catalog's JSON
 * Schema (`GET /api/v1/datasources/drivers`). An `enum` property with no value
 * rendered `SelectValue placeholder="Select…"`, so the named producer — the
 * Turso driver's optional `mode` (`TursoTransportModeSchema.optional()` in
 * objectstack's spec: `local | replica | remote`, no default) — read English
 * under every locale. It now reads `engine.form.selectEllipsis` from Studio's
 * own table, the word `SchemaForm`'s enum selects already show.
 *
 * The expectation is read from that table rather than retyped, and the guard
 * below proves the zh row is a real zh row, so no case can pass on a missing
 * key or on an English copy.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  fetch: (async () => undefined) as unknown as (url: string) => Promise<unknown>,
  // STABLE identity, like the real memoized client.
  metadataClient: {},
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => (url: string) => state.fetch(url),
}));
vi.mock('../useMetadata.js', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { t } from '../i18n';
import { DatasourceResourcePage } from './DatasourceResourcePage';

afterEach(cleanup);

/** A Turso-shaped catalog entry: `url` plus the optional, default-less `mode` enum. */
function tursoDriver(mode: Record<string, unknown> = {}) {
  return {
    id: 'turso',
    label: 'Turso',
    configSchema: {
      properties: {
        url: { type: 'string', title: 'URL' },
        mode: {
          type: 'string',
          enum: ['local', 'replica', 'remote'],
          title: 'Transport mode',
          description: 'Force a transport mode instead of inferring it from `url`',
          ...mode,
        },
      },
      required: ['url'],
    },
  };
}

function serve(driver: ReturnType<typeof tursoDriver>) {
  const ok = (data: unknown) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, data }),
  });
  state.fetch = async (url: string) =>
    url.endsWith('/api/v1/datasources/drivers') ? ok({ drivers: [driver] }) : ok({ datasources: [] });
}

/** Opens the create dialog (it preselects the only driver) and returns the `mode` trigger. */
async function openModeSelect(language: string, driver = tursoDriver()) {
  serve(driver);
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /New datasource/ }));
  const label = await screen.findByText('Transport mode');
  const trigger = label.parentElement?.querySelector('[role="combobox"]');
  expect(trigger, 'the `mode` enum renders a select trigger beside its label').toBeTruthy();
  return trigger as HTMLElement;
}

describe('engine.form.selectEllipsis is a real row in both locales (non-vacuity guard)', () => {
  it('is translated, not echoed and not English', () => {
    const zh = t('engine.form.selectEllipsis', 'zh-CN');
    expect(zh, 'a missing zh row echoes the key back').not.toBe('engine.form.selectEllipsis');
    expect(zh, 'the zh row must not be the English one').not.toBe(t('engine.form.selectEllipsis', 'en-US'));
  });
});

describe('objectui#11252 — an unset driver-config enum reads Studio\'s `engine.form.selectEllipsis`', () => {
  it('under zh-CN, the Turso `mode` select shows the zh row, not the en word', async () => {
    const trigger = await openModeSelect('zh-CN');
    expect(trigger).toHaveTextContent(t('engine.form.selectEllipsis', 'zh-CN'));
    expect(trigger).not.toHaveTextContent(t('engine.form.selectEllipsis', 'en-US'));
  });

  it('under en, the Turso `mode` select shows the en row', async () => {
    const trigger = await openModeSelect('en');
    expect(trigger).toHaveTextContent(t('engine.form.selectEllipsis', 'en-US'));
  });

  it('CONTROL — an enum with a declared default renders its value, not the placeholder', async () => {
    const trigger = await openModeSelect('zh-CN', tursoDriver({ default: 'remote' }));
    expect(trigger).toHaveTextContent('remote');
    expect(trigger).not.toHaveTextContent(t('engine.form.selectEllipsis', 'zh-CN'));
  });
});
