/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Studio app wizard saves a document the platform accepts and loses
 * nothing it stored (objectui#10867).
 *
 * `CreateAppPage` and `EditAppPage` save through `client.meta.saveItem('app',
 * …)`, and the platform's write door judges that body with
 * `@objectstack/spec`'s strict `AppSchema`. Each case drives the REAL
 * `AppCreationWizard` through its steps and reads what reaches `saveItem`:
 *
 *   1. "Add separator" wrote `{ id, type: 'separator', label: '' }`, and the
 *      spec's separator branch declares no `label`, so the save was refused
 *      (`unrecognized_keys` `['label']` at `navigation.N`). The separator now
 *      carries only `type` and `id`.
 *   2. The edit save replaced the stored `branding` with the wizard's, which
 *      maintains only the logo, primary colour and favicon, so a stored
 *      `accentColor` (declared by the spec's `AppBrandingSchema`, read by the
 *      console) was dropped on every edit. It is now kept.
 *   3. The Layout control persisted nothing (the spec declares no app layout)
 *      and is gone, with `AppWizardDraft.layout`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';
import type { AppWizardDraft, ObjectSelection } from '@object-ui/types';

const saveItem = vi.fn().mockResolvedValue({});
const apps: Record<string, unknown>[] = [];
let routeParams: Record<string, string> = {};

vi.mock('react-router-dom', () => ({
  useParams: () => routeParams,
  useNavigate: () => vi.fn(),
}));

const OBJECTS = [{ name: 'account', label: 'Account', pluralLabel: 'Accounts', icon: 'Building' }];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ getClient: () => ({ meta: { saveItem } }) }),
    useMetadata: () => ({ apps, objects: OBJECTS, refresh: () => Promise.resolve() }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AppCreationWizard } from '../AppCreationWizard';
import { CreateAppPage } from '../pages/CreateAppPage';
import { EditAppPage } from '../pages/EditAppPage';

/** The spec's issues for a document, as `code` plus the path and keys it names. */
const specIssues = (doc: unknown) => {
  const r = SpecAppSchema.safeParse(doc);
  return r.success
    ? null
    : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), keys: (i as { keys?: string[] }).keys }));
};

const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

/** The one body `saveItem` received. */
async function savedBody(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
  const [type, name, body] = saveItem.mock.calls[0];
  expect([type, name]).toEqual(['app', 'acme_crm']);
  return body as Record<string, unknown>;
}

beforeEach(() => {
  saveItem.mockClear();
  apps.length = 0;
  routeParams = {};
  localStorage.clear();
});
afterEach(() => cleanup());

describe('objectui#10867 — member 1: a wizard app with a separator saves a document the spec accepts', () => {
  async function createWithSeparator() {
    render(<CreateAppPage />);
    fireEvent.change(screen.getByTestId('app-name-input'), { target: { value: 'acme_crm' } });
    fireEvent.change(screen.getByTestId('app-title-input'), { target: { value: 'Acme CRM' } });
    next(); // → objects
    fireEvent.click(screen.getByTestId('object-card-account'));
    next(); // → navigation, generated from the selected object
    fireEvent.click(screen.getByTestId('add-separator-btn'));
    next(); // → branding
    fireEvent.click(screen.getByTestId('wizard-complete'));
    return savedBody();
  }

  it('the saved document parses green through the spec `AppSchema`', async () => {
    const body = await createWithSeparator();
    expect(specIssues(body)).toBeNull();
  });

  it('the saved separator carries only `type` and `id`', async () => {
    const body = await createWithSeparator();
    const navigation = body.navigation as Array<Record<string, unknown>>;
    expect(navigation.map((item) => item.type)).toEqual(['object', 'separator']);
    expect(Object.keys(navigation[1]).sort()).toEqual(['id', 'type']);
  });

  it('CONTROL — the separator the wizard used to write is refused by the spec, so the pass above is not vacuous', async () => {
    const body = await createWithSeparator();
    const navigation = body.navigation as Array<Record<string, unknown>>;
    const old = { ...body, navigation: [navigation[0], { ...navigation[1], label: '' }] };
    expect(specIssues(old)).toEqual([{ code: 'unrecognized_keys', path: 'navigation.1', keys: ['label'] }]);
  });
});

describe('objectui#10867 — member 2: an edit keeps every stored `branding` key the spec declares', () => {
  const STORED = {
    name: 'acme_crm',
    label: 'Acme CRM',
    navigation: [{ id: 'account', type: 'object', label: 'Accounts', objectName: 'account' }],
    branding: { logo: '/acme.svg', primaryColor: '#2563eb', accentColor: '#f59e0b', favicon: '/acme.ico' },
  };

  async function editThrough(stored: Record<string, unknown>, onBranding?: () => void) {
    apps.push(stored);
    routeParams = { editAppName: 'acme_crm' };
    render(<EditAppPage />);
    next(); // → objects
    next(); // → navigation
    next(); // → branding
    onBranding?.();
    fireEvent.click(screen.getByTestId('wizard-complete'));
    return savedBody();
  }

  it('a stored `accentColor` survives the edit round trip', async () => {
    const body = await editThrough(STORED);
    expect(body.branding).toEqual(STORED.branding);
    expect(specIssues(body)).toBeNull();
  });

  it('the keys the wizard maintains come from the wizard; `accentColor` from storage', async () => {
    const body = await editThrough(STORED, () =>
      fireEvent.change(screen.getByTestId('branding-color-input'), { target: { value: '#dc2626' } }),
    );
    expect(body.branding).toEqual({ ...STORED.branding, primaryColor: '#dc2626' });
  });

  it('a logo the author clears saves as cleared, not as the stored value', async () => {
    // Guards the merge's order: the wizard's `branding` wins for the keys it
    // maintains, empty strings included, so a later "drop empty values" tidy-up
    // would bring a removed logo back from storage.
    const body = await editThrough(STORED, () =>
      fireEvent.change(screen.getByTestId('branding-logo-input'), { target: { value: '' } }),
    );
    expect(body.branding).toEqual({ ...STORED.branding, logo: '' });
  });

  it('CONTROL — a stored `branding` key the spec does not declare is not echoed into the save', async () => {
    const body = await editThrough({
      ...STORED,
      branding: { ...STORED.branding, fontFamily: 'Inter' },
    });
    expect(body.branding).toEqual(STORED.branding);
    expect(specIssues(body)).toBeNull();
  });
});

describe('objectui#10867 — member 3: the wizard has no Layout control and its draft no `layout`', () => {
  it('the basic step renders no layout choice and does not mention one', () => {
    const { container } = render(<AppCreationWizard />);
    expect(container.querySelectorAll('[data-testid^="app-layout-"]')).toHaveLength(0);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByText(/layout/i)).toHaveLength(0);
  });

  it('the draft the wizard completes with carries no `layout` key', () => {
    const onComplete = vi.fn();
    const objects: ObjectSelection[] = [];
    render(<AppCreationWizard availableObjects={objects} onComplete={onComplete} />);
    fireEvent.change(screen.getByTestId('app-name-input'), { target: { value: 'acme_crm' } });
    fireEvent.change(screen.getByTestId('app-title-input'), { target: { value: 'Acme CRM' } });
    next();
    next();
    next();
    fireEvent.click(screen.getByTestId('wizard-complete'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const draft = onComplete.mock.calls[0][0] as AppWizardDraft;
    expect(Object.prototype.hasOwnProperty.call(draft, 'layout')).toBe(false);
  });
});
