// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The copied invitation link must be one the recipient can actually open
 * (objectui#4472).
 *
 * Both copy sites — the Invitations tab's per-row "Copy invitation link" and
 * the invite dialog's freshly-created "Accept link" — used to rebuild the URL
 * locally from `${window.location.origin}${import.meta.env.BASE_URL}`. In the
 * portable build the console ships with (`base: './'`, see
 * `apps/console/vite.config.ts`) `BASE_URL` is `'.'`, so that form produced
 *
 *     http://localhost:8080./accept-invitation/<id>
 *
 * — a trailing-dot host — and, once the dot was removed by hand, still missed
 * the deployment mount: the console is served under `/_console/` (the server
 * injects `<base href="/_console/">`), and `GET /accept-invitation/<id>`
 * answers `{"error":"Not found"}`.
 *
 * These cases pin the two properties a recipient depends on, at both copy
 * sites and in both deployment shapes (`/_console/` mount and root mount):
 * no trailing-dot host, and the console mount is present.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

const listInvitations = vi.fn();
const cancelInvitation = vi.fn();
const inviteMember = vi.fn();
const describeDelegableScope = vi.fn();
// Only `useAuth` is faked — the role vocabulary stays REAL (same convention as
// the sibling InviteMemberDialog specs).
vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    listInvitations,
    cancelInvitation,
    inviteMember,
    describeDelegableScope,
    activeMember: { role: 'owner' },
  }),
}));

// InvitationsPage reads the org from the router outlet; the org identity is
// irrelevant here, only the invitation id reaches the URL.
vi.mock('../manage/orgContext', () => ({
  useOrgContext: () => ({ org: { id: 'org-42', name: 'Acme', slug: 'acme' } }),
}));

// Passthrough primitives — these cases assert a string, not the design system.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: (p: any) => <div {...p} />,
  AvatarFallback: (p: any) => <div {...p} />,
  Badge: (p: any) => <span {...p} />,
  Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
  Separator: () => <hr />,
  AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  AlertDialogAction: (p: any) => <button {...p} />,
  AlertDialogCancel: (p: any) => <button {...p} />,
  AlertDialogContent: (p: any) => <div {...p} />,
  AlertDialogDescription: (p: any) => <p {...p} />,
  AlertDialogFooter: (p: any) => <div {...p} />,
  AlertDialogHeader: (p: any) => <div {...p} />,
  AlertDialogTitle: (p: any) => <h2 {...p} />,
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: (p: any) => <div {...p} />,
  DialogDescription: (p: any) => <p {...p} />,
  DialogFooter: (p: any) => <div {...p} />,
  DialogHeader: (p: any) => <div {...p} />,
  DialogTitle: (p: any) => <h2 {...p} />,
  Input: (p: any) => <input {...p} />,
  Label: (p: any) => <label {...p} />,
  Select: ({ value, onValueChange, children }: any) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectContent: (p: any) => <>{p.children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: (p: any) => <>{p.children}</>,
  SelectValue: () => null,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Loader2: () => <span />,
  Copy: () => <span />,
  Check: () => <span />,
  X: () => <span />,
  Mail: () => <span />,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InvitationsPage } from '../manage/InvitationsPage';
import { InviteMemberDialog } from '../manage/InviteMemberDialog';

const INVITATION_ID = 'bgn1XAfRuCQUS1l9NBqOMGgJDUYm5l56';
const ORIGIN = 'http://localhost:8080';

function setBaseHref(href: string | null): void {
  document.head.querySelectorAll('base').forEach((el) => el.remove());
  if (href != null) {
    const base = document.createElement('base');
    base.setAttribute('href', href);
    document.head.appendChild(base);
  }
}

let writeText: ReturnType<typeof vi.fn>;

/**
 * The whole answer, not a prefix: one resolver, one URL. Asserting the full
 * string also catches a doubled mount segment, and the two explicit guards
 * below name the defects this pins so a failure reads as the bug report did.
 */
function expectOpenableAcceptUrl(url: string, expected: string): void {
  // Defect 1 — the portable-build trailing-dot host: `${origin}` + `'.'`
  // glued a dot onto the authority (`localhost:8080.`).
  expect(url).not.toMatch(/:\d+\./);
  expect(new URL(url).hostname.endsWith('.')).toBe(false);
  // Defect 2 — the missing console mount (this is the half that goes red on a
  // reintroduced local builder; see the BASE_URL note in beforeEach).
  expect(url).toBe(expected);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The portable build the console actually ships (`base: './'`), under which
  // the retired local builder produced the trailing-dot host.
  //
  // Caveat, measured: this stub reaches only the EXACT `import.meta.env.BASE_URL`
  // spelling. The retired builder read `(import.meta as any).env?.BASE_URL`, and
  // Vite inlines a bare `import.meta.env` as an object literal at transform
  // time, so that read always saw `'/'` here and no stub could move it. The
  // trailing-dot half of this pin therefore cannot go red on its own in vitest;
  // the mount assertion is what fails when a local builder comes back (verified
  // red-first — it reported `/accept-invitation/…` against `/_console/…`).
  vi.stubEnv('BASE_URL', '.');
  // The issue's repro ran against a dev server on :8080; happy-dom defaults to
  // :3000. Pinning it keeps the asserted URL the one in the bug report.
  (
    window as unknown as { happyDOM?: { setURL?: (url: string) => void } }
  ).happyDOM?.setURL?.('http://localhost:8080/_console/organizations/org-42/invitations');
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  listInvitations.mockResolvedValue([
    {
      id: INVITATION_ID,
      email: 'lisi@acme-test.com',
      role: 'member',
      status: 'pending',
      expiresAt: null,
    },
  ]);
  inviteMember.mockResolvedValue({
    id: INVITATION_ID,
    email: 'lisi@acme-test.com',
    role: 'member',
  });
  describeDelegableScope.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setBaseHref(null);
});

async function copyFromInvitationsTab(): Promise<string> {
  render(<InvitationsPage />);
  fireEvent.click(await screen.findByLabelText('Copy invitation link'));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  return writeText.mock.calls[0][0] as string;
}

async function shareLinkFromInviteDialog(): Promise<{ shown: string; copied: string }> {
  const { container } = render(
    <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />,
  );
  fireEvent.change(screen.getByTestId('invite-email-input'), {
    target: { value: 'lisi@acme-test.com' },
  });
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(inviteMember).toHaveBeenCalledTimes(1));

  // The "share link" view: a read-only field holding the accept URL, plus a
  // copy button. Both must carry the same openable URL.
  const field = await screen.findByRole('textbox');
  // The label was a bare "Copy" until objectui#4474 gave this icon-only button
  // the same name as the Invitations tab's copy control — same action, same
  // words. Only the query moved; every URL assertion below is unchanged.
  fireEvent.click(screen.getByLabelText('Copy invitation link'));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  return { shown: (field as HTMLInputElement).value, copied: writeText.mock.calls[0][0] as string };
}

describe('copied invitation link — console mount (objectui#4472)', () => {
  describe('served under the /_console/ mount', () => {
    beforeEach(() => setBaseHref('/_console/'));

    it('Invitations tab: the copied link keeps the mount and has no trailing-dot host', async () => {
      expectOpenableAcceptUrl(
        await copyFromInvitationsTab(),
        `${ORIGIN}/_console/accept-invitation/${INVITATION_ID}`,
      );
    });

    it('invite dialog: the shared link keeps the mount and has no trailing-dot host', async () => {
      const { shown, copied } = await shareLinkFromInviteDialog();
      expectOpenableAcceptUrl(shown, `${ORIGIN}/_console/accept-invitation/${INVITATION_ID}`);
      // The displayed field and the clipboard must not drift apart.
      expect(copied).toBe(shown);
    });
  });

  describe('served at the document root', () => {
    beforeEach(() => setBaseHref('/'));

    it('Invitations tab: the copied link is the plain root accept route', async () => {
      expectOpenableAcceptUrl(
        await copyFromInvitationsTab(),
        `${ORIGIN}/accept-invitation/${INVITATION_ID}`,
      );
    });

    it('invite dialog: the shared link is the plain root accept route', async () => {
      const { shown } = await shareLinkFromInviteDialog();
      expectOpenableAcceptUrl(shown, `${ORIGIN}/accept-invitation/${INVITATION_ID}`);
    });
  });
});
