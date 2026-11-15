/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The signed-out side of carrying a link refusal (objectstack#33063).
 *
 * A signed-in person whose link is refused is told where they land
 * (`src/__tests__/App.linkRefusalLanding-33063.test.tsx`). Here: a person who
 * is NOT signed in still reads the login page's own sentence for the code they
 * came back with, and nothing is held for a landing; and the landing never
 * shows a slot value it has no sentence for.
 *
 * Driven through the real LoginPage over the real `AuthProvider` and a mock
 * client, as `LoginPage.access-denied-32992.test.tsx`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { LINK_REFUSAL_STORAGE_KEY, LinkRefusalNotice } from '../../../components/LinkRefusalNotice';
import { serveDeploymentWithOwner } from '../../../__tests__/helpers/ownerProbeDouble';

serveDeploymentWithOwner();

const ACCESS_DENIED_SENTENCE =
  "The account you signed in with does not have access to this environment. Sign in with an account that has access, or ask an administrator of this environment's organization to add you as a member.";

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(cleanup);

function renderSignedOutLogin(search: string) {
  window.history.replaceState({}, '', `/login${search}`);
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({ features: {} }),
  } as unknown as AuthClient;
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('a link refusal is carried only for a signed-in person (objectstack#33063)', () => {
  it('CONTROL: signed out with ?error=access_denied, the login page keeps its own sentence and holds nothing', async () => {
    renderSignedOutLogin('?error=access_denied&state=abc');

    expect((await screen.findByRole('alert')).textContent).toBe(ACCESS_DENIED_SENTENCE);
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });

  it('CONTROL: signed out with the link code itself, the form is drawn and nothing is held for a landing', async () => {
    renderSignedOutLogin('?error=email_does_not_match');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });

  it('the landing shows only a code it has a sentence for: any other slot value is dropped, never shown', async () => {
    sessionStorage.setItem(LINK_REFUSAL_STORAGE_KEY, '<b>not a code</b>');
    render(
      <>
        <Toaster />
        <LinkRefusalNotice />
      </>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByTestId('link-refusal-notice')).toBeNull();
    expect(document.body.textContent).not.toContain('not a code');
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });
});
