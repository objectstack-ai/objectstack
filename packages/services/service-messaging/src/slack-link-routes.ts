// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
    ANONYMOUS_DENY_CODE,
    ANONYMOUS_DENY_MESSAGE,
    ANONYMOUS_DENY_STATUS,
    evaluateAuthGate,
    isApiKeyLifecycleRefusalError,
    isAuthzStoreUnavailableError,
    resolveOfferedLocale,
    shouldDenyAnonymous,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { sendError, sendOk, sendServerFault } from '@objectstack/types';
import { SlackLinkError, type SlackAccount, type SlackLink, type SlackLinkStore } from './slack-links.js';
import { enMessages, messagingMessages, type MessagingLocale, type MessagingMessageId } from './translations/messages.js';

/**
 * The Slack link doors (ADR-0013 addendum of 2026-11-19, step 2), the server
 * half of step 3's notification settings page and Setup screen.
 *
 * ## The person — about themselves, in their current organization
 *
 *  - `GET    /api/v1/messaging/me/slack-link` — the install (its workspace) and
 *    their link, each `null` when there is none.
 *  - `POST   /api/v1/messaging/me/slack-link/proposal` — propose a link by
 *    their verified email; `link: null` when nothing matched or the email is
 *    not verified, and `link: { state: 'proposed' }` — no Slack user's name
 *    or id — when a match was found.
 *  - `POST   /api/v1/messaging/me/slack-link/confirm` — confirm the proposal,
 *    while the email is still verified and still the one it was proposed for.
 *  - `DELETE /api/v1/messaging/me/slack-link` — remove their link.
 *
 * ## An organization administrator — in their current organization
 *
 * {@link SLACK_ADMIN_CAPABILITY}, `setup.write`, held in the caller's CURRENT
 * organization (`ExecutionContext.systemPermissions`): the organization
 * administrator's capability the in-app message door asks
 * (`in-app-message-routes.ts`), which both organization-administrator sets and
 * the platform administrator's grant hold and `member_default` does not
 * (ruling `7024100939`, rider 5). Not `isPlatformAdmin`: an install and its
 * links belong to one organization.
 *
 *  - `GET    /api/v1/messaging/slack/account` — the install, without its token.
 *  - `PUT    /api/v1/messaging/slack/account` — `{ token }`: install, or set
 *    the token again; Slack proves it (`auth.test`) before anything is saved.
 *  - `DELETE /api/v1/messaging/slack/account` — remove the install and every
 *    link to it; each linked person is told.
 *  - `GET    /api/v1/messaging/slack/links` — every link to the install.
 *  - `DELETE /api/v1/messaging/slack/links/:id` — remove one; the person is
 *    told, and may confirm a new link at once (rider 4).
 *
 * Every door: the caller through the platform's one composition, a held
 * sign-in `403`, anonymous `401`, then the CLOSED query set, which is empty
 * (AGENTS.md route rule 5), then no current organization `403`. ⛔ No answer
 * carries the token, and no answer names the Slack user of a link before it is
 * confirmed.
 */

export const SLACK_LINK_ROUTE = '/api/v1/messaging/me/slack-link';
export const SLACK_ACCOUNT_ROUTE = '/api/v1/messaging/slack/account';
export const SLACK_LINKS_ROUTE = '/api/v1/messaging/slack/links';
/** The capability every administrator door demands in the caller's current organization. */
export const SLACK_ADMIN_CAPABILITY = 'setup.write';
/** The body keys `PUT /slack/account` reads — the whole closed set. */
const ACCOUNT_BODY_KEYS = ['token'];
/** A Slack bot token is far shorter; a longer value is not one. */
const TOKEN_MAX = 512;

export interface SlackLinkRoutesDeps {
    resolveCaller(req: IHttpRequest): Promise<ExecutionContext | undefined>;
    getStore(): SlackLinkStore;
}

interface Caller {
    readonly userId: string;
    readonly organizationId: string;
}

type Handler = (req: IHttpRequest, caller: Caller, store: SlackLinkStore) => Promise<unknown>;

export function registerSlackLinkRoutes(http: IHttpServer, deps: SlackLinkRoutesDeps): void {
    const person = (method: string, path: string, run: Handler) => door(deps, method, path, false, run);
    const admin = (method: string, path: string, run: Handler) => door(deps, method, path, true, run);

    http.get(SLACK_LINK_ROUTE, person('GET', SLACK_LINK_ROUTE, async (_req, c, store) => {
        const account = await store.account(c.organizationId);
        const link = account ? await store.linkOf(c.organizationId, c.userId) : undefined;
        return { account: account ? accountView(account) : null, link: link ? ownLinkView(link) : null };
    }));
    http.post(`${SLACK_LINK_ROUTE}/proposal`, person('POST', `${SLACK_LINK_ROUTE}/proposal`, async (_req, c, store) => {
        const link = await store.propose(c.organizationId, c.userId);
        return { link: link ? ownLinkView(link) : null };
    }));
    http.post(`${SLACK_LINK_ROUTE}/confirm`, person('POST', `${SLACK_LINK_ROUTE}/confirm`, async (_req, c, store) => (
        { link: ownLinkView(await store.confirm(c.organizationId, c.userId)) }
    )));
    http.delete(SLACK_LINK_ROUTE, person('DELETE', SLACK_LINK_ROUTE, async (_req, c, store) => (
        { removed: await store.removeOwn(c.organizationId, c.userId) }
    )));

    http.get(SLACK_ACCOUNT_ROUTE, admin('GET', SLACK_ACCOUNT_ROUTE, async (_req, c, store) => {
        const account = await store.account(c.organizationId);
        return { account: account ? accountView(account) : null };
    }));
    http.put(SLACK_ACCOUNT_ROUTE, admin('PUT', SLACK_ACCOUNT_ROUTE, async (req, c, store) => (
        { account: accountView(await store.install(c.organizationId, parseToken(req.body), c.userId)) }
    )));
    http.delete(SLACK_ACCOUNT_ROUTE, admin('DELETE', SLACK_ACCOUNT_ROUTE, async (_req, c, store) => (
        { removed: await store.uninstall(c.organizationId, c.userId) }
    )));
    http.get(SLACK_LINKS_ROUTE, admin('GET', SLACK_LINKS_ROUTE, async (_req, c, store) => (
        { links: (await store.links(c.organizationId)).map(linkView) }
    )));
    http.delete(`${SLACK_LINKS_ROUTE}/:id`, admin('DELETE', `${SLACK_LINKS_ROUTE}/:id`, async (req, c, store) => {
        if (!(await store.removeByAdmin(c.organizationId, String(req.params?.id ?? ''), c.userId))) {
            throw new SlackLinkError(404, 'RESOURCE_NOT_FOUND', 'No Slack link with this id exists in your current organization. Nothing was changed.');
        }
        return { removed: true };
    }));
}

function door(deps: SlackLinkRoutesDeps, method: string, path: string, admin: boolean, run: Handler) {
    return async (req: IHttpRequest, res: IHttpResponse): Promise<void> => {
        let context: ExecutionContext | undefined;
        try {
            context = await deps.resolveCaller(req);
        } catch (err) {
            if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
                sendError(res, err.status, err.code, err.message);
                return;
            }
            sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this request could not be resolved.', err, { method, path });
            return;
        }
        const gate = evaluateAuthGate(context, '');
        if (gate) {
            sendError(res, 403, gate.code as ErrorCode, gate.message);
            return;
        }
        if (!context || !context.userId || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
            sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
            return;
        }
        const query = Object.keys(req.query ?? {});
        if (query.length > 0) {
            sendError(res, 400, 'VALIDATION_ERROR',
                `This Slack link door takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. Nothing was changed.`);
            return;
        }
        if (admin && !(Array.isArray(context.systemPermissions) && context.systemPermissions.includes(SLACK_ADMIN_CAPABILITY))) {
            sendError(res, 403, 'PERMISSION_DENIED',
                `Managing your organization's Slack install and links requires the \`${SLACK_ADMIN_CAPABILITY}\` capability in your current ` +
                'organization, which its administrators hold. Nothing was changed.');
            return;
        }
        const organizationId = typeof context.tenantId === 'string' && context.tenantId !== '' ? context.tenantId : undefined;
        if (!organizationId) {
            sendError(res, 403, 'PERMISSION_DENIED',
                'This request has no current organization, and Slack is installed and linked per organization: select one and retry. Nothing was changed.');
            return;
        }
        try {
            sendOk(res, await run(req, { userId: context.userId, organizationId }, deps.getStore()));
        } catch (err) {
            if (err instanceof SlackLinkError) {
                sendError(res, err.status, err.code as ErrorCode, err.message,
                    err.messageId ? { userMessage: inCallerLanguage(err.messageId, context.locale) } : undefined);
                return;
            }
            sendServerFault(res, 500, 'INTERNAL_ERROR', 'The Slack link request could not be completed.', err, { method, path });
        }
    };
}

function parseToken(body: unknown): string {
    const fields = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const unknown = Object.keys(fields).filter((k) => !ACCOUNT_BODY_KEYS.includes(k));
    if (unknown.length > 0) {
        throw new SlackLinkError(400, 'VALIDATION_ERROR',
            `Installing Slack reads only { token }, and this body carries ${unknown.map((k) => `'${k}'`).join(', ')}. Nothing was saved.`);
    }
    const token = typeof fields.token === 'string' ? fields.token.trim() : '';
    if (!token || token.length > TOKEN_MAX) {
        throw new SlackLinkError(400, 'VALIDATION_ERROR',
            "Installing Slack needs { token }: your Slack app's bot token (it starts with xoxb-). Nothing was saved.");
    }
    return token;
}

function accountView(a: SlackAccount) {
    return { id: a.id, workspace: a.displayName, workspaceId: a.externalId, status: a.status };
}

/** A link as an administrator reads it: the Slack user is named only once the person confirmed. */
function linkView(l: SlackLink) {
    const confirmed = l.state === 'confirmed';
    return {
        id: l.id,
        userId: l.userId,
        slackUserId: confirmed ? l.externalUserId : null,
        slackUserName: confirmed ? l.externalDisplayName ?? null : null,
        state: l.state,
        confirmedAt: l.confirmedAt ?? null,
    };
}

/** The person's own link: before they confirm, only that a match was found. */
function ownLinkView(l: SlackLink) {
    return l.state === 'confirmed' ? linkView(l) : { state: l.state };
}

/** A refusal's sentence in the caller's language (`ExecutionContext.locale`), else in English. */
function inCallerLanguage(id: MessagingMessageId, locale: string | undefined): string {
    const offered = locale ? resolveOfferedLocale(locale, Object.keys(messagingMessages)) : undefined;
    return (offered ? messagingMessages[offered as MessagingLocale][id] : undefined) ?? enMessages[id];
}
