// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11720 — the organization settings form stops offering a slug edit
 * the framework will refuse, and a name-only save never carries a slug.
 *
 * ## The defect, as the card measured it
 *
 * The form saves name, slug and logo in one better-auth
 * `POST /organization/update`. From framework 17.7.0 the slug guard on that
 * door (`beforeUpdateOrganization` in plugin-auth) refuses a NEW slug with
 * `403` while the organization has an environment that is neither archived nor
 * failed. Every cloud organization is born with its production environment, so
 * every owner's slug edit on this form answered `403`, shown as a toast.
 *
 * ## The ruled shape (triage on the card): B, because no cloud signal exists
 *
 * A (send a changed slug to cloud's own change-slug route) needed an existing
 * signal saying the host serves that route; none was found, and a new key is
 * not added here. So the form takes B: the slug field is read-only while the
 * organization has environments the guard counts, with a note saying why.
 *
 * ## What is pinned here
 *
 * - the read: which request asks, and the one response dialect it believes;
 * - with environments: the field is read-only, the note renders, and a save
 *   sends no slug;
 * - outside cloud (the read is refused, as on a multi-environment host with no
 *   `sys_environment` object): the form behaves as before — one update call,
 *   a changed slug in it;
 * - a name-only save carries no slug, whichever host;
 * - a single-environment runtime (`singleEnvironment: true`, the CLI's arm) is
 *   not asked at all: no request, the field editable, a changed slug sent;
 * - the note states only the measured cause and names no rename path;
 * - a non-owner's visit does not ask about environments at all.
 *
 * Transport is stubbed at `createAuthenticatedFetch`, the one fetch the read
 * goes through; `updateOrganization` is the `useAuth()` double.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mocks ────────────────────────────────────────────────────────────────────

const getMembers = vi.fn();
const updateOrganization = vi.fn();
const deleteOrganization = vi.fn();
const leaveOrganization = vi.fn();
const transport = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  createAuthenticatedFetch: () => transport,
  useAuth: () => ({
    user: { id: 'u-1' },
    getMembers,
    updateOrganization,
    deleteOrganization,
    leaveOrganization,
  }),
}));

// The en oracle: `t()` returns the call site's inline `defaultValue`.
vi.mock('@object-ui/i18n', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) =>
      opts?.defaultValue ?? key,
  }),
}));

vi.mock('@object-ui/providers', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/providers')>()),
  useUpload: () => ({ upload: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The runtime's own answer to "am I single-environment?", flipped per test. The
// real snapshot is kept and only that one field is overridden.
const runtime = vi.hoisted(() => ({ singleEnvironment: false }));
vi.mock('../../../runtime-config', async (importActual) => {
  const actual = await importActual<typeof import('../../../runtime-config')>();
  return {
    ...actual,
    getRuntimeConfig: () => ({ ...actual.getRuntimeConfig(), singleEnvironment: runtime.singleEnvironment }),
  };
});

// ONE context object for every render: the page re-syncs its form from `org`
// whenever that object changes, as it does after a save, so a fresh object per
// render would wipe every edit a test makes before it reaches the save.
const outlet = vi.hoisted(() => ({ org: { id: 'org-42', name: 'Acme', slug: 'acme', logo: '' } }));
vi.mock('react-router-dom', () => ({
  useOutletContext: () => outlet,
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const passthrough = (tag: string) => (p: any) => React.createElement(tag, p, p.children);
  return {
    ...actual,
    Avatar: passthrough('div'),
    AvatarFallback: passthrough('div'),
    AvatarImage: (p: any) => <img {...p} />,
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    Input: (p: any) => <input {...p} />,
    Label: passthrough('label'),
    Separator: () => <hr />,
    AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    AlertDialogAction: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    AlertDialogCancel: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    AlertDialogContent: passthrough('div'),
    AlertDialogDescription: passthrough('p'),
    AlertDialogFooter: passthrough('div'),
    AlertDialogHeader: passthrough('div'),
    AlertDialogTitle: passthrough('h2'),
  };
});

import { SettingsPage } from '../manage/SettingsPage';
import { readOrgEnvironmentPresence } from '../manage/orgEnvironments';

// ── Harness ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The framework data domain's list answer: `{ success, data: { object, records } }`. */
function environments(...statuses: Array<string | undefined>): Response {
  return json({
    success: true,
    data: {
      object: 'sys_environment',
      records: statuses.map((status) => (status === undefined ? {} : { status })),
    },
  });
}

/** What a multi-environment host with no `sys_environment` object answers. */
function noSuchObject(): Response {
  return json({ success: false, error: { code: 'OBJECT_NOT_FOUND', message: 'not found' } }, 404);
}

function asOwner() {
  getMembers.mockResolvedValue([{ id: 'm-1', userId: 'u-1', role: 'owner' }]);
}

async function renderForm() {
  render(<SettingsPage />);
  return screen.findByTestId('settings-slug-input');
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.singleEnvironment = false;
  asOwner();
  updateOrganization.mockResolvedValue({ id: 'org-42', name: 'Acme', slug: 'acme' });
});

// ── The read ─────────────────────────────────────────────────────────────────

describe('readOrgEnvironmentPresence — the guard question, read from the guard input (objectui#11720)', () => {
  it('asks the data API for this organization’s environment statuses, with the canonical params', async () => {
    transport.mockResolvedValueOnce(environments('active'));
    await readOrgEnvironmentPresence('org-42');

    expect(transport).toHaveBeenCalledTimes(1);
    const [input, init] = transport.mock.calls[0];
    const url = new URL(String(input), 'http://host.test');
    expect(url.pathname).toBe('/api/v1/data/sys_environment');
    expect(JSON.parse(url.searchParams.get('filter') ?? 'null')).toEqual({ organization_id: 'org-42' });
    expect(url.searchParams.get('select')).toBe('status');
    expect(init?.method).toBe('GET');
  });

  it('answers present for a row the guard counts, including a row with no status', async () => {
    transport.mockResolvedValueOnce(environments('archived', 'active'));
    expect(await readOrgEnvironmentPresence('org-42')).toBe('present');
    transport.mockResolvedValueOnce(environments(undefined));
    expect(await readOrgEnvironmentPresence('org-42')).toBe('present');
  });

  it('answers none when every row is archived or failed, or there are none', async () => {
    transport.mockResolvedValueOnce(environments('archived', 'failed'));
    expect(await readOrgEnvironmentPresence('org-42')).toBe('none');
    transport.mockResolvedValueOnce(environments());
    expect(await readOrgEnvironmentPresence('org-42')).toBe('none');
  });

  it('answers unknown for a refusal, a network failure, or a body outside the envelope', async () => {
    transport.mockResolvedValueOnce(noSuchObject());
    expect(await readOrgEnvironmentPresence('org-42')).toBe('unknown');
    transport.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await readOrgEnvironmentPresence('org-42')).toBe('unknown');
    // A bare body is a producer contract violation, not a second dialect.
    transport.mockResolvedValueOnce(json({ records: [{ status: 'active' }] }));
    expect(await readOrgEnvironmentPresence('org-42')).toBe('unknown');
  });

  it('on a single-environment runtime answers unknown without a request', async () => {
    runtime.singleEnvironment = true;
    transport.mockImplementation(async () => environments('active'));
    expect(await readOrgEnvironmentPresence('org-42')).toBe('unknown');
    expect(transport).not.toHaveBeenCalled();
  });
});

// ── The form ─────────────────────────────────────────────────────────────────

describe('SettingsPage slug field — offered only where the update door accepts it (objectui#11720)', () => {
  it('with environments: the slug is read-only, the note says why, and a save sends no slug', async () => {
    transport.mockImplementation(async () => environments('active'));
    const input = await renderForm();

    expect(input).toHaveAttribute('readonly');
    const note = screen.getByTestId('settings-slug-locked-note');
    // The measured cause, and nothing else: the note names no rename path,
    // because none was measured reachable from this console.
    expect(note.textContent).toBe(
      'This organization has active environments, so its slug can’t be changed here: renaming it also moves their subdomains.',
    );
    expect(note.textContent).not.toMatch(/record|rename it from/i);
    expect(input).toHaveAttribute('aria-describedby', note.id);

    fireEvent.change(screen.getByTestId('settings-name-input'), { target: { value: 'Acme Corp' } });
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => expect(updateOrganization).toHaveBeenCalledTimes(1));
    const [orgId, body] = updateOrganization.mock.calls[0];
    expect(orgId).toBe('org-42');
    expect(body).toEqual({ name: 'Acme Corp', logo: undefined });
    expect(body).not.toHaveProperty('slug');
  });

  it('outside cloud: the read is refused, the slug stays editable, and a changed slug is sent in the one update call', async () => {
    transport.mockImplementation(async () => noSuchObject());
    const input = await renderForm();

    expect(input).not.toHaveAttribute('readonly');
    expect(screen.queryByTestId('settings-slug-locked-note')).toBeNull();

    fireEvent.change(input, { target: { value: 'acme-corp' } });
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => expect(updateOrganization).toHaveBeenCalledTimes(1));
    expect(updateOrganization).toHaveBeenCalledWith('org-42', {
      name: 'Acme',
      slug: 'acme-corp',
      logo: undefined,
    });
  });

  it('on a single-environment runtime: no request, the slug stays editable, and a changed slug is sent in the one update call', async () => {
    runtime.singleEnvironment = true;
    // Were the read made, this answer would lock the field.
    transport.mockImplementation(async () => environments('active'));
    const input = await renderForm();

    expect(transport).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute('readonly');
    expect(screen.queryByTestId('settings-slug-locked-note')).toBeNull();

    fireEvent.change(input, { target: { value: 'acme-corp' } });
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => expect(updateOrganization).toHaveBeenCalledTimes(1));
    expect(updateOrganization).toHaveBeenCalledWith('org-42', {
      name: 'Acme',
      slug: 'acme-corp',
      logo: undefined,
    });
  });

  it('only retired environments: the slug stays editable', async () => {
    transport.mockImplementation(async () => environments('archived'));
    const input = await renderForm();
    expect(input).not.toHaveAttribute('readonly');
    expect(screen.queryByTestId('settings-slug-locked-note')).toBeNull();
  });

  it.each([
    ['outside cloud', noSuchObject],
    ['with environments', () => environments('active')],
  ])('a name-only save carries no slug (%s)', async (_label, answer) => {
    transport.mockImplementation(async () => answer());
    await renderForm();

    fireEvent.change(screen.getByTestId('settings-name-input'), { target: { value: 'Acme Corp' } });
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => expect(updateOrganization).toHaveBeenCalledTimes(1));
    expect(updateOrganization.mock.calls[0][1]).not.toHaveProperty('slug');
  });

  it('a non-owner’s visit does not ask about environments', async () => {
    getMembers.mockResolvedValue([{ id: 'm-1', userId: 'u-1', role: 'member' }]);
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    expect(screen.queryByTestId('settings-slug-input')).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
});
