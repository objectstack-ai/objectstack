// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
    ANONYMOUS_DENY_CODE,
    ANONYMOUS_DENY_MESSAGE,
    ANONYMOUS_DENY_STATUS,
    evaluateAuthGate,
    isApiKeyLifecycleRefusalError,
    isAuthzStoreUnavailableError,
    shouldDenyAnonymous,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IDataEngine, IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { sendError, sendOk, sendServerFault } from '@objectstack/types';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';
import type { EmitInput, EmitResult } from './messaging-service.js';
import { ORGANIZATION_MEMBERS_AUDIENCE } from './recipient-resolver.js';

/**
 * The in-app message door: `POST /api/v1/messaging/in-app-messages`, the
 * server half of the Setup action "Send in-app message" (ruling 6810324463 on
 * #32445, letter A, PR 2 of 2). An organization administrator sends one
 * message, a title and a body with a severity and an optional link, to
 * members of their own organization: everyone in it, or the users they pick.
 * The message is a notification like any other, through the one ingress
 * (`MessagingService.emit()`, ADR-0030), on the in-app channel only, so it
 * lands in each recipient's inbox and bell.
 *
 * The action that opens it is declared on `sys_notification`'s list toolbar in
 * `@objectstack/platform-objects` (`send_in_app_message`), with this door as
 * its same-origin `target` and {@link IN_APP_MESSAGE_CAPABILITY} as its
 * `requiredPermissions`, so the action is listed to exactly the callers this
 * door admits (`in-app-message-action.test.ts` pins the pair).
 *
 * ## Who may send — in this order, before anything is read
 *
 *  1. **The caller**, resolved by the platform's one request-to-context
 *     composition (`resolveMessagingCaller`). A permission store that cannot
 *     be read answers its own `SERVICE_UNAVAILABLE` / `503`, and an API key its
 *     lifecycle refuses its own `403` and code: both relayed as declared.
 *  2. **A held sign-in** (ADR-0069): `403` with the policy's own code.
 *  3. **Anonymous** (ADR-0056 D2): `UNAUTHENTICATED` / `401`.
 *  4. **The query**: the closed set is empty (AGENTS.md, route rule 5); any
 *     parameter is refused `VALIDATION_ERROR` / `400` naming it.
 *  5. **The capability**: {@link IN_APP_MESSAGE_CAPABILITY} (`setup.write`)
 *     in the caller's CURRENT organization (`ExecutionContext.systemPermissions`,
 *     resolved for that organization), else `PERMISSION_DENIED` / `403`. It is
 *     the organization administrator's gate the platform already declares for
 *     an organization-scoped administrative door: the record currency
 *     backfill (ruling 6670707546, item B) and the organization client-address
 *     read ask the same capability in the same organization. Both
 *     organization-administrator sets and the platform administrator's grant
 *     hold it; `member_default` does not. A permission set an administrator
 *     authored that grants it is admitted too, as on those two doors.
 *  6. **The organization**: the caller's current organization
 *     (`ExecutionContext.tenantId`); a request with none is refused
 *     `PERMISSION_DENIED` / `403` before anything is read. ⛔ There is no
 *     organization in the body: a message reaches the members of the
 *     organization the caller is working in, and only them.
 *
 * ## The body — a closed set of keys ({@link IN_APP_MESSAGE_BODY_KEYS})
 *
 *  - `everyone: true` — every member of the caller's current organization
 *    (`org:members`, resolved in that organization only), or
 *  - `recipients` — the user ids picked, at most
 *    {@link IN_APP_MESSAGE_RECIPIENTS_MAX}, each a member of the caller's
 *    current organization: a picked id that is not is refused `400` naming
 *    it, and nothing is sent. Exactly one of the two: both, or neither, is
 *    refused.
 *  - `title` (required, at most {@link IN_APP_MESSAGE_TITLE_MAX} characters,
 *    the inbox title column's width) and `body` (required, at most
 *    {@link IN_APP_MESSAGE_BODY_MAX} characters, Markdown).
 *  - `severity` — `info` (the default), `warning` or `critical`.
 *  - `link` — optional: a path on this origin (`/apps/…`) or an `http(s)` URL,
 *    at most {@link IN_APP_MESSAGE_LINK_MAX} characters. Any other scheme is
 *    refused.
 *
 * A key outside the set is refused `400` naming it, never dropped. Every
 * refusal sends nothing.
 *
 * ## What the door answers
 *
 *  - **Success:** `200` with `{ notificationId, recipients, delivered,
 *    enqueued, failed }`: the event `emit()` wrote, how many people the
 *    message went to, and `emit()`'s own counts (`delivered` observed inline,
 *    `enqueued` handed to the outbox).
 *  - **No messaging service or data engine on this host:**
 *    `SERVICE_UNAVAILABLE` / `503`, before anything is sent.
 *  - **A membership read or the send that throws** is a fault: `500` /
 *    `INTERNAL_ERROR` with this door's sentence and the error in the fault log.
 */

/** The route the door is mounted at. */
export const IN_APP_MESSAGE_ROUTE = '/api/v1/messaging/in-app-messages';

/**
 * The capability the door demands in the caller's current organization, and
 * the `requiredPermissions` of the action that opens it.
 */
export const IN_APP_MESSAGE_CAPABILITY = 'setup.write';

/** The topic every message this door sends is emitted under. */
export const IN_APP_MESSAGE_TOPIC = 'org.announcement';

/** The body keys the door reads — the whole closed set. */
export const IN_APP_MESSAGE_BODY_KEYS: readonly string[] = Object.freeze(['recipients', 'everyone', 'title', 'body', 'severity', 'link']);

/** The severities a message can carry, as `emit()` and `sys_inbox_message.severity` spell them. */
export const IN_APP_MESSAGE_SEVERITIES: readonly string[] = Object.freeze(['info', 'warning', 'critical']);

/**
 * At most this many characters of title: `sys_inbox_message.title` is a text
 * field with no declared bound, which the SQL driver stores as a varchar(255).
 */
export const IN_APP_MESSAGE_TITLE_MAX = 255;

/** At most this many characters of link, for the same reason as the title (`sys_inbox_message.action_url`). */
export const IN_APP_MESSAGE_LINK_MAX = 255;

/** At most this many characters of body: a message to read in the bell, not a document. */
export const IN_APP_MESSAGE_BODY_MAX = 10_000;

/** At most this many picked recipients; beyond it, a message for everyone is the one that fits. */
export const IN_APP_MESSAGE_RECIPIENTS_MAX = 1000;

/** The one member of the messaging service the door calls. */
export interface InAppMessageSender {
    emit(input: EmitInput): Promise<EmitResult>;
}

/** What the door is composed over — every member is read when a request arrives. */
export interface InAppMessageRoutesDeps {
    /**
     * Resolve the caller. The plugin passes the platform's one composition
     * (`resolveMessagingCaller`); nothing is defaulted here.
     */
    resolveCaller(req: IHttpRequest): Promise<ExecutionContext | undefined>;
    /** The messaging service the message is emitted through; `undefined` when none is registered. */
    getMessaging(): InAppMessageSender | undefined;
    /** The data engine the picked recipients' membership is read through; `undefined` when none is registered. */
    getData(): IDataEngine | undefined;
}

/** A body the door accepted, in the shape it sends. */
export interface InAppMessageRequest {
    readonly everyone: boolean;
    readonly recipients: readonly string[];
    readonly title: string;
    readonly body: string;
    readonly severity: 'info' | 'warning' | 'critical';
    readonly link?: string;
}

/** Mount the door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerInAppMessageRoutes(http: IHttpServer, deps: InAppMessageRoutesDeps): void {
    http.post(IN_APP_MESSAGE_ROUTE, (req, res) => handleInAppMessage(req, res, deps));
}

const FAULT_AT = { method: 'POST', path: IN_APP_MESSAGE_ROUTE } as const;

async function handleInAppMessage(req: IHttpRequest, res: IHttpResponse, deps: InAppMessageRoutesDeps): Promise<void> {
    // ① The caller.
    let context: ExecutionContext | undefined;
    try {
        context = await deps.resolveCaller(req);
    } catch (err) {
        if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
            sendError(res, err.status, err.code, err.message);
            return;
        }
        sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this request could not be resolved.', err, FAULT_AT);
        return;
    }

    // ② A held sign-in.
    const gate = evaluateAuthGate(context, '');
    if (gate) {
        sendError(res, 403, gate.code as ErrorCode, gate.message);
        return;
    }

    // ③ Anonymous.
    if (!context || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
        sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
        return;
    }

    // ④ The query: the closed set is empty.
    const query = Object.keys(req.query ?? {});
    if (query.length > 0) {
        sendError(
            res,
            400,
            'VALIDATION_ERROR',
            `Sending an in-app message takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
                `Send the message in the body: { ${IN_APP_MESSAGE_BODY_KEYS.join(', ')} }. Nothing was sent.`,
        );
        return;
    }

    // ⑤ The capability, in the caller's current organization.
    const held = Array.isArray(context.systemPermissions) ? context.systemPermissions : [];
    if (!held.includes(IN_APP_MESSAGE_CAPABILITY)) {
        sendError(
            res,
            403,
            'PERMISSION_DENIED',
            `Sending an in-app message to your organization requires the \`${IN_APP_MESSAGE_CAPABILITY}\` capability in your current ` +
                'organization, which its administrators hold. Nothing was sent.',
        );
        return;
    }

    // ⑥ The organization: the caller's current one, and only it.
    const organizationId = typeof context.tenantId === 'string' && context.tenantId !== '' ? context.tenantId : undefined;
    if (organizationId === undefined) {
        sendError(
            res,
            403,
            'PERMISSION_DENIED',
            'This request has no current organization, and an in-app message goes to members of the organization you are ' +
                'working in only: select the organization whose members you mean and retry. Nothing was sent.',
        );
        return;
    }

    // ⑦ The body.
    const parsed = parseInAppMessageBody(req.body);
    if (typeof parsed === 'string') {
        sendError(res, 400, 'VALIDATION_ERROR', parsed);
        return;
    }

    const messaging = deps.getMessaging();
    const data = deps.getData();
    if (!messaging || !data) {
        sendError(
            res,
            503,
            'SERVICE_UNAVAILABLE',
            `This server has no ${messaging ? 'data engine' : 'messaging service'}, so an in-app message cannot be sent. Nothing was sent.`,
        );
        return;
    }

    // ⑧ The picked recipients: members of this organization, each one.
    if (!parsed.everyone) {
        let outsiders: string[];
        try {
            outsiders = await nonMembersOf(data, organizationId, parsed.recipients);
        } catch (err) {
            sendServerFault(res, 500, 'INTERNAL_ERROR', 'The recipients\' membership of your organization could not be read. Nothing was sent.', err, FAULT_AT);
            return;
        }
        if (outsiders.length > 0) {
            sendError(
                res,
                400,
                'VALIDATION_ERROR',
                `${outsiders.length === 1 ? 'This recipient is' : 'These recipients are'} not ${outsiders.length === 1 ? 'a member' : 'members'} ` +
                    `of your current organization: ${outsiders.map((id) => `'${id}'`).join(', ')}. An in-app message goes to members of ` +
                    'the organization you are working in only; pick members of it, or send to everyone in it. Nothing was sent.',
            );
            return;
        }
    }

    // ⑨ The send, through the one ingress.
    let result: EmitResult;
    try {
        result = await messaging.emit(inAppMessageEmitInput(parsed, organizationId, context.userId));
    } catch (err) {
        sendServerFault(res, 500, 'INTERNAL_ERROR', 'The in-app message could not be sent.', err, FAULT_AT);
        return;
    }
    sendOk(res, {
        notificationId: result.notificationId,
        recipients: new Set(result.deliveries.map((d) => d.recipient)).size,
        delivered: result.delivered,
        enqueued: result.enqueued,
        failed: result.failed,
    });
}

/**
 * The `emit()` input for an accepted body, in `organizationId`, sent by
 * `actorId`. Everyone is `org:members` of that organization (the resolver
 * reads the organization from `organizationId` alone, never from the string);
 * picked users are `user:` selectors, so no id is ever read as an address or
 * another selector. In-app only.
 */
export function inAppMessageEmitInput(message: InAppMessageRequest, organizationId: string, actorId: string | undefined): EmitInput {
    return {
        topic: IN_APP_MESSAGE_TOPIC,
        audience: message.everyone ? ORGANIZATION_MEMBERS_AUDIENCE : message.recipients.map((id) => `user:${id}`),
        organizationId,
        ...(actorId ? { actorId } : {}),
        severity: message.severity,
        payload: {
            title: message.title,
            body: message.body,
            ...(message.link ? { url: message.link } : {}),
        },
        channels: ['inbox'],
    };
}

/**
 * Judge a request body against the closed set: the accepted message, or the
 * refusal sentence naming what is wrong. Pure.
 */
export function parseInAppMessageBody(raw: unknown): InAppMessageRequest | string {
    const nothingSent = ' Nothing was sent.';
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return `The body must be a JSON object: { ${IN_APP_MESSAGE_BODY_KEYS.join(', ')} }.${nothingSent}`;
    }
    const body = raw as Record<string, unknown>;
    const unknown = Object.keys(body).filter((key) => !IN_APP_MESSAGE_BODY_KEYS.includes(key));
    if (unknown.length > 0) {
        const org = unknown.find((key) => key === 'organizationId' || key === 'organization_id');
        return org
            ? `'${org}' is not accepted: an in-app message goes to members of your current organization only. ` +
                  `Switch to the organization whose members you mean, and send { ${IN_APP_MESSAGE_BODY_KEYS.join(', ')} }.${nothingSent}`
            : `${unknown.map((key) => `'${key}'`).join(', ')} ${unknown.length === 1 ? 'is not a field' : 'are not fields'} of an in-app ` +
                  `message. The fields are ${IN_APP_MESSAGE_BODY_KEYS.join(', ')}.${nothingSent}`;
    }

    // everyone
    if (body.everyone !== undefined && body.everyone !== null && typeof body.everyone !== 'boolean') {
        return `'everyone' must be true or false.${nothingSent}`;
    }
    const everyone = body.everyone === true;

    // recipients
    let recipients: string[] = [];
    if (body.recipients !== undefined && body.recipients !== null) {
        if (!Array.isArray(body.recipients) || body.recipients.some((id) => typeof id !== 'string' || id.trim() === '')) {
            return `'recipients' must be a list of user ids.${nothingSent}`;
        }
        recipients = [...new Set((body.recipients as string[]).map((id) => id.trim()))];
    }
    if (everyone && recipients.length > 0) {
        return `Send either to everyone in your organization ('everyone': true) or to the users in 'recipients', not both.${nothingSent}`;
    }
    if (!everyone && recipients.length === 0) {
        return `Pick at least one recipient in 'recipients', or send to everyone in your organization with 'everyone': true.${nothingSent}`;
    }
    if (recipients.length > IN_APP_MESSAGE_RECIPIENTS_MAX) {
        return `'recipients' names ${recipients.length} users, and a message can pick at most ${IN_APP_MESSAGE_RECIPIENTS_MAX}. ` +
            `To reach more, send to everyone in your organization with 'everyone': true.${nothingSent}`;
    }

    // title, body
    const title = typeof body.title === 'string' ? body.title.trim() : undefined;
    if (!title) return `'title' is required: the line every recipient sees in their inbox.${nothingSent}`;
    if (title.length > IN_APP_MESSAGE_TITLE_MAX) {
        return `'title' is ${title.length} characters long, and a title can be at most ${IN_APP_MESSAGE_TITLE_MAX}.${nothingSent}`;
    }
    const text = typeof body.body === 'string' ? body.body.trim() : undefined;
    if (!text) return `'body' is required: the message itself.${nothingSent}`;
    if (text.length > IN_APP_MESSAGE_BODY_MAX) {
        return `'body' is ${text.length} characters long, and a message can be at most ${IN_APP_MESSAGE_BODY_MAX}.${nothingSent}`;
    }

    // severity
    let severity: InAppMessageRequest['severity'] = 'info';
    if (body.severity !== undefined && body.severity !== null && body.severity !== '') {
        if (typeof body.severity !== 'string' || !IN_APP_MESSAGE_SEVERITIES.includes(body.severity)) {
            return `'severity' must be one of ${IN_APP_MESSAGE_SEVERITIES.join(', ')}.${nothingSent}`;
        }
        severity = body.severity as InAppMessageRequest['severity'];
    }

    // link
    let link: string | undefined;
    if (body.link !== undefined && body.link !== null && body.link !== '') {
        if (typeof body.link !== 'string') return `'link' must be text: a path on this site or an http(s) address.${nothingSent}`;
        const candidate = body.link.trim();
        if (candidate !== '') {
            if (candidate.length > IN_APP_MESSAGE_LINK_MAX) {
                return `'link' is ${candidate.length} characters long, and a link can be at most ${IN_APP_MESSAGE_LINK_MAX}.${nothingSent}`;
            }
            if (!isAcceptedLink(candidate)) {
                return `'link' must be a path on this site (starting with a single '/') or an http(s) address; ` +
                    `'${candidate}' is neither.${nothingSent}`;
            }
            link = candidate;
        }
    }

    return { everyone, recipients, title, body: text, severity, ...(link ? { link } : {}) };
}

/** A path on this origin (one leading `/`, no whitespace or control character), or an absolute `http(s)` URL. */
function isAcceptedLink(link: string): boolean {
    for (const ch of link) {
        const code = ch.codePointAt(0) ?? 0;
        if (code <= 0x20 || code === 0x7f || /\s/.test(ch)) return false;
    }
    if (link.startsWith('/')) {
        const second = link.charAt(1);
        return second !== '/' && second !== '\\';
    }
    try {
        const url = new URL(link);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

/** How many picked ids one membership read asks about. */
const MEMBERSHIP_CHECK_CHUNK = 100;

/**
 * The picked ids that are NOT members of `organizationId`, in the order given.
 * The read keeps the fan-out's posture (`FAN_OUT_SYSTEM_CONTEXT`): the
 * explicit system opt-in, filtered to the one organization and the ids asked
 * about, projected to `user_id`; nothing but which ids are members is used.
 * `(organization_id, user_id)` is unique on `sys_member`, so a chunk's read
 * answers at most one row per id.
 */
async function nonMembersOf(data: IDataEngine, organizationId: string, ids: readonly string[]): Promise<string[]> {
    const members = new Set<string>();
    for (let start = 0; start < ids.length; start += MEMBERSHIP_CHECK_CHUNK) {
        const chunk = ids.slice(start, start + MEMBERSHIP_CHECK_CHUNK);
        const rows = (await data.find(
            'sys_member',
            { where: { organization_id: organizationId, user_id: { $in: chunk } }, fields: ['user_id'], limit: chunk.length },
            { context: FAN_OUT_SYSTEM_CONTEXT },
        )) as Array<{ user_id?: unknown }>;
        for (const row of rows) if (typeof row?.user_id === 'string') members.add(row.user_id);
    }
    return ids.filter((id) => !members.has(id));
}
