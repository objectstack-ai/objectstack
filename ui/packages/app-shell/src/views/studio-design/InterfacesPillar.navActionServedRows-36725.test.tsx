// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36725 — a global action opened from an app nav leaf (the
 * Interfaces pillar's `action` case) is designed in the rail's home inspector,
 * the action designer. That host hands it the served `action` type row, so the
 * designer draws its refusal catalogue (`refusals`) and declared texts
 * (`texts`) with their served rows: the key-only record control and the row's
 * help text, where with no schema and no form it drew neither row at all.
 *
 * The real pillar, rail and action designer; the type row is built from the
 * spec the way the server builds it (`actionForm`, `ActionSchema` through
 * `z.toJSONSchema(…, { io: 'input' })`). The stand-ins are the metadata
 * client and the data adapter.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { ActionSchema, actionForm } from '@objectstack/spec/ui';

const ACTION_JSON_SCHEMA = z.toJSONSchema(ActionSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

/** The served row's help text for `key`, read off the form the server serves. */
function servedHelpText(key: string): string {
  for (const section of actionForm.sections ?? []) {
    for (const row of section.fields ?? []) {
      if (typeof row !== 'string' && row.field === key) return String(row.helpText);
    }
  }
  throw new Error(`actionForm declares no ${key} row`);
}

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
  { id: 'nav_sign', type: 'action', label: 'Sign', actionDef: { actionName: 'sign_now' } },
];

/** A global script action: no `objectName`, as a nav action is by construction. */
const SIGN = {
  name: 'sign_now',
  label: 'Sign Now',
  type: 'script',
  locations: ['list_toolbar'],
  body: { language: 'js', source: "throw { code: 'SIGN_IN_REQUIRED' };" },
  refusals: { SIGN_IN_REQUIRED: { message: 'Sign in first.', status: 401 } },
  texts: { email_subject: { message: 'Task signed' } },
};

const ACTION_TYPE_ROW = {
  type: 'action',
  name: 'action',
  label: 'Action',
  domain: 'ui',
  allowEnvironmentOverlay: true,
  allowRuntimeCreate: true,
  schema: ACTION_JSON_SCHEMA,
  form: actionForm,
};

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'action' && name === 'sign_now') return { effective: SIGN };
    return { effective: { name, kind: 'blocks', blocks: [] } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
  withPreviewDrafts() { return this; },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [ACTION_TYPE_ROW] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

// The source reaches a dynamic import of it: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';
import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { ActionPreview } from '../metadata-admin/previews/ActionPreview';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

// The `action` preview alone, as in StudioDesignSurface.interfacesAction.test.tsx:
// it is what makes the leaf an editable surface, so the rail mounts its home inspector.
registerMetadataPreview('action', ActionPreview);
registerBuiltinInspectors();

afterEach(cleanup);

describe('Interfaces pillar — a nav action draws refusals and texts from their served rows (objectstack#36725)', () => {
  it('draws each as the key-only record control with the served help text, and no raw JSON', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTitle('action · sign_now'));
    await screen.findByText(t('engine.inspector.moreFields', 'en'), {}, { timeout: 8000 });

    // No editor on the rail holds either record as JSON text (the raw JSON face).
    const jsonHolders = Array.from(document.querySelectorAll('textarea')).filter(
      (el) => el.value.includes('"SIGN_IN_REQUIRED"') || el.value.includes('"email_subject"'),
    );
    expect(jsonHolders).toEqual([]);
    // The served rows' help text, and the key-only control drawing each entry under its key.
    expect(screen.getByText(servedHelpText('refusals'))).toBeInTheDocument();
    expect(screen.getByText(servedHelpText('texts'))).toBeInTheDocument();
    const rows = screen.getByTestId('action-served-rows');
    expect(within(rows).getByText('SIGN_IN_REQUIRED', { selector: 'span' })).toBeInTheDocument();
    expect(within(rows).getByText('email_subject', { selector: 'span' })).toBeInTheDocument();
  });
});
