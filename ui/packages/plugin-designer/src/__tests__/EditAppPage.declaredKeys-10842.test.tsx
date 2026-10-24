/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Editing an app saves a document the platform accepts (objectui#10842).
 *
 * `EditAppPage` merges the wizard's output onto the app it loaded, to keep the
 * keys the wizard does not maintain. It used to spread the WHOLE served app, so
 * a row stored before `@objectstack/spec`'s `AppSchema` closed — served back
 * with the old wizard's top-level `type` / `title` / `logo` / `favicon` /
 * `layout` — was echoed into the save, and the door refuses those keys
 * (`422 INVALID_METADATA`, `unrecognized_keys`). The save now keeps only keys
 * the spec's `AppSchema` declares.
 *
 * The pre-fill no longer falls back onto the retired spellings either: the
 * logo and favicon come from `branding` only, the title from `label` only.
 *
 * The wizard is stubbed to complete with the draft the page pre-filled, so
 * what reaches `saveItem` is exactly the page's merge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';
import type { AppWizardDraft } from '@object-ui/types';

const saveItem = vi.fn().mockResolvedValue({});
const apps: Record<string, unknown>[] = [];
let prefilled: Partial<AppWizardDraft> | undefined;

vi.mock('react-router-dom', () => ({
  useParams: () => ({ editAppName: 'acme_crm' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ getClient: () => ({ meta: { saveItem } }) }),
    useMetadata: () => ({ apps, objects: [], refresh: () => Promise.resolve() }),
  };
});

vi.mock('../AppCreationWizard', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AppCreationWizard: ({ initialDraft, onComplete }: {
      initialDraft?: Partial<AppWizardDraft>;
      onComplete?: (draft: AppWizardDraft) => void;
    }) => {
      prefilled = initialDraft;
      return (
        <button type="button" onClick={() => onComplete?.({ objects: [], ...initialDraft } as AppWizardDraft)}>
          finish
        </button>
      );
    },
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { EditAppPage } from '../pages/EditAppPage';

/** The declared keys the wizard does not maintain — the merge must keep them. */
const UNMAINTAINED = { requiredPermissions: ['crm.read'], isDefault: true };

/**
 * A row stored before the spec's `AppSchema` closed, as the list door serves
 * it: the old wizard's top-level keys, and the read decoration `_diagnostics`.
 */
const LEGACY = {
  name: 'acme_crm',
  label: 'Acme CRM',
  type: 'app',
  title: 'Acme CRM (old title)',
  logo: '/legacy-logo.svg',
  favicon: '/legacy.ico',
  layout: 'header',
  navigation: [{ id: 'account', type: 'object', label: 'Accounts', objectName: 'account' }],
  branding: { primaryColor: '#2563eb' },
  ...UNMAINTAINED,
  _diagnostics: { valid: false },
};

async function saveOf(served: Record<string, unknown>) {
  apps.length = 0;
  apps.push(served);
  render(<EditAppPage />);
  fireEvent.click(screen.getByRole('button', { name: 'finish' }));
  await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
  const [type, name, body] = saveItem.mock.calls[0];
  return { type, name, body: body as Record<string, unknown> };
}

beforeEach(() => {
  saveItem.mockClear();
  prefilled = undefined;
});
afterEach(() => cleanup());

describe('EditAppPage saves only keys the spec `AppSchema` declares (objectui#10842)', () => {
  it('a legacy row saves a document the spec accepts', async () => {
    const { type, name, body } = await saveOf(LEGACY);
    expect([type, name]).toEqual(['app', 'acme_crm']);
    const r = SpecAppSchema.safeParse(body);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('drops the refused keys and the read decoration, and keeps the declared ones the wizard does not own', async () => {
    const { body } = await saveOf(LEGACY);
    for (const key of ['type', 'title', 'logo', 'favicon', 'layout', '_diagnostics']) {
      expect(Object.prototype.hasOwnProperty.call(body, key), key).toBe(false);
    }
    expect(body).toMatchObject(UNMAINTAINED);
    expect(body.label).toBe('Acme CRM');
  });

  it('CONTROL — the served row itself carries keys the spec refuses, so the pass above is not vacuous', () => {
    const r = SpecAppSchema.safeParse(LEGACY);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });
});

describe('EditAppPage pre-fills from the declared spellings only (objectui#10842)', () => {
  it('reads no top-level `logo` / `favicon` fallback, and the title from `label`', async () => {
    await saveOf(LEGACY);
    expect(prefilled?.branding).toMatchObject({ logo: '', favicon: '' });
    expect(prefilled?.title).toBe('Acme CRM');
  });

  it('CONTROL — `branding.logo` and `branding.favicon` are pre-filled', async () => {
    await saveOf({
      name: 'acme_crm',
      label: 'Acme CRM',
      branding: { logo: '/acme.svg', favicon: '/acme.ico', primaryColor: '#2563eb' },
    });
    expect(prefilled?.branding).toMatchObject({ logo: '/acme.svg', favicon: '/acme.ico' });
  });
});
