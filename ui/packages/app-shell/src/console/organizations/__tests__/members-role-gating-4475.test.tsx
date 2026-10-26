// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4475 — the members / invitations tabs gate their affordances by the
 * active member's org role, instead of offering every one of them to everybody
 * and letting the server's 403 be the UI.
 *
 * ## The defect, as the card measured it
 *
 * A user whose org role is `member` opened `/organizations/<slug>/members` and
 * was shown an enabled **Invite member** button plus a per-row **Member
 * actions** menu carrying **Remove member** — on EVERY row, the workspace
 * Owner's included. Nothing was hidden or disabled; the action only failed
 * after the user committed to it, inline, in raw server English.
 *
 * ## Why this file keys on `activeMember.role` and asserts three DIFFERENT gates
 *
 * The tempting fix is `role === 'owner'`. That is wrong in both directions, and
 * the server says so. Measured against what actually enforces these routes —
 * better-auth 1.6.26's `defaultStatements` / `adminAc` / `ownerAc` / `memberAc`
 * (`plugins/organization/access/statement.mjs`), plus the `delegated_admin`
 * role the framework registers on top of them
 * (objectstack `packages/plugins/plugin-auth/src/auth-manager.ts`, the
 * `defaultAc.newRole({ ...memberAc.statements, invitation: ['create'] })`
 * block) — the three affordances on these two tabs sit behind three DIFFERENT
 * permissions:
 *
 *   | affordance          | route                        | permission             | who holds it                  |
 *   |---------------------|------------------------------|------------------------|-------------------------------|
 *   | Invite member       | `/organization/invite-member`| `invitation:["create"]`| owner, admin, delegated_admin |
 *   | Remove member       | `/organization/remove-member`| `member:["delete"]`    | owner, admin                  |
 *   | Cancel invitation   | `/organization/cancel-...`   | `invitation:["cancel"]`| owner, admin                  |
 *
 * `delegated_admin` is the row that makes a single `isOwner` boolean unable to
 * express this: it is built from `memberAc.statements` (so `member: []` — it
 * may NOT remove anyone) with `invitation: ['create']` added (so it MAY
 * invite), and deliberately WITHOUT `cancel`, because better-auth's cancel
 * route checks only the permission and never invitation attribution — the
 * server's own comment says so. Three gates, not one.
 *
 * So the assertions below are per-affordance, per-role, and they are the pin
 * that a later "simplification" to `role === 'owner'` has to break.
 *
 * ## Reverse verification (what turns these red)
 *
 * Deleting the `canInviteMembers` guard turns the four `member`/unresolved
 * invite assertions red; deleting `canRemoveMembers` turns the remove ones red
 * and the "the Owner's row too" case red; widening `canInviteMembers` to plain
 * grade>=admin turns the `delegated_admin` invite case red. The owner/admin
 * cases are green on BOTH sides of the fix by construction — they are the
 * must-not-change half, and they are what stops the gate being implemented as
 * "hide it from everyone".
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mocks ────────────────────────────────────────────────────────────────────

const getMembers = vi.fn();
const removeMember = vi.fn();
const updateMemberRole = vi.fn();
const listInvitations = vi.fn();
const cancelInvitation = vi.fn();
const inviteMember = vi.fn();
const describeDelegableScope = vi.fn();

/** The role the ACTIVE member carries — the one input every gate reads. */
const auth: { role: string | null } = { role: 'owner' };

// `importActual` spread, not a bare object: the real `orgRoleGrade` /
// `assignableOrgRoles` / `ORG_ROLE_*` are the subject's own dependencies, and
// stubbing them would make this file assert its own mock's opinion of the role
// model rather than the shipped one.
vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    getMembers,
    removeMember,
    updateMemberRole,
    listInvitations,
    cancelInvitation,
    inviteMember,
    describeDelegableScope,
    isAuthenticated: true,
    isLoading: false,
    activeMember: auth.role === null ? null : { role: auth.role },
  }),
}));

// The en oracle: `t()` returns the call site's inline `defaultValue`. This file
// is about which affordances RENDER, not about which language they render in —
// #4474's own file owns that. The pack-parity block at the bottom reads the
// real `builtInLocales`, which this spread keeps intact.
vi.mock('@object-ui/i18n', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      let out = opts?.defaultValue ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) {
        if (k !== 'defaultValue') out = out.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
      }
      return out;
    },
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({ org: { id: 'org-42', name: 'Acme', slug: 'acme' } }),
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
    Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    Input: (p: any) => <input {...p} />,
    Label: passthrough('label'),
    Separator: () => <hr />,
    Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    DialogContent: passthrough('div'),
    DialogDescription: passthrough('p'),
    DialogFooter: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('h2'),
    AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    AlertDialogAction: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    AlertDialogCancel: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    AlertDialogContent: passthrough('div'),
    AlertDialogDescription: passthrough('p'),
    AlertDialogFooter: passthrough('div'),
    AlertDialogHeader: passthrough('div'),
    AlertDialogTitle: passthrough('h2'),
    // Deliberately NOT gated on open state: the menu's items render inline, so
    // "is Remove member reachable at all" is a DOM query rather than a click
    // sequence. Pre-fix that is exactly how the card saw it.
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
    Upload: icon,
  };
});

import { builtInLocales } from '@object-ui/i18n/locales';
import { MembersPage } from '../manage/MembersPage';
import { InvitationsPage } from '../manage/InvitationsPage';

// ── Harness ──────────────────────────────────────────────────────────────────

const OWNER_ROW = 'm-1';
const MEMBER_ROW = 'm-2';

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'owner';
  describeDelegableScope.mockResolvedValue(null);
  getMembers.mockResolvedValue([
    { id: OWNER_ROW, role: 'owner', userId: 'u-1', user: { name: 'Ada', email: 'ada@x.test' } },
    { id: MEMBER_ROW, role: 'member', userId: 'u-2', user: { name: 'Bo', email: 'bo@x.test' } },
  ]);
  listInvitations.mockResolvedValue([
    { id: 'inv-1', email: 'cy@x.test', role: 'member', status: 'pending' },
  ]);
});

const mountMembers = async () => {
  render(<MembersPage />);
  await waitFor(() => expect(screen.getByTestId('members-page')).toBeInTheDocument());
};

const mountInvitations = async () => {
  render(<InvitationsPage />);
  await waitFor(() => expect(screen.getByTestId('invitations-page')).toBeInTheDocument());
};

/** Every "Remove member" item currently in the DOM, whatever row it sits on. */
const removeItems = () => screen.queryAllByText('Remove member');

// ─────────────────────────────────────────────────────────────────────────────
// The defect: a plain `member` is offered both write affordances
// ─────────────────────────────────────────────────────────────────────────────

describe('#4475 — a `member` is offered no member-management affordance', () => {
  beforeEach(() => {
    auth.role = 'member';
  });

  it('shows no Invite member button', async () => {
    await mountMembers();
    expect(screen.queryByTestId('invite-member-btn')).toBeNull();
  });

  it('shows no Remove member action on ANY row — the Owner’s included', async () => {
    await mountMembers();
    // Pre-fix this was 2: one per row, the owner row's being the card's
    // headline ("including on the row of the workspace Owner").
    expect(removeItems()).toHaveLength(0);
  });

  it('renders no row action menu at all rather than an empty popup', async () => {
    await mountMembers();
    // `assignableOrgRoles('member', …)` was already empty pre-fix, so once
    // Remove goes the menu has nothing left. An affordance that opens onto
    // nothing is worse than no affordance.
    expect(screen.queryAllByLabelText('Member actions')).toHaveLength(0);
  });

  it('still lists the members — gating removes actions, never the page', async () => {
    await mountMembers();
    expect(screen.getByTestId(`member-row-${OWNER_ROW}`)).toBeInTheDocument();
    expect(screen.getByTestId(`member-row-${MEMBER_ROW}`)).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('explains the absence where the Invite button used to sit', async () => {
    // The Settings tab's own convention, mirrored: the explanatory copy takes
    // the PLACE of the affordance it replaces (there, the form; here, the
    // button), so the space does not simply go blank.
    await mountMembers();
    expect(screen.getByTestId('invite-restricted-note')).toHaveTextContent(
      'Only organization admins can invite members.',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Must-not-change: the roles the server DOES admit keep both affordances
// ─────────────────────────────────────────────────────────────────────────────

describe('#4475 must-not-change — owner and admin keep every affordance', () => {
  for (const role of ['owner', 'admin'] as const) {
    it(`${role}: Invite member is present`, async () => {
      auth.role = role;
      await mountMembers();
      expect(screen.getByTestId('invite-member-btn')).toBeInTheDocument();
      expect(screen.queryByTestId('invite-restricted-note')).toBeNull();
    });

    it(`${role}: Remove member is offered on every row`, async () => {
      auth.role = role;
      await mountMembers();
      expect(removeItems()).toHaveLength(2);
    });

    it(`${role}: the row action menu is present`, async () => {
      auth.role = role;
      await mountMembers();
      expect(screen.queryAllByLabelText('Member actions')).toHaveLength(2);
    });
  }

  it('admin still cannot RE-ROLE an owner, and that narrowing is untouched', async () => {
    // Pinned so the new remove gate cannot be mistaken for the role-item gate:
    // `assignableOrgRoles('admin', 'owner')` is empty (better-auth's creatorRole
    // protection), yet an admin DOES hold `member:["delete"]`. The owner row
    // therefore keeps its menu, with Remove and no role items.
    auth.role = 'admin';
    await mountMembers();
    const ownerRow = screen.getByTestId(`member-row-${OWNER_ROW}`);
    expect(ownerRow.querySelector('[data-testid="member-role-owner"]')).toBeNull();
    expect(ownerRow.textContent).toContain('Remove member');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `delegated_admin` — the role a single `isOwner` boolean cannot express
// ─────────────────────────────────────────────────────────────────────────────

describe('#4475 — delegated_admin may invite but may NOT remove', () => {
  beforeEach(() => {
    auth.role = 'delegated_admin';
  });

  it('sees the Invite member button (holds invitation:["create"])', async () => {
    await mountMembers();
    expect(screen.getByTestId('invite-member-btn')).toBeInTheDocument();
  });

  it('sees no Remove member action (built from memberAc — member: [])', async () => {
    await mountMembers();
    expect(removeItems()).toHaveLength(0);
  });

  it('gets no row action menu, having neither remove nor any assignable role', async () => {
    await mountMembers();
    expect(screen.queryAllByLabelText('Member actions')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed floor
// ─────────────────────────────────────────────────────────────────────────────

describe('#4475 — an unresolved active member is offered nothing', () => {
  it('null activeMember: no invite, no remove', async () => {
    auth.role = null;
    await mountMembers();
    expect(screen.queryByTestId('invite-member-btn')).toBeNull();
    expect(removeItems()).toHaveLength(0);
  });

  it('an unknown role grades as an ordinary member', async () => {
    auth.role = 'sales_rep';
    await mountMembers();
    expect(screen.queryByTestId('invite-member-btn')).toBeNull();
    expect(removeItems()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The invitations tab, gated by the SAME measured rule
// ─────────────────────────────────────────────────────────────────────────────

describe('#4475 — the invitations tab gates copy-link and cancel', () => {
  const copyBtn = () => screen.queryByLabelText('Copy invitation link');
  const cancelBtn = () => screen.queryByLabelText('Cancel invitation');

  it('member: neither affordance is present', async () => {
    auth.role = 'member';
    await mountInvitations();
    expect(copyBtn()).toBeNull();
    expect(cancelBtn()).toBeNull();
  });

  it('member: the ledger itself still renders (objectstack#8095 owns that question)', async () => {
    // Scope guard, pinned: whether `org_member` should READ the invitation
    // ledger at all is escalated server-side and deliberately NOT decided here.
    // This card only removes the WRITE affordances.
    auth.role = 'member';
    await mountInvitations();
    expect(screen.getByTestId('invitation-row-inv-1')).toBeInTheDocument();
    expect(screen.getByText('cy@x.test')).toBeInTheDocument();
  });

  for (const role of ['owner', 'admin'] as const) {
    it(`${role}: keeps copy-link and cancel`, async () => {
      auth.role = role;
      await mountInvitations();
      expect(copyBtn()).toBeInTheDocument();
      expect(cancelBtn()).toBeInTheDocument();
    });
  }

  it('delegated_admin: may deliver an invitation, may not cancel one', async () => {
    // The server's asymmetry, mirrored exactly: `invitation: ['create']` was
    // added WITHOUT `cancel` because better-auth's cancel route checks only the
    // permission and would therefore mean "cancel anyone's pending invitation".
    auth.role = 'delegated_admin';
    await mountInvitations();
    expect(copyBtn()).toBeInTheDocument();
    expect(cancelBtn()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4474's channel: one new string, present in all ten packs
// ─────────────────────────────────────────────────────────────────────────────

describe('#4475 — the new note is translatable in every pack', () => {
  it('all ten packs define organization.members.inviteRestrictedNote', () => {
    const langs = Object.keys(builtInLocales) as Array<keyof typeof builtInLocales>;
    expect(langs.length).toBe(10);
    for (const lang of langs) {
      const value = (builtInLocales[lang] as any).organization?.members?.inviteRestrictedNote;
      expect(typeof value, `${lang}.organization.members.inviteRestrictedNote`).toBe('string');
      expect(value.length, `${lang} value is empty`).toBeGreaterThan(0);
    }
  });

  it('the en value is exactly the call site’s inline defaultValue', () => {
    // `scripts/check-i18n-call-site-keys.mjs` enforces this too; asserting it
    // here keeps the pair readable from the test that depends on the string.
    expect((builtInLocales.en as any).organization.members.inviteRestrictedNote).toBe(
      'Only organization admins can invite members.',
    );
  });
});
