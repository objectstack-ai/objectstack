// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11866 — the profile states the access the console resolves, not the
 * auth library's raw `user.role`.
 *
 * ## The defect these cases pin
 *
 * The badge under the name and the read-only *Role* field rendered
 * `user.role ?? 'member'`. `user.role` is better-auth's own scalar, which the
 * server stopped overwriting: a platform administrator's standing travels on
 * the session as the posture rung (`isPlatformAdmin`), while `role` keeps
 * better-auth's default `user`. So the seeded administrator read as "user",
 * and the `member` fallback was a third, untranslated vocabulary.
 *
 * ## Why these render the REAL `AuthProvider`
 *
 * The page now reads `useWorkspaceAdminStatus`, whose verdict is built inside
 * `@object-ui/auth` from the provider's own state. A mocked `useAuth` could
 * only restate the fixture — and would not even reach the hook, which imports
 * `useAuth` from its own module. Mounting the real provider against a client
 * double (the pattern of `packages/auth/src/__tests__/workspaceAdminRung-8291.test.tsx`)
 * measures the path the console takes from wire payload to the word on screen.
 * Each payload below is the shape the server's `customSession` emits: `role`
 * stays better-auth's `user`, `positions` comes from the grant resolver and
 * `isPlatformAdmin` from the posture rung.
 *
 * The translator echoes each call site's `defaultValue` — the console
 * convention for standing in for a locale pack (see
 * `ProfilePage.language.test.tsx`) — and is a spy, so the case that names the
 * label can also say which pack key it came through.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient, AuthUser } from '@object-ui/auth';

const { translate, findOne } = vi.hoisted(() => ({
  translate: vi.fn((key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? key),
  ),
  findOne: vi.fn(async () => ({ id: 'usr_admin' })),
}));

vi.mock('@object-ui/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpload: () => ({ upload: async () => ({ url: '' }) }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: translate, offerableLanguages: ['en', 'zh'] }),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ findOne, update: async () => ({}) }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({ isLoaded: true, checkField: () => true }),
}));

const { ProfilePage } = await import('../ProfilePage');

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/**
 * The seeded platform administrator (`objectstack dev --seed-admin`) as the
 * session carries it on a single-tenant deployment: better-auth's default
 * `role`, `platform_admin` among the resolved positions, and the rung set.
 */
const SEEDED_PLATFORM_ADMIN = {
  id: 'usr_admin',
  name: 'Admin',
  email: 'admin@objectos.ai',
  emailVerified: true,
  image: null,
  role: 'user',
  positions: ['everyone', 'platform_admin'],
  isPlatformAdmin: true,
} as unknown as AuthUser;

/** An ordinary member of a workspace: the membership row says `member`. */
const PLAIN_MEMBER = {
  id: 'usr_member',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerified: true,
  image: null,
  role: 'user',
  positions: ['everyone', 'org_member'],
  isPlatformAdmin: false,
} as unknown as AuthUser;

function client(user: AuthUser, overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({ user, session: { token: 'tok-11866' } }),
    signOut: vi.fn().mockResolvedValue(undefined),
    hasLocalPassword: vi.fn().mockResolvedValue(true),
    listOrganizations: vi.fn().mockResolvedValue([]),
    getActiveOrganization: vi.fn().mockResolvedValue(null),
    setActiveOrganization: vi.fn().mockResolvedValue(null),
    getActiveMember: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as AuthClient;
}

function memberOf(userId: string): Partial<AuthClient> {
  return {
    listOrganizations: vi.fn().mockResolvedValue([ORG]),
    getActiveOrganization: vi.fn().mockResolvedValue(ORG),
    getActiveMember: vi.fn().mockResolvedValue({
      id: 'mem_11866',
      organizationId: ORG.id,
      userId,
      role: 'member',
    }),
  } as unknown as Partial<AuthClient>;
}

/** Mount the real page under the real provider and wait for the session to land. */
async function mountProfile(authClient: AuthClient, name: string) {
  render(
    <AuthProvider authUrl="/api/v1/auth" client={authClient}>
      <ProfilePage />
    </AuthProvider>,
  );
  // The session has landed once the page renders the user's name heading;
  // `ProfilePage` returns null before that.
  await screen.findByText(name, { selector: 'p' });
}

const badge = () => screen.queryByTestId('profile-access-badge');
const roleField = () => screen.queryByLabelText('Role') as HTMLInputElement | null;

describe('ProfilePage — the access the console resolves (objectui#11866)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOne.mockResolvedValue({ id: 'usr_admin' });
  });

  it('shows the seeded platform administrator as an administrator, never as "user"', async () => {
    await mountProfile(client(SEEDED_PLATFORM_ADMIN), 'Admin');

    await waitFor(() => expect(badge()?.textContent).toBe('Admin'));
    expect(roleField()?.value).toBe('Admin');
    expect(translate).toHaveBeenCalledWith('organization.roles.admin', { defaultValue: 'Admin' });
    // The auth library's raw scalar reaches neither surface.
    expect(screen.queryByText('user')).toBeNull();
    expect(screen.queryByDisplayValue('user')).toBeNull();
  });

  it('shows an ordinary workspace member as a member', async () => {
    await mountProfile(client(PLAIN_MEMBER, memberOf(PLAIN_MEMBER.id)), 'Ada');

    await waitFor(() => expect(badge()?.textContent).toBe('Member'));
    expect(roleField()?.value).toBe('Member');
    expect(translate).toHaveBeenCalledWith('organization.roles.member', { defaultValue: 'Member' });
    expect(screen.queryByText('user')).toBeNull();
    expect(screen.queryByDisplayValue('user')).toBeNull();
  });

  it('shows no badge and no Role field until the verdict settles', async () => {
    // Hold the membership pipeline open: the session has landed, but for a
    // non-administrator `useWorkspaceAdminStatus` is not resolved until the
    // organization list has come back.
    let releaseOrgs: (orgs: unknown[]) => void = () => {};
    const pendingOrgs = new Promise<unknown[]>((resolve) => {
      releaseOrgs = resolve;
    });
    await mountProfile(
      client(PLAIN_MEMBER, {
        ...memberOf(PLAIN_MEMBER.id),
        listOrganizations: vi.fn().mockReturnValue(pendingOrgs),
      } as Partial<AuthClient>),
      'Ada',
    );

    expect(badge()).toBeNull();
    expect(roleField()).toBeNull();

    await act(async () => {
      releaseOrgs([ORG]);
    });
    await waitFor(() => expect(badge()?.textContent).toBe('Member'));
    expect(roleField()?.value).toBe('Member');
  });

  it('leaves the rest of the page as it was: name, email and language', async () => {
    await mountProfile(client(SEEDED_PLATFORM_ADMIN), 'Admin');

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Admin');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('admin@objectos.ai');
    expect(await screen.findByTestId('profile-language-select')).toBeTruthy();
  });
});
