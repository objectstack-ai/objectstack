// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The person's Slack section (#34730 step 3): connect → proposal → confirm →
 * linked, cancel, disconnect, and each answer of the Slack link doors drawn as
 * the door gave it. The doors are faked by URL and method with the envelopes
 * `slack-link-routes.ts` writes; `t` echoes the KEY.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
}));

import { SlackLinkSection } from './SlackLinkSection';
import { SLACK_LINK_URL } from './slackDoors';

const ACME = { id: 'acc1', workspace: 'Acme', workspaceId: 'T1', status: 'active' };
const LINKED = { id: 'l1', userId: 'alice', slackUserId: 'UADA', slackUserName: 'Ada', state: 'confirmed', confirmedAt: '2026-11-20T10:00:00.000Z' };
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const refused = (status: number, code: string, message: string, userMessage?: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message, ...(userMessage ? { userMessage } : {}) } }), { status });

type Route = (state: { account: unknown; link: unknown }) => Response;

/** A fake of the four person doors over one stored state; `routes` overrides a door by `METHOD path`. */
function doors(initial: { account: unknown; link: unknown }, routes: Record<string, Route> = {}) {
  const state = { ...initial };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (routes[key]) return routes[key](state);
    switch (key) {
      case `GET ${SLACK_LINK_URL}`:
        return ok(state);
      case `POST ${SLACK_LINK_URL}/proposal`:
        state.link = { state: 'proposed' };
        return ok({ link: state.link });
      case `POST ${SLACK_LINK_URL}/confirm`:
        state.link = LINKED;
        return ok({ link: LINKED });
      case `DELETE ${SLACK_LINK_URL}`: {
        const removed = state.link !== null;
        state.link = null;
        return ok({ removed });
      }
    }
    return refused(404, 'NOT_FOUND', key);
  });
  return { fetch, state };
}

const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${url}`);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SlackLinkSection', () => {
  it('connect → the proposal names no one → confirm → linked', async () => {
    const { fetch } = doors({ account: ACME, link: null });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-connect'));
    const proposal = await screen.findByTestId('slack-link-proposal');
    expect(proposal).toHaveTextContent('«slackLink.proposed»');
    expect(proposal).not.toHaveTextContent('Ada');

    fireEvent.click(screen.getByTestId('slack-link-confirm'));
    expect(await screen.findByTestId('slack-link-linked')).toHaveTextContent('«slackLink.linked»');
    expect(calls(fetch)).toEqual([
      `GET ${SLACK_LINK_URL}`,
      `POST ${SLACK_LINK_URL}/proposal`,
      `GET ${SLACK_LINK_URL}`,
      `POST ${SLACK_LINK_URL}/confirm`,
      `GET ${SLACK_LINK_URL}`,
    ]);
  });

  it('cancel removes the proposal', async () => {
    const { fetch, state } = doors({ account: ACME, link: { state: 'proposed' } });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-cancel'));
    expect(await screen.findByTestId('slack-link-connect')).toBeInTheDocument();
    expect(state.link).toBeNull();
    expect(calls(fetch)).toContain(`DELETE ${SLACK_LINK_URL}`);
  });

  it('disconnect removes the link', async () => {
    const { fetch, state } = doors({ account: ACME, link: LINKED });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-disconnect'));
    expect(await screen.findByTestId('slack-link-connect')).toBeInTheDocument();
    expect(state.link).toBeNull();
  });

  it('no install: says so and offers nothing', async () => {
    const { fetch } = doors({ account: null, link: null });
    render(<SlackLinkSection apiFetch={fetch} />);

    expect(await screen.findByTestId('slack-link-not-installed')).toHaveTextContent('«slackLink.notInstalled»');
    expect(screen.queryByTestId('slack-link-connect')).toBeNull();
  });

  it('a revoked token: says so and offers no connect', async () => {
    const { fetch } = doors({ account: { ...ACME, status: 'revoked' }, link: null });
    render(<SlackLinkSection apiFetch={fetch} />);

    expect(await screen.findByTestId('slack-link-revoked')).toHaveTextContent('«slackLink.revoked»');
    expect(screen.queryByTestId('slack-link-connect')).toBeNull();
  });

  it('a proposal answering link: null (no verified email, or no Slack user for it) names every cause, never one', async () => {
    const { fetch } = doors({ account: ACME, link: null }, { [`POST ${SLACK_LINK_URL}/proposal`]: () => ok({ link: null }) });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-connect'));
    expect(await screen.findByTestId('slack-link-no-match')).toHaveTextContent('«slackLink.noMatch»');
    expect(screen.getByTestId('slack-link-connect')).toBeInTheDocument();
  });

  it('a stale proposal: the server’s own sentence (its userMessage), and a new proposal can be asked for', async () => {
    const stale = 'Your email is no longer verified, or is not the email this Slack link was proposed for: ask for a new proposal. Nothing was changed.';
    const { fetch } = doors({ account: ACME, link: { state: 'proposed' } }, {
      [`POST ${SLACK_LINK_URL}/confirm`]: () => refused(409, 'RESOURCE_CONFLICT', 'english', stale),
    });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-confirm'));
    expect(await screen.findByTestId('slack-link-refused')).toHaveTextContent(stale);
    fireEvent.click(await screen.findByTestId('slack-link-propose-again'));
    await waitFor(() => expect(calls(fetch)).toContain(`POST ${SLACK_LINK_URL}/proposal`));
  });

  it('a replaced or removed proposal: the server’s 404 sentence, and the section reads the door again', async () => {
    const gone = 'You have no proposed Slack link in this organization to confirm: ask for a proposal first. Nothing was changed.';
    const { fetch } = doors({ account: ACME, link: { state: 'proposed' } }, {
      [`POST ${SLACK_LINK_URL}/confirm`]: (s) => {
        s.link = null;
        return refused(404, 'RESOURCE_NOT_FOUND', gone);
      },
    });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-confirm'));
    expect(await screen.findByTestId('slack-link-refused')).toHaveTextContent(gone);
    expect(await screen.findByTestId('slack-link-connect')).toBeInTheDocument();
  });

  it('Slack refusing the token mid-proposal: the server’s 502 sentence, then the revoked install as re-read', async () => {
    const { fetch } = doors({ account: ACME, link: null }, {
      [`POST ${SLACK_LINK_URL}/proposal`]: (s) => {
        s.account = { ...ACME, status: 'revoked' };
        return refused(502, 'EXTERNAL_SERVICE_ERROR', 'Slack answered token_revoked. Nothing was changed.');
      },
    });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-connect'));
    expect(await screen.findByTestId('slack-link-refused')).toHaveTextContent('Slack answered token_revoked. Nothing was changed.');
    expect(await screen.findByTestId('slack-link-revoked')).toBeInTheDocument();
  });

  it('no install when the person clicks: the server’s 409 sentence', async () => {
    const message = 'Slack is not installed for this organization: an administrator installs it first. Nothing was changed.';
    const { fetch } = doors({ account: ACME, link: null }, {
      [`POST ${SLACK_LINK_URL}/proposal`]: (s) => {
        s.account = null;
        return refused(409, 'RESOURCE_CONFLICT', message);
      },
    });
    render(<SlackLinkSection apiFetch={fetch} />);

    fireEvent.click(await screen.findByTestId('slack-link-connect'));
    expect(await screen.findByTestId('slack-link-refused')).toHaveTextContent(message);
    expect(await screen.findByTestId('slack-link-not-installed')).toBeInTheDocument();
  });

  it('a failed read says so', async () => {
    const { fetch } = doors({ account: null, link: null }, { [`GET ${SLACK_LINK_URL}`]: () => refused(503, 'SERVICE_UNAVAILABLE', 'no data engine') });
    render(<SlackLinkSection apiFetch={fetch} />);

    expect(await screen.findByTestId('slack-link-load-failed')).toHaveTextContent('«slackLink.loadFailed»');
  });
});
