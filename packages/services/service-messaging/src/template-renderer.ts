// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';

/** The object notification templates live in. */
export const TEMPLATE_OBJECT = 'sys_notification_template';

/** Default locale used when a delivery carries none. */
export const DEFAULT_LOCALE = 'en';

/** A loaded template row (the columns the renderer reads). */
export interface NotificationTemplateRow {
    subject?: string | null;
    body?: string | null;
    format?: 'markdown' | 'html' | 'text' | 'mjml' | null;
}

/** The rendered artifact a channel turns into its transport payload. */
export interface RenderedNotification {
    subject: string;
    /** Set when the template/format is HTML-ish (html/mjml). */
    html?: string;
    /** Set otherwise (markdown/text, or the no-template fallback). */
    text?: string;
}

/**
 * Render context: the event payload plus a few top-level conveniences so a
 * template can write `{{ title }}` as well as `{{ payload.title }}`.
 */
export interface RenderInput {
    topic: string;
    payload: Record<string, unknown>;
    /** Resolved title/body from the notification (fallback when no template). */
    title?: string;
    body?: string;
}

const TOKEN = /\{\{\s*([\w.$]+)\s*\}\}/g;

/**
 * Declarative `{{ path.to.value }}` interpolation over a context object. No
 * logic, no conditionals — templates stay auditable metadata (a deliberate
 * low-code constraint). An unknown path renders to an empty string. This is the
 * single, linear-time substitution pass; it never evaluates template code.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
    if (!template) return '';
    return template.replace(TOKEN, (_m, path: string) => {
        const v = lookup(context, path);
        return v == null ? '' : String(v);
    });
}

function lookup(ctx: Record<string, unknown>, path: string): unknown {
    let cur: unknown = ctx;
    for (const key of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

/**
 * Render a notification for a channel. With a template, `subject`/`body` are
 * interpolated and `body` is routed to `html` (html/mjml) or `text`
 * (markdown/text). With no template, fall back to the notification's
 * `title`/`body` (the P0/P1 behavior) as `subject`/`text`.
 */
export function renderNotification(
    template: NotificationTemplateRow | null | undefined,
    input: RenderInput,
): RenderedNotification {
    const ctx: Record<string, unknown> = {
        ...input.payload,
        payload: input.payload,
        topic: input.topic,
        title: input.title ?? input.payload.title,
        body: input.body ?? input.payload.body,
    };

    if (template && (template.subject || template.body)) {
        const subject = interpolate(String(template.subject ?? ''), ctx) || String(ctx.title ?? input.topic);
        const renderedBody = interpolate(String(template.body ?? ''), ctx);
        const isHtml = template.format === 'html' || template.format === 'mjml';
        return isHtml ? { subject, html: renderedBody } : { subject, text: renderedBody };
    }

    // Generic fallback — no template for this (topic, channel, locale).
    return {
        subject: String(ctx.title ?? input.topic),
        text: String(ctx.body ?? ''),
    };
}

export interface NotificationTemplateStoreOptions {
    getData(): IDataEngine | undefined;
    objectName?: string;
}

/**
 * Loads `sys_notification_template` rows by `(topic, channel, locale)`, with a
 * locale fallback (`en-US` → `en` → {@link DEFAULT_LOCALE}). Best-effort: no
 * data engine or a lookup error yields `null` (→ the renderer's generic
 * fallback), never a throw — a template outage must not block delivery.
 */
export class NotificationTemplateStore {
    private readonly objectName: string;
    constructor(private readonly opts: NotificationTemplateStoreOptions) {
        this.objectName = opts.objectName ?? TEMPLATE_OBJECT;
    }

    async load(topic: string, channel: string, locale?: string): Promise<NotificationTemplateRow | null> {
        const data = this.opts.getData();
        if (!data) return null;
        const candidates = localeCandidates(locale);
        for (const loc of candidates) {
            try {
                const row = await data.findOne(this.objectName, {
                    where: { topic, channel, locale: loc, is_active: true },
                    fields: ['subject', 'body', 'format'],
                });
                if (row) return row as NotificationTemplateRow;
            } catch {
                return null; // best-effort — fall back to generic rendering
            }
        }
        return null;
    }
}

/** `en-US` → ['en-US','en', DEFAULT_LOCALE]; dedups, keeps order. */
function localeCandidates(locale?: string): string[] {
    const out: string[] = [];
    const push = (l?: string) => { if (l && !out.includes(l)) out.push(l); };
    push(locale);
    if (locale && locale.includes('-')) push(locale.split('-')[0]);
    push(DEFAULT_LOCALE);
    return out;
}
