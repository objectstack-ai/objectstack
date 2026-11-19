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

/** The objects as their authors stored them (the untranslated layers). */
const AUTHORED: Record<string, Record<string, unknown>> = {
  account: { name: 'account', label: 'Account', pluralLabel: 'Accounts', icon: 'Building' },
  invoice: { name: 'invoice', label: 'Invoice', icon: 'Receipt' },
  bare_thing: { name: 'bare_thing' },
  people: { name: 'people', label: 'Person', pluralLabel: 'People' },
  project: { name: 'project', label: 'Project', pluralLabel: 'Projects' },
  task: { name: 'task', label: 'Task', pluralLabel: 'Tasks' },
  packaged_thing: { name: 'packaged_thing', label: 'Widget', pluralLabel: 'Widgets' },
  unreadable: { name: 'unreadable', label: 'Secret', pluralLabel: 'Secrets' },
};

/**
 * The same objects as the metadata list SERVES them to a zh-CN console: every
 * label translated (objectstack#35101). `project`'s translated plural differs
 * from its translated label; `task`'s translated plural equals it.
 */
const OBJECTS = [
  { name: 'account', label: '客户', pluralLabel: '客户列表', icon: 'Building' },
  { name: 'invoice', label: '发票', icon: 'Receipt' },
  { name: 'bare_thing' },
  { name: 'people', label: '人员', pluralLabel: '人员' },
  { name: 'project', label: '项目', pluralLabel: '项目列表' },
  { name: 'task', label: '任务', pluralLabel: '任务' },
  { name: 'packaged_thing', label: '部件', pluralLabel: '部件列表', _packageId: 'com.acme.widgets' },
  { name: 'unreadable', label: '机密', pluralLabel: '机密列表' },
];

const getAuthoredItem = vi.fn(async (type: string, name: string, _options?: { packageId?: string }) => {
  expect(type).toBe('object');
  if (name === 'unreadable') throw Object.assign(new Error('Forbidden'), { status: 403 });
  return AUTHORED[name] ?? null;
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ getClient: () => ({ meta: { saveItem } }), getAuthoredItem }),
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
  next(); // → navigation, generated from the selected objects' authored reads
  await screen.findByTestId('wizard-step-navigation-content');
  expect(getAuthoredItem).toHaveBeenCalledTimes(OBJECTS.length);
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
  getAuthoredItem.mockClear();
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

describe('objectstack#35101 — the generated entry’s label is decided from the AUTHORED object, never the served one', () => {
  it('a zh-CN session stores the authored plural, not the served translation', async () => {
    const entry = entryFor(await createWithAllObjects(), 'project');
    expect(entry.label).toBe('Projects');
  });

  it('a translated plural equal to the translated label does not suppress the authored plural', async () => {
    const entry = entryFor(await createWithAllObjects(), 'task');
    expect(entry.label).toBe('Tasks');
  });

  it('no stored label carries served (translated) text', async () => {
    const labels = (await createWithAllObjects()).map((e) => e.label).filter((l) => l !== undefined);
    expect(labels.some((l) => /\p{Script=Han}/u.test(String(l)))).toBe(false);
  });

  it('a packaged object is read at the package the served object came from', async () => {
    entryFor(await createWithAllObjects(), 'packaged_thing');
    expect(getAuthoredItem).toHaveBeenCalledWith('object', 'packaged_thing', { packageId: 'com.acme.widgets' });
    expect(getAuthoredItem).toHaveBeenCalledWith('object', 'account', {});
  });

  it('a refused authored read writes no label: the entry inherits, never the served plural', async () => {
    const entry = entryFor(await createWithAllObjects(), 'unreadable');
    expect(entry).not.toHaveProperty('label');
  });
});
