// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4474 — the organization / invitation console renders **zh** where a
 * zh session asks for it.
 *
 * ## Why the provider is real here and the components are mocked around it
 *
 * Every sibling test in this directory mocks `@object-ui/i18n` with
 * `t: (key, o) => o.defaultValue`. That mock is an **en oracle**: it returns the
 * inline English fallback by construction, so under it the defect is invisible —
 * `Delegated Admin` is the "right" answer and always was. So this file mounts
 * the REAL `I18nProvider` (the same choice, for the same reason, as
 * `packages/i18n/src/__tests__/organization-namespace-3546.test.tsx`) and mocks
 * only the things that are not the subject: `useAuth`, the router outlet, the
 * component kit and `sonner`. i18next is the thing answering, which is the only
 * way a zh assertion can discriminate before from after.
 *
 * ## The six measured sites (the card's table), verbatim as they rendered
 *
 *   1. invite dialog role dropdown ......... `Delegated Admin`
 *   2. members page role badges ............ `Owner`, `Member`
 *   3. invite dialog inline form error ..... `You are not allowed to invite users to this organization`
 *   4. create-workspace inline form error .. `Organization already exists`
 *   5. accept page toast body .............. `You are not the recipient of the invitation`
 *   6. icon-only aria-labels ............... `Member actions`, `Copy invitation link`, `Cancel invitation`
 *
 * Sites 3-5 are SERVER-echoed: the fix is a `code` -> message mapping, never a
 * match on the English text. Sites 1-2 and 6 are client-authored.
 *
 * ## What the card measured that this file corrects
 *
 * The card reports the dropdown's siblings rendering 所有者 / 管理员 / 成员 beside an
 * untranslated `Delegated Admin`. On `origin/main` at 338e2c421 that is not what
 * happens: `organization.roles.*` exists in NO pack (measured — see the pack
 * assertion below), so ALL FOUR entries fall through to their inline English
 * `defaultValue`. The defect is the card's, one size larger. The maintainer's
 * server was on an unverified commit, which is the likeliest source of the
 * discrepancy; either way the assertions below pin what this tree does.
 *
 * The role keys evaded `scripts/check-i18n-call-site-keys.mjs` — which found and
 * paid off 258 keys of exactly this class — because they are referenced through
 * `ORG_ROLE_LABELS[r].key`, a VARIABLE. That gate scans literals. This file is
 * the standing replacement for the coverage the variable indirection costs.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

// ── Mocks: everything EXCEPT i18n ────────────────────────────────────────────

const inviteMember = vi.fn();
const describeDelegableScope = vi.fn();
const getMembers = vi.fn();
const removeMember = vi.fn();
const updateMemberRole = vi.fn();
const listInvitations = vi.fn();
const cancelInvitation = vi.fn();
const getInvitation = vi.fn();
const acceptInvitation = vi.fn();
const rejectInvitation = vi.fn();
const switchOrganization = vi.fn();
const createOrganization = vi.fn();
const getAuthConfig = vi.fn();

const auth: { role: string | null } = { role: 'owner' };

vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    inviteMember,
    describeDelegableScope,
    getMembers,
    removeMember,
    updateMemberRole,
    listInvitations,
    cancelInvitation,
    getInvitation,
    acceptInvitation,
    rejectInvitation,
    switchOrganization,
    createOrganization,
    getAuthConfig,
    isAuthenticated: true,
    isLoading: false,
    activeMember: auth.role === null ? null : { role: auth.role },
  }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({ org: { id: 'org-42', name: 'Acme', slug: 'acme' } }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/accept-invitation/inv-1', search: '' }),
  useParams: () => ({ invitationId: 'inv-1' }),
}));

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
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    Input: (p: any) => <input {...p} />,
    Label: passthrough('label'),
    Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
    Avatar: passthrough('div'),
    AvatarFallback: passthrough('div'),
    AvatarImage: (p: any) => <img {...p} />,
    Separator: () => <hr />,
    AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    AlertDialogAction: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    AlertDialogCancel: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    AlertDialogContent: passthrough('div'),
    AlertDialogDescription: passthrough('p'),
    AlertDialogFooter: passthrough('div'),
    AlertDialogHeader: passthrough('div'),
    AlertDialogTitle: passthrough('h2'),
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuContent: passthrough('div'),
    DropdownMenuItem: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
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

// Enumerated, not a Proxy: Vitest validates named ESM exports against the mock
// object's own keys, and a Proxy has none — every icon reads as undefined. The
// stub is spelled inside the factory because `vi.mock` is hoisted above every
// top-level binding in this file.
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const icon = () => <span />;
  return {
    ...actual,
    Loader2: icon,
    Copy: icon,
    Check: icon,
    MoreHorizontal: icon,
    UserMinus: icon,
    ShieldCheck: icon,
    X: icon,
    Mail: icon,
    Building2: icon,
    CheckCircle: icon,
    XCircle: icon,
  };
});

vi.mock('../provisionEnvironment', () => ({ provisionProductionEnvironment: vi.fn() }));

import { InviteMemberDialog } from '../manage/InviteMemberDialog';
import { MembersPage } from '../manage/MembersPage';
import { InvitationsPage } from '../manage/InvitationsPage';
import { AcceptInvitationPage } from '../manage/AcceptInvitationPage';
import { CreateWorkspaceDialog } from '../CreateWorkspaceDialog';

// ── Harness ──────────────────────────────────────────────────────────────────

const inLocale = (lang: 'en' | 'zh') =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
        {children}
      </I18nProvider>
    );
  };

const renderIn = (lang: 'en' | 'zh', ui: React.ReactElement) =>
  render(ui, { wrapper: inLocale(lang) });

/**
 * A better-auth client error as the org routes actually produce one: a real
 * `Error` carrying the machine `code` beside the English `message`. The whole
 * point of family 2 is that the mapping reads `.code` and never the text.
 */
const authError = (code: string, message: string): Error => {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  auth.role = 'owner';
  describeDelegableScope.mockResolvedValue(null);
  getAuthConfig.mockResolvedValue({ features: { multiOrgEnabled: true } });
  getMembers.mockResolvedValue([
    { id: 'm-1', role: 'owner', userId: 'u-1', user: { name: 'Ada', email: 'ada@x.test' } },
    { id: 'm-2', role: 'member', userId: 'u-2', user: { name: 'Bo', email: 'bo@x.test' } },
  ]);
  listInvitations.mockResolvedValue([
    { id: 'inv-1', email: 'cy@x.test', role: 'admin', status: 'pending' },
  ]);
  getInvitation.mockResolvedValue({
    id: 'inv-1',
    email: 'cy@x.test',
    role: 'admin',
    status: 'pending',
    organizationId: 'org-42',
    organizationName: 'Acme',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 1 — client-authored strings (role names)
// ─────────────────────────────────────────────────────────────────────────────

describe('#4474 family 1 — role names come from ONE map and resolve in zh', () => {
  it('the packs define every role key (the absence that made all four English)', () => {
    // The root cause, asserted at the pack rather than through a render: pre-fix
    // `organization.roles` is undefined in all ten packs, so every consumer of
    // ORG_ROLE_LABELS fell through to its inline English defaultValue.
    for (const lang of Object.keys(builtInLocales) as Array<keyof typeof builtInLocales>) {
      const roles = (builtInLocales[lang] as any).organization?.roles;
      expect(roles, `${lang} has no organization.roles`).toBeDefined();
      for (const k of ['owner', 'admin', 'delegatedAdmin', 'member', 'external']) {
        expect(typeof roles?.[k], `${lang}.organization.roles.${k}`).toBe('string');
      }
    }
  });

  it('zh: the invite dropdown renders Chinese for every role — site 1', async () => {
    renderIn('zh', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('select')).toBeInTheDocument());
    const labels = Array.from(screen.getByTestId('select').querySelectorAll('option'))
      .filter((o) => o.getAttribute('value'))
      .map((o) => o.textContent);
    // Pre-fix this array was ['Owner', 'Admin', 'Delegated Admin', 'Member'].
    expect(labels).toEqual(['所有者', '管理员', '受托管理员', '成员', '外部成员']);
  });

  it('zh: the members page role badges render Chinese — site 2', async () => {
    renderIn('zh', <MembersPage />);
    await waitFor(() => expect(screen.getByTestId('members-page')).toBeInTheDocument());
    // Pre-fix: `Owner` / `Member` — the raw server identifier under CSS
    // `capitalize`, beside a dropdown that consulted the shared map.
    expect(screen.getByTestId('member-role-badge-m-1')).toHaveTextContent('所有者');
    expect(screen.getByTestId('member-role-badge-m-2')).toHaveTextContent('成员');
  });

  it('zh: the invitations page role badge renders Chinese — sibling holdout', async () => {
    renderIn('zh', <InvitationsPage />);
    await waitFor(() => expect(screen.getByTestId('invitations-page')).toBeInTheDocument());
    expect(screen.getByTestId('invitation-role-badge-inv-1')).toHaveTextContent('管理员');
  });

  it('zh: the accept page names the role in Chinese, in the row AND the sentence', async () => {
    renderIn('zh', <AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByTestId('accept-invitation-page')).toBeInTheDocument());
    expect(screen.getByTestId('accept-invitation-role')).toHaveTextContent('管理员');
    // The interpolated sentence took `role: invitation.role` raw, so a fully
    // Chinese sentence carried an English word in the middle of it.
    expect(screen.getByTestId('accept-invitation-page').textContent).toContain(
      '您受邀以 管理员 身份加入 Acme。',
    );
  });

  it('an unknown role degrades to the server value rather than blanking', async () => {
    // Same principle as family 2: prefer mapped, degrade to verbatim. The
    // membership vocabulary is closed (ADR-0108) but `member.role` is a server
    // string, so the display must never swallow one it does not recognize.
    getMembers.mockResolvedValue([
      { id: 'm-9', role: 'auditor', userId: 'u-9', user: { name: 'Zed', email: 'z@x.test' } },
    ]);
    renderIn('zh', <MembersPage />);
    await waitFor(() => expect(screen.getByTestId('members-page')).toBeInTheDocument());
    expect(screen.getByTestId('member-role-badge-m-9')).toHaveTextContent('auditor');
  });

  it('MUST NOT CHANGE — en still renders the correct English through the same channel', async () => {
    renderIn('en', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('select')).toBeInTheDocument());
    const labels = Array.from(screen.getByTestId('select').querySelectorAll('option'))
      .filter((o) => o.getAttribute('value'))
      .map((o) => o.textContent);
    expect(labels).toEqual(['Owner', 'Admin', 'Delegated Admin', 'Member', 'External']);
  });

  it('an external member\'s badge reads 外部成员 in zh and External in en (objectui#13427)', async () => {
    getMembers.mockResolvedValue([
      { id: 'm-7', role: 'external', userId: 'u-7', user: { name: 'Pat', email: 'pat@supplier.test' } },
    ]);
    const { unmount } = renderIn('zh', <MembersPage />);
    await waitFor(() => expect(screen.getByTestId('members-page')).toBeInTheDocument());
    expect(screen.getByTestId('member-role-badge-m-7')).toHaveTextContent('外部成员');
    unmount();
    renderIn('en', <MembersPage />);
    await waitFor(() => expect(screen.getByTestId('members-page')).toBeInTheDocument());
    expect(screen.getByTestId('member-role-badge-m-7')).toHaveTextContent('External');
  });

  it('MUST NOT CHANGE — en members badges read Owner / Member', async () => {
    renderIn('en', <MembersPage />);
    await waitFor(() => expect(screen.getByTestId('members-page')).toBeInTheDocument());
    expect(screen.getByTestId('member-role-badge-m-1')).toHaveTextContent('Owner');
    expect(screen.getByTestId('member-role-badge-m-2')).toHaveTextContent('Member');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 2 — server-echoed strings, mapped by `code`
// ─────────────────────────────────────────────────────────────────────────────

describe('#4474 family 2 — server errors are mapped by code, at the three sites', () => {
  it('zh: the invite dialog inline error is Chinese — site 3', async () => {
    inviteMember.mockRejectedValue(
      authError(
        'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
        'You are not allowed to invite users to this organization',
      ),
    );
    renderIn('zh', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('invite-email-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('invite-email-input'), { target: { value: 'p@x.test' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId('invite-error')).toBeInTheDocument());
    expect(screen.getByTestId('invite-error')).toHaveTextContent('您无权邀请用户加入该组织。');
  });

  it('zh: the create-workspace inline error is Chinese — site 4', async () => {
    createOrganization.mockRejectedValue(
      authError('ORGANIZATION_ALREADY_EXISTS', 'Organization already exists'),
    );
    renderIn('zh', <CreateWorkspaceDialog open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('workspace-name-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('workspace-name-input'), { target: { value: 'Acme' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId('workspace-create-error')).toBeInTheDocument());
    expect(screen.getByTestId('workspace-create-error')).toHaveTextContent('该组织已存在。');
  });

  it('zh: the accept-invitation toast body is Chinese — site 5', async () => {
    acceptInvitation.mockRejectedValue(
      authError(
        'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
        'You are not the recipient of the invitation',
      ),
    );
    renderIn('zh', <AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByTestId('accept-invitation-page')).toBeInTheDocument());
    fireEvent.click(screen.getByText('接受邀请'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('您不是该邀请的收件人。');
  });

  it('an UNMAPPED code degrades to the server message verbatim, never swallowed', async () => {
    inviteMember.mockRejectedValue(
      authError('SOME_CODE_THIS_CONSOLE_HAS_NEVER_HEARD_OF', 'Something specific went wrong'),
    );
    renderIn('zh', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('invite-email-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('invite-email-input'), { target: { value: 'p@x.test' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId('invite-error')).toBeInTheDocument());
    expect(screen.getByTestId('invite-error')).toHaveTextContent('Something specific went wrong');
  });

  it('MUST NOT CHANGE — en renders the same English the server sent', async () => {
    inviteMember.mockRejectedValue(
      authError(
        'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
        'You are not allowed to invite users to this organization',
      ),
    );
    renderIn('en', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('invite-email-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('invite-email-input'), { target: { value: 'p@x.test' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId('invite-error')).toBeInTheDocument());
    expect(screen.getByTestId('invite-error')).toHaveTextContent(
      'You are not allowed to invite users to this organization',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 3 — icon-only aria-labels
// ─────────────────────────────────────────────────────────────────────────────

describe('#4474 family 3 — icon-only buttons carry a translated aria-label — site 6', () => {
  it('zh: the members row action trigger', async () => {
    renderIn('zh', <MembersPage />);
    await waitFor(() => expect(screen.getByTestId('members-page')).toBeInTheDocument());
    // Pre-fix: aria-label="Member actions" — the ONLY label a screen reader gets.
    expect(screen.getAllByLabelText('成员操作').length).toBeGreaterThan(0);
  });

  it('zh: the invitation row copy and cancel triggers', async () => {
    renderIn('zh', <InvitationsPage />);
    await waitFor(() => expect(screen.getByTestId('invitations-page')).toBeInTheDocument());
    // Pre-fix: aria-label="Copy invitation link" / "Cancel invitation".
    expect(screen.getByLabelText('复制邀请链接')).toBeInTheDocument();
    expect(screen.getByLabelText('取消邀请')).toBeInTheDocument();
  });

  it('zh: the share-link copy button in the invite dialog — sibling holdout', async () => {
    inviteMember.mockResolvedValue({ id: 'inv-9', email: 'p@x.test', role: 'member' });
    renderIn('zh', <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('invite-email-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('invite-email-input'), { target: { value: 'p@x.test' } });
    fireEvent.submit(document.querySelector('form')!);
    // Pre-fix this button carried a bare aria-label="Copy" — a seventh
    // icon-only site the card's table did not reach.
    await waitFor(() => expect(screen.getByLabelText('复制邀请链接')).toBeInTheDocument());
  });

  it('MUST NOT CHANGE — en aria-labels stay the English the card measured', async () => {
    renderIn('en', <InvitationsPage />);
    await waitFor(() => expect(screen.getByTestId('invitations-page')).toBeInTheDocument());
    expect(screen.getByLabelText('Copy invitation link')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel invitation')).toBeInTheDocument();
  });
});
