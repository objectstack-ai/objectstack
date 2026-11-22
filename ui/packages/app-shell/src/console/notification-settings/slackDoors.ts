// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Slack link doors of the messaging service (`slack-link-routes.ts` in
 * `@objectstack/service-messaging`, ADR-0013 addendum of 2026-11-19), as the
 * console calls them: the person's own link on the Notification Settings page
 * (`SlackLinkSection`), and an organization administrator's install and links
 * on Setup's Slack page (`SlackSetupPage`). Every call goes through the host's
 * authenticated fetch, as the page's own preference read does.
 *
 * What the doors answer is read as served and nothing is added to it:
 *
 *  - ⛔ no answer carries the token, so none is ever shown;
 *  - a proposal names no Slack user before it is confirmed: the person's own
 *    view of it is `{ state: 'proposed' }`, and an administrator's list shows
 *    it with `slackUserId` and `slackUserName` null;
 *  - a proposal answers `link: null` when the person has no verified email,
 *    when no Slack user of the workspace holds it, and when that Slack user is
 *    linked to someone else in the install. The door does not say which, so
 *    the page names all three and never picks one.
 *
 * A refusal is the server's own sentence: its `userMessage` (already in the
 * caller's language) when it carries one, else its `message`.
 */

/** The person's own link, in their current organization. */
export const SLACK_LINK_URL = '/api/v1/messaging/me/slack-link';
/** The organization's install: read, set the token, remove. */
export const SLACK_ACCOUNT_URL = '/api/v1/messaging/slack/account';
/** Every link to the organization's install. */
export const SLACK_LINKS_URL = '/api/v1/messaging/slack/links';
/** The capability every administrator door asks in the caller's current organization (`SLACK_ADMIN_CAPABILITY`). */
export const SLACK_ADMIN_CAPABILITY = 'setup.write';
/**
 * The most links `GET /slack/links` answers: the store reads them unpaged
 * with `limit: 10000`. A list this long may be incomplete; the page says so
 * and never pages on its own.
 */
export const SLACK_LINKS_SERVED_CAP = 10000;

export interface SlackAccount {
  id: string;
  workspace: string;
  workspaceId: string;
  status: 'active' | 'revoked';
}

export interface SlackLink {
  id: string;
  userId: string;
  slackUserId: string | null;
  slackUserName: string | null;
  state: 'proposed' | 'confirmed';
  confirmedAt: string | null;
}

/** The person's own link: a proposal names no one; a confirmed link is the full view. */
export type OwnSlackLink = { state: 'proposed' } | (SlackLink & { state: 'confirmed' });

export interface SlackRefusal {
  status: number;
  code: string;
  message: string;
}

export type SlackAnswer<T> = { ok: true; data: T } | { ok: false; refusal: SlackRefusal };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const textOrNull = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' ? v : undefined);

function readAccount(raw: unknown): SlackAccount | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw) || !text(raw.id) || typeof raw.workspace !== 'string' || typeof raw.workspaceId !== 'string') return undefined;
  if (raw.status !== 'active' && raw.status !== 'revoked') return undefined;
  return { id: raw.id as string, workspace: raw.workspace, workspaceId: raw.workspaceId, status: raw.status };
}

function readLink(raw: unknown): SlackLink | undefined {
  if (!isObject(raw) || !text(raw.id) || !text(raw.userId)) return undefined;
  if (raw.state !== 'proposed' && raw.state !== 'confirmed') return undefined;
  const slackUserId = textOrNull(raw.slackUserId);
  const slackUserName = textOrNull(raw.slackUserName);
  const confirmedAt = textOrNull(raw.confirmedAt);
  if (slackUserId === undefined || slackUserName === undefined || confirmedAt === undefined) return undefined;
  return { id: raw.id as string, userId: raw.userId as string, slackUserId, slackUserName, state: raw.state, confirmedAt };
}

function readOwnLink(raw: unknown): OwnSlackLink | null | undefined {
  if (raw === null) return null;
  if (isObject(raw) && raw.state === 'proposed') return { state: 'proposed' };
  const link = readLink(raw);
  return link?.state === 'confirmed' ? { ...link, state: 'confirmed' } : undefined;
}

const readRemoved = (data: Record<string, unknown>) => (typeof data.removed === 'boolean' ? data.removed : undefined);

/** One door call: the success envelope's `data` read by `read`, or the refusal in the server's own words. */
async function door<T>(
  doFetch: Fetch,
  method: string,
  url: string,
  read: (data: Record<string, unknown>) => T | undefined,
  body?: Record<string, unknown>,
): Promise<SlackAnswer<T>> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method,
      credentials: 'include',
      headers: body ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    return { ok: false, refusal: { status: 0, code: '', message: err instanceof Error && err.message ? err.message : String(err) } };
  }
  const payload: unknown = await res.json().catch(() => null);
  const envelope = isObject(payload) ? payload : {};
  if (res.ok && envelope.success !== false && isObject(envelope.data)) {
    const data = read(envelope.data);
    if (data !== undefined) return { ok: true, data };
    return { ok: false, refusal: { status: res.status, code: '', message: `${method} ${url} answered no readable answer.` } };
  }
  const error = isObject(envelope.error) ? envelope.error : {};
  return {
    ok: false,
    refusal: {
      status: res.status,
      code: text(error.code) ?? '',
      message: text(error.userMessage) ?? text(error.message) ?? `${method} ${url} answered ${res.status}.`,
    },
  };
}

/** `GET /me/slack-link`: the install (its workspace) and the person's link, each `null` when there is none. */
export function readOwnSlackLink(f: Fetch): Promise<SlackAnswer<{ account: SlackAccount | null; link: OwnSlackLink | null }>> {
  return door(f, 'GET', SLACK_LINK_URL, (d) => {
    const account = readAccount(d.account);
    const link = readOwnLink(d.link);
    return account === undefined || link === undefined ? undefined : { account, link };
  });
}

/** `POST /me/slack-link/proposal`: `null` when nothing was proposed. */
export function proposeSlackLink(f: Fetch): Promise<SlackAnswer<OwnSlackLink | null>> {
  return door(f, 'POST', `${SLACK_LINK_URL}/proposal`, (d) => readOwnLink(d.link));
}

/** `POST /me/slack-link/confirm`: the confirmed link. */
export function confirmSlackLink(f: Fetch): Promise<SlackAnswer<OwnSlackLink>> {
  return door(f, 'POST', `${SLACK_LINK_URL}/confirm`, (d) => readOwnLink(d.link) ?? undefined);
}

/** `DELETE /me/slack-link`: the person's link or proposal goes. */
export function removeOwnSlackLink(f: Fetch): Promise<SlackAnswer<boolean>> {
  return door(f, 'DELETE', SLACK_LINK_URL, readRemoved);
}

/** `GET /slack/account`: the install without its token, `null` when there is none. */
export function readSlackAccount(f: Fetch): Promise<SlackAnswer<SlackAccount | null>> {
  return door(f, 'GET', SLACK_ACCOUNT_URL, (d) => readAccount(d.account));
}

/** `PUT /slack/account` `{ token }`: install, or set the token again. */
export function installSlack(f: Fetch, token: string): Promise<SlackAnswer<SlackAccount>> {
  return door(f, 'PUT', SLACK_ACCOUNT_URL, (d) => readAccount(d.account) ?? undefined, { token });
}

/** `DELETE /slack/account`: the install and every link to it go; each linked person is told. */
export function uninstallSlack(f: Fetch): Promise<SlackAnswer<boolean>> {
  return door(f, 'DELETE', SLACK_ACCOUNT_URL, readRemoved);
}

/** `GET /slack/links`: every link to the install, as served. */
export function listSlackLinks(f: Fetch): Promise<SlackAnswer<SlackLink[]>> {
  return door(f, 'GET', SLACK_LINKS_URL, (d) => {
    if (!Array.isArray(d.links)) return undefined;
    const links = d.links.map(readLink);
    return links.every((l): l is SlackLink => l !== undefined) ? links : undefined;
  });
}

/** `DELETE /slack/links/:id`: one link goes; the person is told. */
export function removeSlackLink(f: Fetch, id: string): Promise<SlackAnswer<boolean>> {
  return door(f, 'DELETE', `${SLACK_LINKS_URL}/${encodeURIComponent(id)}`, readRemoved);
}
