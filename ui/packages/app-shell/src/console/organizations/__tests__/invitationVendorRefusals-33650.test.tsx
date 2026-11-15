// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33650 — two invitation refusals drew better-auth's raw English,
 * and an invitation the invitee had already accepted read as an error.
 *
 * ## Why the auth client is real here
 *
 * The sibling holdouts file (`org-i18n-holdouts-4474.test.tsx`) mocks `useAuth`
 * with hand-built coded errors. This card is exactly the case such a mock
 * cannot see: better-auth's `get-invitation` answers its not-found with a 400
 * and NO code, and the thrown value carried no status either, so nothing a
 * hand-made `code` stands for was ever on the wire. So `useAuth` here forwards
 * to the REAL `createAuthClient` over a stubbed `fetch` that answers with
 * better-auth 1.7.12's own bodies (`crud-invites.mjs`), and the page, the
 * dialog and the i18n provider are the real ones.
 *
 * ## The three faces, as `origin/main` drew them in zh
 *
 *   1. `/accept-invitation/ID`, get-invitation 400 `{ message: "Invitation not found!" }`
 *      .......... 邀请不可用 + `Invitation not found!`
 *   2. invite dialog, invite-member 400 `USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`
 *      .......... `User is already a member of this organization`
 *   3. the invitee re-opens an invitation they accepted: get-invitation answers
 *      the SAME code-less 400 (the route refuses any status but `pending`), so
 *      the page cannot tell it from an unknown id. The sentence now names the
 *      used / expired / revoked states and where an accepted invitation's
 *      organization is, beside the page's "Go to organizations" button.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { createAuthClient } from '@object-ui/auth';

// ── The vendor's answers, per route ──────────────────────────────────────────

type Answer = { status: number; body: unknown };
const answers = new Map<string, Answer>();

const PENDING = {
  id: 'inv-1',
  organizationId: 'org-42',
  organizationName: 'Acme',
  organizationSlug: 'acme',
  email: 'zhang.wei@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2099-03-04T12:00:00.000Z',
  inviterId: 'u-0',
  inviterEmail: 'grace@example.com',
};

/** better-auth 1.7.12 `getInvitation`: the not-found throw, verbatim — no `code`. */
const GET_INVITATION_NOT_FOUND: Answer = { status: 400, body: { message: 'Invitation not found!' } };

const fetchFn = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  for (const [path, answer] of answers) {
    if (url.includes(path)) {
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

const client = createAuthClient({
  baseURL: 'http://localhost/api/auth',
  fetchFn: fetchFn as unknown as typeof fetch,
});

// ⚠️ STABLE identities: the accept page keys its fetch effect on `getInvitation`.
const auth = {
  isAuthenticated: true,
  isLoading: false,
  activeMember: { role: 'owner' },
  getInvitation: (id: string) => client.getInvitation(id),
  acceptInvitation: (id: string) => client.acceptInvitation(id),
  rejectInvitation: (id: string) => client.rejectInvitation(id),
  switchOrganization: async () => undefined,
  inviteMember: (args: Parameters<typeof client.inviteMember>[0]) => client.inviteMember(args),
  describeDelegableScope: async () => null,
};

vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => auth,
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }));

vi.mock('react-router-dom', async (importActual) => {
  const navigate = () => {};
  const location = { pathname: '/accept-invitation/inv-1', search: '' };
  const params = { invitationId: 'inv-1' };
  return {
    ...(await importActual<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
    useLocation: () => location,
    useParams: () => params,
  };
});

// The component kit is not the subject: the dialog's portal and the select's
// popover are swapped for plain elements, as the sibling i18n tests do.
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const passthrough = (tag: string) => (p: any) => React.createElement(tag, p, p.children);
  return {
    ...actual,
    Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    DialogContent: passthrough('div'),
    DialogDescription: passthrough('p'),
    DialogFooter: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('h2'),
    Select: ({ value, onValueChange, children }: any) => (
      <select data-testid="select" value={value} onChange={(e) => onValueChange(e.target.value)}>
        <option value="" />
        {children}
      </select>
    ),
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value, children, ...rest }: any) => (
      <option value={value} {...rest}>
        {children}
      </option>
    ),
    SelectTrigger: ({ children }: any) => <>{children}</>,
    SelectValue: () => null,
  };
});

import { AcceptInvitationPage } from '../manage/AcceptInvitationPage';
import { InviteMemberDialog } from '../manage/InviteMemberDialog';

const zh = builtInLocales['zh-Hans'] as any;
const en = builtInLocales.en as any;

const renderIn = (lang: 'en' | 'zh', ui: React.ReactElement) =>
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      {ui}
    </I18nProvider>,
  );

/** The error card's sentence, once the page has drawn it. */
async function acceptPageError(): Promise<HTMLElement> {
  const page = await screen.findByTestId('accept-invitation-page');
  await waitFor(() => expect(page.querySelector('p.text-muted-foreground')).not.toBeNull());
  return page.querySelector('p.text-muted-foreground') as HTMLElement;
}

beforeEach(() => {
  answers.clear();
  fetchFn.mockClear();
  toastError.mockClear();
});

afterEach(() => cleanup());

describe('#33650 face 1 — get-invitation\'s code-less not-found', () => {
  it('zh: draws the localized not-found sentence, not the vendor\'s English', async () => {
    answers.set('/organization/get-invitation', GET_INVITATION_NOT_FOUND);
    renderIn('zh', <AcceptInvitationPage />);

    const sentence = await acceptPageError();
    expect(sentence).toHaveTextContent(zh.organization.errors.invitationNotFound);
    expect(screen.getByTestId('accept-invitation-page')).not.toHaveTextContent('Invitation not found!');
    expect(screen.getByText(zh.organization.accept.errorTitle)).toBeInTheDocument();
    // The answer really came over the wire from the vendor route.
    expect(fetchFn.mock.calls.some(([u]) => String(u instanceof Request ? u.url : u).includes('/organization/get-invitation'))).toBe(true);
  });

  it('en: draws the console\'s own English sentence, not the vendor\'s', async () => {
    answers.set('/organization/get-invitation', GET_INVITATION_NOT_FOUND);
    renderIn('en', <AcceptInvitationPage />);

    const sentence = await acceptPageError();
    expect(sentence).toHaveTextContent(en.organization.errors.invitationNotFound);
    expect(screen.getByTestId('accept-invitation-page')).not.toHaveTextContent('Invitation not found!');
  });

  it('CONTROL: a coded 400 from the same route still shows its own message', async () => {
    // better-auth 1.7.12 `getInvitation`: the inviter left the organization.
    // Not a not-found; unmapped, so it keeps the server's sentence.
    answers.set('/organization/get-invitation', {
      status: 400,
      body: {
        code: 'INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION',
        message: 'Inviter is no longer a member of the organization',
      },
    });
    renderIn('zh', <AcceptInvitationPage />);

    const sentence = await acceptPageError();
    expect(sentence).toHaveTextContent('Inviter is no longer a member of the organization');
  });

  it('CONTROL: a code-less answer with another status keeps its own message', async () => {
    // better-auth's session check on the same route: 401, no code.
    answers.set('/organization/get-invitation', { status: 401, body: { message: 'Not authenticated' } });
    renderIn('zh', <AcceptInvitationPage />);

    const sentence = await acceptPageError();
    expect(sentence).toHaveTextContent('Not authenticated');
    expect(sentence).not.toHaveTextContent(zh.organization.errors.invitationNotFound);
  });

  it('CONTROL: accept-invitation\'s coded INVITATION_NOT_FOUND still maps as before', async () => {
    answers.set('/organization/get-invitation', { status: 200, body: PENDING });
    answers.set('/organization/accept-invitation', {
      status: 400,
      body: { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found' },
    });
    renderIn('zh', <AcceptInvitationPage />);

    await screen.findByTestId('accept-invitation-role');
    fireEvent.click(screen.getByText(zh.organization.accept.accept));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenLastCalledWith(zh.organization.errors.invitationNotFound);
  });
});

describe('#33650 face 3 — the invitee re-opens an invitation they accepted', () => {
  it('reads as used / expired / revoked and points to the organization list, with the way in', async () => {
    // An accepted row is no longer `pending`, so get-invitation answers the
    // same code-less 400 as for an unknown id: the id alone cannot tell.
    answers.set('/organization/get-invitation', GET_INVITATION_NOT_FOUND);
    renderIn('zh', <AcceptInvitationPage />);

    const sentence = await acceptPageError();
    expect(sentence.textContent).toContain('已被使用');
    expect(sentence.textContent).toContain('组织列表');
    expect(screen.getByRole('button', { name: zh.organization.accept.goToOrgs })).toBeInTheDocument();
  });
});

describe('#33650 face 2 — inviting someone who is already a member', () => {
  it('zh: the invite dialog draws the localized sentence', async () => {
    // better-auth 1.7.12 `createInvitation` (`crud-invites.mjs`), verbatim.
    answers.set('/organization/invite-member', {
      status: 400,
      body: {
        code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
        message: 'User is already a member of this organization',
      },
    });
    renderIn('zh', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('invite-email-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('invite-email-input'), { target: { value: 'zhang.wei@example.com' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(screen.getByTestId('invite-error')).toBeInTheDocument());
    expect(screen.getByTestId('invite-error')).toHaveTextContent(zh.organization.errors.alreadyMember);
    expect(screen.getByTestId('invite-error')).not.toHaveTextContent('User is already a member');
  });

  it('CONTROL: an unmapped coded refusal still shows the server\'s own message', async () => {
    answers.set('/organization/invite-member', {
      status: 400,
      body: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found' },
    });
    renderIn('zh', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('invite-email-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('invite-email-input'), { target: { value: 'p@example.com' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(screen.getByTestId('invite-error')).toBeInTheDocument());
    expect(screen.getByTestId('invite-error')).toHaveTextContent('Organization not found');
  });
});

describe('#33650 — every shipped pack carries the new sentence', () => {
  it('organization.errors.alreadyMember is a translated string in each pack', () => {
    const packs = Object.keys(builtInLocales) as Array<keyof typeof builtInLocales>;
    expect(packs.length).toBeGreaterThanOrEqual(11);
    for (const lang of packs) {
      const value = (builtInLocales[lang] as any).organization?.errors?.alreadyMember;
      expect(typeof value, `${lang}.organization.errors.alreadyMember`).toBe('string');
      if (lang !== 'en') expect(value, `${lang} echoes the English`).not.toBe(en.organization.errors.alreadyMember);
    }
  });
});
