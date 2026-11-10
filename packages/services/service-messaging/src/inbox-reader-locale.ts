// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32240] An inbox row in the READER's language.
 *
 * ## What was wrong
 *
 * A keyed notification (`EmitInput.keyedText`, `notification-text.ts`) is
 * rendered once, at delivery, in the recipient's STORED language: their own
 * `sys_user.locale`, else the deployment default. The inbox channel wrote only
 * that rendered text onto `sys_inbox_message`, so a recipient with no saved
 * locale — the showcase admin, in a zh-CN console — read every notification
 * title in the deployment default (English) forever, however their console
 * asked.
 *
 * ## What a row stores now
 *
 * Beside `title` / `body_md`, the inbox channel stores the keys they were
 * rendered from in {@link INBOX_TEXT_KEYS_FIELD}, on both delivery paths (the
 * inline fan-out and the dispatcher hand them over as `Notification.keyedText`).
 * `title` / `body_md` are written exactly as before: they are what any read
 * not served through this middleware gets, and the per-member fallback below.
 *
 * ## Who renders it
 *
 * {@link installInboxReaderLocale}: an engine middleware on `sys_inbox_message`
 * that, on a read whose `ExecutionContext.locale` is set (the door's resolved
 * `Accept-Language`, else the `localization` settings), re-renders each keyed
 * row's `title` and `body_md` in that locale through the SAME
 * `NotificationTextRenderer` delivery renders with
 * (`renderForReader`: the one negotiation rule, `resolveBundleLocale`, and
 * `II18nService.t()`), so the stored text and a reader's text can never be two
 * renderings of one notification. It is the sequence `plugin-audit`'s
 * `sys_activity` summary middleware runs.
 *
 * ## What stays as stored
 *
 * A read with no locale (every system read, the REST inbox door among them), no
 * `i18n` service, a row without keys (every row written before this change: no
 * backfill), keys that do not parse, and each member whose key the reader's
 * locale cannot answer — all are served the stored text. A projection that did
 * not ask for `title` / `body_md` is not given them.
 */

import { INBOX_OBJECT, INBOX_TEXT_KEYS_FIELD } from './inbox-channel.js';
import { readNotificationTextKeys, type NotificationTextKeys, type RenderedNotificationText } from './notification-text.js';

/** The renderer slice a read asks. `NotificationTextRenderer` is the one composition answers with. */
export interface InboxReaderTextRenderer {
    renderForReader(
        keys: NotificationTextKeys,
        literal: RenderedNotificationText,
        locale: string,
    ): RenderedNotificationText | undefined;
}

/** The engine slice the middleware registers on. */
export interface InboxReaderLocaleEngine {
    registerMiddleware?(
        fn: (ctx: any, next: () => Promise<void>) => Promise<void>,
        options?: { object?: string },
    ): void;
}

const TEXT_COLUMNS = ['title', 'body_md'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A stored keys value: the object, or its JSON text (a driver may hand a json column back as a string). */
function storedKeys(raw: unknown): NotificationTextKeys | undefined {
    let value = raw;
    if (typeof raw === 'string') {
        if (raw.trim() === '') return undefined;
        try {
            value = JSON.parse(raw);
        } catch {
            return undefined;
        }
    }
    return value == null ? undefined : readNotificationTextKeys(value);
}

/**
 * Overlay `row.title` / `row.body_md` with its stored keys rendered in
 * `locale`, in place. Only the members the row carries are touched; a member
 * the render cannot answer keeps its stored text.
 */
export function localizeInboxRow(
    row: Record<string, unknown>,
    renderer: InboxReaderTextRenderer,
    locale: string,
): void {
    if (!('title' in row) && !('body_md' in row)) return;
    const keys = storedKeys(row[INBOX_TEXT_KEYS_FIELD]);
    if (!keys) return;
    const literal = {
        title: typeof row.title === 'string' ? row.title : '',
        body: typeof row.body_md === 'string' ? row.body_md : '',
    };
    let text: RenderedNotificationText | undefined;
    try {
        text = renderer.renderForReader(keys, literal, locale);
    } catch {
        // Rendering must never fail the read: the stored text stands.
        return;
    }
    if (!text) return;
    if ('title' in row) row.title = text.title;
    if ('body_md' in row) row.body_md = text.body;
}

/**
 * When an explicit projection asks for `title` or `body_md` but not the keys,
 * add the keys column so the row can be rendered; answers whether it was
 * added (the middleware then removes it from each served row).
 */
function ensureKeysProjected(ast: Record<string, unknown> | undefined): boolean {
    const fields = ast?.fields;
    if (!Array.isArray(fields) || fields.length === 0) return false;
    if (!fields.some((f) => (TEXT_COLUMNS as readonly string[]).includes(String(f)))) return false;
    if (fields.includes(INBOX_TEXT_KEYS_FIELD)) return false;
    fields.push(INBOX_TEXT_KEYS_FIELD);
    return true;
}

/**
 * Install the `sys_inbox_message` reader-locale middleware. Answers whether it
 * was installed (an engine without a middleware registry cannot host it, and
 * every row is then served as stored).
 */
export function installInboxReaderLocale(
    engine: InboxReaderLocaleEngine | null | undefined,
    renderer: InboxReaderTextRenderer,
    objectName: string = INBOX_OBJECT,
): boolean {
    if (!engine || typeof engine.registerMiddleware !== 'function') return false;
    engine.registerMiddleware(
        async (ctx, next) => {
            if (ctx.operation !== 'find' && ctx.operation !== 'findOne') return next();
            const locale: unknown = ctx.context?.locale;
            if (typeof locale !== 'string' || locale.length === 0) return next();
            const added = ensureKeysProjected(ctx.ast);
            await next();
            const list = (Array.isArray(ctx.result) ? ctx.result : ctx.result ? [ctx.result] : []) as unknown[];
            for (const row of list) {
                if (!isRecord(row)) continue;
                localizeInboxRow(row, renderer, locale);
                if (added) delete row[INBOX_TEXT_KEYS_FIELD];
            }
        },
        { object: objectName },
    );
    return true;
}
