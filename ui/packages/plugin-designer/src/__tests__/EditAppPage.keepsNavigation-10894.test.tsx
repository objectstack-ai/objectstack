/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Editing an app through the wizard keeps its stored navigation
 * (objectui#10894).
 *
 * `EditAppPage` loads the stored app into `AppCreationWizard` and saves what
 * the wizard completes with through `client.meta.saveItem('app', …)`. Leaving
 * the Objects step used to REPLACE `draft.navigation` with one generated
 * object entry per selected object, so every edit, even a title change, saved
 * a stored `[object, separator, group, url]` tree as `[object]`.
 *
 * Leaving the Objects step now fills an EMPTY navigation (the create path, as
 * before) and otherwise merges: an entry is appended for a newly selected
 * object, the entries of a deselected object are dropped wherever they sit, and
 * every other entry is kept as stored, in its position.
 *
 * Each case drives the REAL `EditAppPage` / `CreateAppPage` and wizard to the
 * body `saveItem` receives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';

const saveItem = vi.fn().mockResolvedValue({});
const apps: Record<string, unknown>[] = [];
let routeParams: Record<string, string> = {};

vi.mock('react-router-dom', () => ({
  useParams: () => routeParams,
  useNavigate: () => vi.fn(),
}));

const OBJECTS = [
  { name: 'account', label: 'Account', pluralLabel: 'Accounts', icon: 'Building' },
  { name: 'contact', label: 'Contact', pluralLabel: 'Contacts', icon: 'User' },
  { name: 'opportunity', label: 'Opportunity', pluralLabel: 'Opportunities', icon: 'Target' },
];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ getClient: () => ({ meta: { saveItem } }) }),
    useMetadata: () => ({ apps, objects: OBJECTS, refresh: () => Promise.resolve() }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

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

const ACCOUNTS = { id: 'nav_accounts', type: 'object', label: 'Customer Accounts', icon: 'Briefcase', objectName: 'account' };
const RULE = { id: 'nav_rule', type: 'separator' };
const PIPELINE = { id: 'nav_pipeline', type: 'dashboard', label: 'Pipeline', dashboardName: 'sales_pipeline' };
const SALES = { id: 'nav_sales', type: 'group', label: 'Sales', icon: 'LineChart', children: [PIPELINE] };
const DOCS = { id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://docs.acme.dev', target: '_blank' };

/**
 * A stored app carrying every key the wizard maintains, so the whole saved
 * body can be compared with it, and a navigation of
 * `[object, separator, group(with a dashboard child), url]`.
 */
const STORED = {
  name: 'acme_crm',
  label: 'Acme CRM',
  description: 'Customer relationships',
  icon: 'Briefcase',
  branding: { logo: '/acme.svg', primaryColor: '#2563eb', favicon: '/acme.ico' },
  navigation: [ACCOUNTS, RULE, SALES, DOCS],
};

const RENAMED = 'Acme CRM (renamed)';

type Leave = 'Next' | 'the step indicator';

/**
 * Edit `stored` through the real page: rename it on the basic step, run
 * `onObjects` on the Objects step, leave it by `leave`, and complete. Returns
 * the saved body and the top-level entry ids the Navigation step listed.
 */
async function editThrough(stored: Record<string, unknown>, onObjects?: () => void, leave: Leave = 'Next') {
  apps.push(stored);
  routeParams = { editAppName: 'acme_crm' };
  render(<EditAppPage />);
  fireEvent.change(screen.getByTestId('app-title-input'), { target: { value: RENAMED } });
  next(); // → objects
  onObjects?.();
  if (leave === 'Next') next();
  else fireEvent.click(screen.getByTestId('wizard-step-navigation'));
  const listed = within(screen.getByTestId('wizard-step-navigation-content'))
    .queryAllByTestId(/^nav-item-/)
    .map((el) => el.getAttribute('data-testid')!.slice('nav-item-'.length));
  next(); // → branding
  fireEvent.click(screen.getByTestId('wizard-complete'));
  return { body: await savedBody(), listed };
}

const toggle = (objectName: string) => () => fireEvent.click(screen.getByTestId(`object-card-${objectName}`));

beforeEach(() => {
  saveItem.mockClear();
  apps.length = 0;
  routeParams = {};
  localStorage.clear();
});
afterEach(() => cleanup());

describe('objectui#10894 — an edit keeps the stored navigation tree', () => {
  it.each<Leave>(['Next', 'the step indicator'])(
    'the stored tree round-trips byte-equal apart from the edited title, leaving the Objects step by %s',
    async (leave) => {
      const { body, listed } = await editThrough(STORED, undefined, leave);
      expect(listed).toEqual(['nav_accounts', 'nav_rule', 'nav_sales', 'nav_docs']);
      expect(JSON.stringify(body)).toBe(JSON.stringify({ ...STORED, label: RENAMED }));
      expect(specIssues(body)).toBeNull();
    },
  );

  it('selecting a new object appends exactly its entry and keeps everything else', async () => {
    const { body } = await editThrough(STORED, toggle('contact'));
    expect(body.navigation).toEqual([
      ...STORED.navigation,
      { id: 'contact', type: 'object', label: 'Contacts', icon: 'User', objectName: 'contact' },
    ]);
    expect(specIssues(body)).toBeNull();
  });

  it('deselecting an object drops only its entry', async () => {
    const { body } = await editThrough(STORED, toggle('account'));
    expect(body.navigation).toEqual([RULE, SALES, DOCS]);
    expect(specIssues(body)).toBeNull();
  });
});

describe('objectui#10894 — an object entry the author placed inside a group', () => {
  const PEOPLE = { id: 'nav_people', type: 'object', label: 'People', icon: 'Users', objectName: 'contact' };
  const NESTED = { ...STORED, navigation: [ACCOUNTS, RULE, { ...SALES, children: [PIPELINE, PEOPLE] }, DOCS] };

  it('round-trips untouched: the Objects step counts its object as selected', async () => {
    const { body } = await editThrough(NESTED);
    expect(JSON.stringify(body.navigation)).toBe(JSON.stringify(NESTED.navigation));
  });

  it('deselecting its object drops it from inside the group; the group and its other children stay', async () => {
    const { body } = await editThrough(NESTED, toggle('contact'));
    expect(body.navigation).toEqual([ACCOUNTS, RULE, SALES, DOCS]);
    expect(specIssues(body)).toBeNull();
  });

  it('a group whose only child is dropped stays, with an empty `children`', async () => {
    const ONLY_CHILD = { ...STORED, navigation: [ACCOUNTS, { ...SALES, children: [PEOPLE] }] };
    const { body } = await editThrough(ONLY_CHILD, toggle('contact'));
    expect(body.navigation).toEqual([ACCOUNTS, { ...SALES, children: [] }]);
    expect(specIssues(body)).toBeNull();
  });

  it('an object entry whose object the Objects step does not list is kept: nothing deselected it', async () => {
    const TASKS = { id: 'nav_tasks', type: 'object', label: 'Tasks', objectName: 'task' };
    const UNLISTED = { ...STORED, navigation: [ACCOUNTS, { ...SALES, children: [PIPELINE, TASKS] }] };
    const { body } = await editThrough(UNLISTED);
    expect(JSON.stringify(body.navigation)).toBe(JSON.stringify(UNLISTED.navigation));
  });
});

describe('objectui#10894 — the create path still generates navigation for an empty draft', () => {
  it('CONTROL — one object entry per selected object, in the Objects step order', async () => {
    render(<CreateAppPage />);
    fireEvent.change(screen.getByTestId('app-name-input'), { target: { value: 'acme_crm' } });
    fireEvent.change(screen.getByTestId('app-title-input'), { target: { value: 'Acme CRM' } });
    next(); // → objects
    fireEvent.click(screen.getByTestId('object-card-contact'));
    fireEvent.click(screen.getByTestId('object-card-account'));
    next(); // → navigation, generated from the selected objects
    next(); // → branding
    fireEvent.click(screen.getByTestId('wizard-complete'));
    const body = await savedBody();
    expect(body.navigation).toEqual([
      { id: 'account', type: 'object', label: 'Accounts', icon: 'Building', objectName: 'account' },
      { id: 'contact', type: 'object', label: 'Contacts', icon: 'User', objectName: 'contact' },
    ]);
    expect(specIssues(body)).toBeNull();
  });
});
