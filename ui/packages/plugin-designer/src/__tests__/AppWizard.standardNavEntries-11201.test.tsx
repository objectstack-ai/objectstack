/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11201 (ruling B, stage 1) — the app wizard writes the object
 * entries it generates with no `label`, unless it has text inheritance cannot
 * produce.
 *
 * Ruling B keeps one rule, the spec's: a present label renders verbatim, and an
 * absent one inherits its target's current label at render time, which is the
 * text that localises. The wizard generated one entry per selected object with
 * `label: pluralLabel || label`, and `CreateAppPage` / `EditAppPage` hand it
 * `label: obj.label || obj.name`, so an unlabelled object's entry stored the
 * object's MACHINE NAME, and a labelled one stored a copy of the label the
 * entry would inherit anyway.
 *
 * Driven through the REAL `CreateAppPage` → `AppCreationWizard`, reading the
 * body that reaches `saveItem`:
 *   - an unlabelled object's entry carries NO `label` key;
 *   - a singular-labelled object's entry carries NO `label` key;
 *   - a declared plural label that spells the object's machine name is not
 *     written either;
 *   - CONTROL: a declared plural label inheritance cannot produce is written.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';

const saveItem = vi.fn().mockResolvedValue({});

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
}));

const OBJECTS = [
  { name: 'account', label: 'Account', pluralLabel: 'Accounts', icon: 'Building' },
  { name: 'invoice', label: 'Invoice', icon: 'Receipt' },
  { name: 'bare_thing' },
  { name: 'people', label: 'Person', pluralLabel: 'People' },
];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ getClient: () => ({ meta: { saveItem } }) }),
    useMetadata: () => ({ apps: [], objects: OBJECTS, refresh: () => Promise.resolve() }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CreateAppPage } from '../pages/CreateAppPage';

const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

/** Create an app with every object selected; return the navigation `saveItem` received. */
async function createWithAllObjects(): Promise<Array<Record<string, unknown>>> {
  render(<CreateAppPage />);
  fireEvent.change(screen.getByTestId('app-name-input'), { target: { value: 'acme_crm' } });
  fireEvent.change(screen.getByTestId('app-title-input'), { target: { value: 'Acme CRM' } });
  next(); // → objects
  for (const o of OBJECTS) fireEvent.click(screen.getByTestId(`object-card-${o.name}`));
  next(); // → navigation, generated from the selected objects
  next(); // → branding
  fireEvent.click(screen.getByTestId('wizard-complete'));
  await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
  const [type, name, body] = saveItem.mock.calls[0];
  expect([type, name]).toEqual(['app', 'acme_crm']);
  expect(SpecAppSchema.safeParse(body).success).toBe(true);
  return (body as { navigation: Array<Record<string, unknown>> }).navigation;
}

const entryFor = (navigation: Array<Record<string, unknown>>, objectName: string) => {
  const entry = navigation.find((e) => e.type === 'object' && e.objectName === objectName);
  expect(entry, `no generated entry for ${objectName}`).toBeDefined();
  return entry as Record<string, unknown>;
};

beforeEach(() => {
  saveItem.mockClear();
  localStorage.clear();
});
afterEach(() => cleanup());

describe('objectui#11201 — the wizard’s generated object entries are label-less standard entries', () => {
  it('an unlabelled object’s entry carries NO `label` key (it used to store the machine name)', async () => {
    const entry = entryFor(await createWithAllObjects(), 'bare_thing');
    expect(entry).not.toHaveProperty('label');
  });

  it('a singular-labelled object’s entry carries NO `label` key: it inherits that label', async () => {
    const entry = entryFor(await createWithAllObjects(), 'invoice');
    expect(entry).not.toHaveProperty('label');
    expect(entry).toMatchObject({ id: 'invoice', type: 'object', icon: 'Receipt', objectName: 'invoice' });
  });

  it('a declared plural label that spells the object’s machine name is not written', async () => {
    const entry = entryFor(await createWithAllObjects(), 'people');
    expect(entry).not.toHaveProperty('label');
  });

  it('CONTROL — a declared plural label inheritance cannot produce is written verbatim', async () => {
    const entry = entryFor(await createWithAllObjects(), 'account');
    expect(entry.label).toBe('Accounts');
  });
});
