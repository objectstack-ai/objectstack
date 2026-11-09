/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * invitationSignUpJoin — registering from an invitation link joins that
 * invitation's organization (#30125).
 *
 * An invitee who opened the link signed out reaches `/register?redirect=
 * /accept-invitation/ID` (`./invitationArrival`). Before, the new account then
 * landed on the accept page, pressed "Accept invitation", and pressed
 * "Continue" on "Invitation accepted": three screens for one decision the
 * person had already made by creating the account from that link. Both
 * register pages (the console's own and this package's `DefaultRegisterPage`)
 * now take that sign-up as the acceptance and enter the organization.
 *
 * What counts as consent, and what does not:
 *
 *  - Only the invitation the page's own `?redirect=` names is accepted, and
 *    only by a session that APPEARED on the page: the visitor was signed out
 *    when the first session check answered, so the session is the sign-up's.
 *    A person who opens the page already signed in accepts nothing here.
 *  - The server decides as it always does. The page reads the invitation
 *    (`get-invitation`) and accepts it (`accept-invitation`) as the new
 *    account; an address that is not the invited one is refused by the server,
 *    the hook answers `refused`, and the page goes on to the accept page as
 *    before, which shows that refusal.
 *  - A sign-up that waits for email verification creates no session here, so
 *    nothing is accepted on this page; the verification mail returns to the
 *    accept page.
 *
 * After the acceptance the session is switched to the organization, and the
 * page then enters it by a full-page navigation to the console root, the way
 * the accept page's "Continue" does (see `AcceptInvitationPage.handleContinue`
 * for why the root and not a resolved app).
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@object-ui/auth';
import { invitationIdOf } from './invitationArrival.js';

/**
 * Where a register page's invitation join stands:
 *
 *  - `none`: nothing to join here (no invitation redirect, nobody signed in
 *    yet, or the person was already signed in when the page opened);
 *  - `joining`: the sign-up created a session and the acceptance is in
 *    flight — the page holds instead of moving on;
 *  - `joined`: the server accepted the invitation and the session is on its
 *    organization — the page enters the console root;
 *  - `refused`: the server refused the read or the acceptance — the page goes
 *    on to the accept page, as it did before.
 */
export type InvitationSignUpJoin = 'none' | 'joining' | 'joined' | 'refused';

/**
 * Accept the page's invitation for the account its sign-up just created.
 * See the module header for when it applies.
 */
export function useInvitationSignUpJoin(redirect: string | null | undefined): InvitationSignUpJoin {
  const { user, isLoading, getInvitation, acceptInvitation, switchOrganization } = useAuth();
  const invitationId = invitationIdOf(redirect);

  // Latched the first time the session check answers with nobody signed in.
  // `isLoading` is raised again by the sign-up in flight, so it is read only
  // until the latch is set; latched while rendering, so the render that sees
  // the sign-up's user already knows the visitor arrived signed out.
  const [arrivedSignedOut, setArrivedSignedOut] = useState(false);
  if (!arrivedSignedOut && !isLoading && !user) setArrivedSignedOut(true);

  const applies = invitationId !== null && arrivedSignedOut && !!user;
  const [outcome, setOutcome] = useState<{ id: string; result: 'joined' | 'refused' } | null>(null);
  // One acceptance per invitation id: the effect re-runs whenever the auth
  // callbacks change identity, which a sign-up does.
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!applies || invitationId === null || startedFor.current === invitationId) return;
    startedFor.current = invitationId;
    const id = invitationId;
    void (async () => {
      let organizationId: string;
      try {
        const invitation = await getInvitation(id);
        await acceptInvitation(id);
        organizationId = invitation.organizationId;
      } catch {
        setOutcome({ id, result: 'refused' });
        return;
      }
      // As on the accept page: a failed switch still leaves the membership,
      // and the root's own organization step picks it.
      await switchOrganization(organizationId).catch(() => undefined);
      setOutcome({ id, result: 'joined' });
    })();
  }, [applies, invitationId, getInvitation, acceptInvitation, switchOrganization]);

  if (!applies) return 'none';
  return outcome && outcome.id === invitationId ? outcome.result : 'joining';
}
