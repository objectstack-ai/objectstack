// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/notifications` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-2). In-app notifications (ADR-0030): the inbox surface backed by the
 * messaging service registered under the `notification` slot. Reads the L5
 * `sys_inbox_message` + `sys_notification_receipt` join; mark-read upserts
 * the receipt keyed `(notification_id, user_id, channel:'inbox')`. The
 * routes are `auth: true`, so an authenticated user is required.
 *
 * NOTE (cross-repo, see #2462 step-① re-scope): this domain has NO other
 * HTTP owner anywhere — cloud hosts reach it through the `dispatch()`
 * delegation, so this handler must keep working from the registry exactly
 * as it did from the if-chain.
 *
 * Routes (path is the sub-path after `/notifications`):
 *   GET  ''          → listInbox    (query: read, type, limit — validated, #6928)
 *   POST /read       → markRead     (body: { ids: string[] })
 *   POST /read/all   → markAllRead
 */

import { CoreServiceName } from '@objectstack/spec/system';
import { MarkNotificationsReadRequestSchema } from '@objectstack/spec/api';
import type { FieldErrorCode } from '@objectstack/spec/api';
import type { INotificationService } from '@objectstack/spec/contracts';
import { isServiceServeable } from '../service-serveable.js';
import { validationFailure, fieldsFromZodIssues } from '../validation-failure.js';
import { capabilityUnavailable } from './unavailable.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

// ---------------------------------------------------------------------------
// [#6928] GET /notifications — the query parse point, with the coercions checked
// ---------------------------------------------------------------------------
//
// All three filters on this route arrive as raw strings (the typed SDK cannot
// produce anything else, and neither can a browser), and all three used to be
// coerced with a bare `Number(...)` / `String(...)` / `=== 'true'`. A coercion
// with no check does not fail — it INVENTS a value and serves it, which is why
// every one of these was a 200 with the wrong answer rather than a 400:
//
//   ?limit=abc  →  NaN         →  data.find({ limit: NaN })   (the filed defect)
//   ?read=1     →  false       →  the UNREAD half, silently
//   ?type=a&type=b → 'a,b'     →  a topic nothing matches, silently
//
// What follows refuses those, in the house refusal shape this file already uses
// for the mark-read body: `validationFailure` — the duck-typed
// `{ code: 'VALIDATION_FAILED', fields[] }` that BOTH dispatcher error exits map
// to 400 with `details.fields[]` (#3918). No new error channel, and no new spec
// spelling: ADR-0112's registered `VALIDATION_FAILED` and ADR-0114's closed
// field-level catalog (`FieldErrorCode`) already say all of this.

/**
 * Render a rejected query value for a human, without echoing an unbounded
 * caller-supplied string into the response body.
 */
function describeQueryValue(raw: unknown): string {
    if (typeof raw === 'string') {
        return JSON.stringify(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
    }
    if (Array.isArray(raw)) return `a repeated parameter (${raw.length} values)`;
    if (raw !== null && typeof raw === 'object') return 'a structured value';
    return String(raw);
}

/** One malformed query parameter, refused. `code` is an ADR-0114 catalog member. */
function invalidQueryParam(param: string, code: FieldErrorCode, expected: string, raw: unknown): Error {
    const message =
        `Invalid \`${param}\` query parameter — expected ${expected}, received ${describeQueryValue(raw)}`;
    return validationFailure(message, [{ field: param, code, message }]);
}

/**
 * `read` — a TRI-state filter: absent means both halves of the inbox, so
 * `undefined` has to stay reachable and must never collapse into `false`.
 *
 * Was `String(query.read) === 'true'`, which answered `false` for every spelling
 * that was not exactly `true`. `?read=1`, `?read=TRUE` and `?read=` therefore
 * served the UNREAD half to a caller who had asked for the read half — or for
 * nothing in particular — and said so to nobody. The wire contract declares
 * `z.boolean()`; its two spellings are `true` and `false`, and a third spelling
 * is now refused rather than guessed.
 *
 * PRESERVED EXACTLY: absent → `undefined`; `'true'` → `true`; `'false'` → `false`;
 * a real boolean (what the in-process `dispatch()` delegation can hand over) →
 * itself. Those are every input that already had a defensible answer.
 */
function parseReadFilter(raw: unknown): boolean | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw invalidQueryParam('read', 'invalid_boolean', '`true` or `false`', raw);
}

/**
 * `limit` — the window size, and the defect #6928 was filed for.
 *
 * `Number(query.limit)` answered `NaN` for `?limit=abc`, and NaN then survives
 * every guard downstream: `MessagingService.listInbox` computes
 * `Math.min(Math.max(limit ?? 50, 1), 200)`, where `??` does not catch NaN and
 * neither `min` nor `max` rejects it, so `data.find({ limit: NaN })` reached the
 * driver and behaved however that driver behaves. Never a 400.
 *
 * Refused: values that are not a whole number at all — `abc`, `1.5`, `Infinity`,
 * a repeated `?limit=1&limit=2`.
 *
 * NOT refused — and this is deliberate, not an omission: an out-of-RANGE number.
 * The clamp is the DECLARED contract, not a workaround
 * (`ListNotificationsRequestSchema.limit`: the platform inbox "clamps any
 * requested value into 1..200 rather than refusing it"), so `?limit=1000` still
 * answers 200 rows and `?limit=-5` still answers 1. This gate adds a refusal for
 * values that were never numbers; it changes the answer for no value that was.
 */
function parseLimitWindow(raw: unknown): number | undefined {
    // The falsy gate is preserved verbatim from `query?.limit ? … : undefined`,
    // so every input that already meant "no limit" — absent, `null`, `''`, `0` —
    // keeps meaning that and keeps its old answer instead of becoming a new 400.
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
        throw invalidQueryParam('limit', 'invalid_number', 'a whole number', raw);
    }
    return parsed;
}

/**
 * `type` — the topic filter, declared `z.string()`.
 *
 * `String(query.type)` turned any non-string into a filter that matches nothing:
 * a repeated `?type=a&type=b` arrives as an ARRAY from every query parser this
 * route runs behind and became the single topic `'a,b'`, so the caller got an
 * empty inbox and a 200. A string — any string — is still passed through
 * untouched, including one that names no live topic: "no notifications of that
 * type" is a legitimate empty answer, unlike "no notifications of a type you did
 * not ask for".
 */
function parseTypeFilter(raw: unknown): string | undefined {
    if (!raw) return undefined; // preserves `query?.type ? … : undefined`
    if (typeof raw !== 'string') {
        throw invalidQueryParam('type', 'invalid_type', 'a single string', raw);
    }
    return raw;
}

export function createNotificationsDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/notifications',
        handler: (req, context) =>
            handleNotificationRequest(deps, req.path.substring(14), req.method, req.body, req.query, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleNotification`. */
export async function handleNotificationRequest(
    deps: DomainHandlerDeps,
    path: string,
    method: string,
    body: any,
    query: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // [#4127] Typed against the contract instead of `as any`, so a call this
    // file makes that `INotificationService` does not declare is a compile
    // error rather than a runtime discovery. That is the check missing when
    // #4087 shipped a `/storage` handler calling `upload(key, data)` with two
    // wrong arguments for months.
    const service = await deps.resolveService(context, 
        CoreServiceName.enum.notification,
        context.environmentId,
    ) as INotificationService | undefined;
    // [#4058] Three ways to have no inbox capability, one answer. The
    // `listInbox` probe was already here and, by accident, kept the known
    // fabricating stub off this surface (the dev one implements `send` /
    // `sendBatch` only). `isServiceServeable` makes that explicit rather than
    // incidental: a self-declared non-handler (`handlerReady: false`, ADR-0076
    // D12) is an empty slot even if it grows a `listInbox` later. A `degraded`
    // inbox that really serves keeps serving.
    //
    // [#4127] The probe STAYS, and it is not a duck-type any more: `listInbox`
    // is now a declared OPTIONAL method. Optional because an inbox needs a
    // durable store, and a send-only provider (SMTP, Twilio, a Slack webhook)
    // fills this slot legitimately without one — a fact `handlerReady` cannot
    // express, since the slot is serveable and only this capability is absent.
    // The dev stub implementing exactly `send`/`sendBatch` was never a bug on
    // its part: it followed the contract, and the contract was the incomplete
    // thing.
    //
    // 501 rather than the `handled: false` this used to return — `/notifications`
    // is mounted, so that produced a ROUTE_NOT_FOUND whose hint ("check the API
    // discovery endpoint") pointed at a page that correctly does not list the
    // route. See ./unavailable.ts. The slot key is `notification`, singular.
    if (!service || !isServiceServeable(service) || typeof service.listInbox !== 'function') {
        return capabilityUnavailable(deps, 'notification');
    }
    // Narrowed for the routes below: the entry probe established `listInbox`.
    const inbox = service as INotificationService & Required<Pick<INotificationService, 'listInbox'>>;

    const userId: string | undefined = context.executionContext?.userId;
    if (!userId) {
        return { handled: true, response: deps.error('Authentication required', 401) };
    }

    const m = method.toUpperCase();
    // split+filter drops leading/trailing/duplicate slashes without a regex
    // over request-controlled input (CodeQL js/polynomial-redos) — same
    // treatment the security domain got for the identical latent pattern.
    // Surfaced when the extraction (#3507) made this line "changed code":
    // the legacy `.replace(/\/+$/, '')` had carried the trap since ADR-0030.
    const subPath = path.split('/').filter(Boolean).join('/');

    // Each write route probes its OWN method rather than riding the entry
    // `listInbox` probe (#4127). The three are separately optional on the
    // contract, so "has an inbox to read" does not imply "has read-state to
    // write" — and the same-shaped `handled: false` is what an absent
    // capability already answers everywhere else in this file. Before the
    // methods were declared, the entry probe was the only thing standing
    // between a list-only provider and a `TypeError` on `markRead`.

    // GET /notifications — list the user's inbox joined with read-state.
    if (subPath === '' && m === 'GET') {
        // [#6928] Each coerced parameter is CHECKED at the point it is coerced,
        // and a value the contract does not admit is refused (400) instead of
        // being guessed at. Each parser's own docblock (top of this file) says
        // what it refuses and — the half that matters more — what it
        // deliberately still accepts unchanged.
        const read = parseReadFilter(query?.read);
        const limit = parseLimitWindow(query?.limit);
        const type = parseTypeFilter(query?.type);
        const result = await inbox.listInbox(userId, { read, type, limit });
        return { handled: true, response: deps.success(result) };
    }

    // POST /notifications/read — mark specific notifications read.
    if (subPath === 'read' && m === 'POST') {
        if (typeof inbox.markRead !== 'function') return capabilityUnavailable(deps, 'notification');
        // [#3899] Validate against the declared contract
        // (`MarkNotificationsReadRequestSchema`, catalog `requestSchema`).
        // The old read was `Array.isArray(body?.ids) ? … : []`, so
        // `{"notificationIds": [...]}` or `{"ids": "n1"}` silently became
        // `markRead(userId, [])` — a success envelope, `readCount: 0`, and an
        // unread badge that never cleared. The wrong key is now a 400 naming
        // the field, thrown in the shape both dispatcher error exits map
        // (#3918); the analytics entry gate is the precedent (#3878).
        const parsed = MarkNotificationsReadRequestSchema.safeParse(body ?? {});
        if (!parsed.success) {
            const fields = fieldsFromZodIssues(parsed.error.issues);
            throw validationFailure(
                `Invalid mark-read body — expected { ids: string[] }: ${fields.map((f) => `${f.field}: ${f.message}`).join('; ')}`,
                fields,
            );
        }
        const result = await inbox.markRead(userId, parsed.data.ids);
        return { handled: true, response: deps.success(result) };
    }

    // POST /notifications/read/all — mark all of the user's inbox read.
    if (subPath === 'read/all' && m === 'POST') {
        if (typeof inbox.markAllRead !== 'function') return capabilityUnavailable(deps, 'notification');
        const result = await inbox.markAllRead(userId);
        return { handled: true, response: deps.success(result) };
    }

    return { handled: false };
}
