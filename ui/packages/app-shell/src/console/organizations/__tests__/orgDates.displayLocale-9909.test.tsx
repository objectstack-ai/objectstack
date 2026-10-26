/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The organization pages' dates read the DECLARED session locale, never the
 * machine's (objectui#9909): an invitation's expiry on the invitations list
 * and on the accept page, and a member's join date.
 *
 * Each of those sat on the same line as a TRANSLATED label
 * (`organization.invitations.expiresAt`, `organization.accept.expiresAt`), so
 * both channels were visible at once — the label in the session's language,
 * the date in the machine's. Each surface renders the same record twice, under
 * a declared `de-DE` tenant locale and a declared `en` one (the UI language
 * `en` on both), and must read differently; the runtime tripwire then checks
 * the argument every locale-taking call received.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

/** One stored instant — 2020-03-04, a past year, so every face keeps its year. */
const STORED = '2020-03-04T12:00:00.000Z';

const INVITATION = {
  id: 'inv-1',
  organizationId: 'org-42',
  organizationName: 'Acme',
  email: 'ada@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: STORED,
  inviterId: 'u0',
};
const MEMBER = {
  id: 'mem-1',
  organizationId: 'org-42',
  userId: 'u1',
  role: 'member',
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
  createdAt: STORED,
};

// ⚠️ STABLE identities: the pages key their fetch effects on `listInvitations`
// / `getMembers` / `org.id`, so a mock that minted new functions per render
// would loop the effect forever ("Maximum update depth exceeded").
vi.mock('@object-ui/auth', async (importActual) => {
  const auth = {
    isAuthenticated: true,
    isLoading: false,
    activeMember: { role: 'owner' },
    listInvitations: async () => [INVITATION],
    cancelInvitation: async () => undefined,
    getMembers: async () => [MEMBER],
    removeMember: async () => undefined,
    updateMemberRole: async () => undefined,
    inviteMember: async () => undefined,
    describeDelegableScope: async () => null,
    getInvitation: async () => INVITATION,
    acceptInvitation: async () => undefined,
    rejectInvitation: async () => undefined,
    switchOrganization: async () => undefined,
  };
  return {
    ...(await importActual<typeof import('@object-ui/auth')>()),
    useAuth: () => auth,
  };
});

vi.mock('react-router-dom', async (importActual) => {
  const outlet = { org: { id: 'org-42', name: 'Acme', slug: 'acme' } };
  const navigate = () => {};
  const location = { pathname: '/accept-invitation/inv-1', search: '' };
  const params = { invitationId: 'inv-1' };
  return {
    ...(await importActual<typeof import('react-router-dom')>()),
    useOutletContext: () => outlet,
    useNavigate: () => navigate,
    useLocation: () => location,
    useParams: () => params,
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InvitationsPage } from '../manage/InvitationsPage';
import { MembersPage } from '../manage/MembersPage';
import { AcceptInvitationPage } from '../manage/AcceptInvitationPage';

afterEach(() => cleanup());

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

interface Surface {
  name: string;
  node: () => React.ReactNode;
  /** A string the settled surface renders, so the read waits for the fetch. */
  settled: RegExp;
}

const SURFACES: Surface[] = [
  { name: 'InvitationsPage — expiry', node: () => <InvitationsPage />, settled: /ada@example\.com/ },
  { name: 'MembersPage — join date', node: () => <MembersPage />, settled: /Ada Lovelace/ },
  { name: 'AcceptInvitationPage — expiry', node: () => <AcceptInvitationPage />, settled: /Acme/ },
];

async function faceUnder(locale: string, surface: Surface): Promise<string> {
  render(session(locale, surface.node()));
  const text = await waitFor(() => {
    const t = document.body.textContent ?? '';
    expect(t).toMatch(surface.settled);
    expect(t).toMatch(/2020/);
    return t;
  });
  cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

describe('organization page dates follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', async (surface) => {
    const text = await faceUnder('de-DE', surface);
    expect(text, `got: ${text}`).toMatch(/4\.3\.2020/);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', async (surface) => {
    const text = await faceUnder('en', surface);
    expect(text, `got: ${text}`).toMatch(/3\/4\/2020/);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async (surface) => {
    expect(await faceUnder('de-DE', surface)).not.toBe(await faceUnder('en', surface));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async (surface) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await faceUnder('de-DE', surface);
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
