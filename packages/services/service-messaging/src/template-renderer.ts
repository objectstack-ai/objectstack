// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';

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

/** One hole the renderer substitutes: its span in the template, braces included, and the path it reads. */
export interface TemplateHole {
    start: number;
    end: number;
    text: string;
    path: string;
}

/**
 * Every hole {@link interpolate} and {@link renderNotification} substitute in
 * `template`, in order. It reads the renderer's own grammar ({@link TOKEN}), so
 * the placement judge the template object's save hooks run
 * (`template-hole-placement.ts`) judges exactly the spans this module replaces —
 * never text it leaves verbatim, never a span it misses.
 */
export function templateHoles(template: string): TemplateHole[] {
    if (!template) return [];
    const holes: TemplateHole[] = [];
    for (const m of template.matchAll(TOKEN)) {
        const start = m.index ?? 0;
        holes.push({ start, end: start + m[0].length, text: m[0], path: m[1] });
    }
    return holes;
}

/**
 * Whether a template row's `format` sends its body to the `html` face, where
 * every hole is HTML-encoded (see {@link renderNotification}). One spelling for
 * the renderer and the placement judge, so the rows the judge holds to the
 * placement rule are exactly the rows rendered with that encoding.
 */
export function isHtmlFormat(format: unknown): boolean {
    return format === 'html' || format === 'mjml';
}

/** How one hole's value is encoded for the face it lands in. */
type HoleEncoder = (value: string) => string;

const verbatim: HoleEncoder = (value) => value;

/**
 * Encode a value for an HTML face: element text and quoted attribute values
 * both, so a hole is safe in either position. Every character survives — a
 * mail client decodes the entity back on display — so nothing a user typed is
 * stripped or refused; it is only kept from being read as markup.
 */
const escapeHtml: HoleEncoder = (value) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * Declarative `{{ path.to.value }}` interpolation over a context object. No
 * logic, no conditionals — templates stay auditable metadata (a deliberate
 * low-code constraint). An unknown path renders to an empty string. This is the
 * single, linear-time substitution pass; it never evaluates template code.
 *
 * Values render verbatim: this is the PLAIN-TEXT face (a subject, a text body,
 * an SMS). An HTML face goes through {@link renderNotification}, which encodes
 * every hole for markup.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
    return substitute(template, context, verbatim);
}

function substitute(template: string, context: Record<string, unknown>, encode: HoleEncoder): string {
    if (!template) return '';
    return template.replace(TOKEN, (_m, path: string) => {
        const v = lookup(context, path);
        return v == null ? '' : encode(String(v));
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
 *
 * ## Each face is encoded for its own context (ruling 3C on #25040)
 *
 * A payload carries text fields — a person's display name, a record title, a
 * comment — and a display name may contain any character. The rule is that the
 * stored text is never stripped or refused; the OUTLET that renders it into
 * HTML escapes it, by default. So:
 *
 *  - an `html` / `mjml` body is markup: every hole's value is HTML-escaped. The
 *    template's own markup is the author's and renders as written; only the
 *    values are encoded. There is no unescaped hole form here — a template that
 *    needs a pre-rendered fragment is an email template (`sys_email_template`,
 *    named in a notify step's `template`), whose renderer has one. An `mjml`
 *    body is not compiled: it reaches the `html` face as written.
 *  - that encoding is right in element text and in a quoted plain-text
 *    attribute value, and in no other place a hole can sit, so a row whose
 *    html / mjml body puts a hole anywhere else is refused when it is saved
 *    (ruling `6335348115` on #25082, `template-hole-placement.ts`). A row stored
 *    before that rule keeps rendering here unchanged.
 *  - the subject and a `markdown` / `text` body are plain text: values render
 *    verbatim, because an entity in plain text is a corrupted character.
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
        const isHtml = isHtmlFormat(template.format);
        const renderedBody = substitute(String(template.body ?? ''), ctx, isHtml ? escapeHtml : verbatim);
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
 * Loads `sys_notification_template` rows by `(topic, channel, locale)` in the
 * recipient's organization, with a locale fallback (`en-US` → `en` →
 * {@link DEFAULT_LOCALE}). Best-effort: no data engine or a lookup error yields
 * `null` (→ the renderer's generic fallback), never a throw — a template outage
 * must not block delivery.
 *
 * ## A template is resolved in the recipient's organization (ADR-0131)
 *
 * `sys_notification_template` is organization-owned: a row is the organization
 * that authored it (ADR-0131 D1/D3), so the row a delivery renders is one its
 * OWN organization authored — `organizationId` is the delivery's
 * (`Notification.organizationId`, the organization the event row carries). The
 * read is keyed `where: { organization_id }`, the same spelling
 * `PreferenceResolver.loadRows` scopes its rows by.
 *
 *  - ⛔ Never drop the `organization_id` term. The read runs under the explicit
 *    system opt-in ({@link FAN_OUT_SYSTEM_CONTEXT}), which names no
 *    organization: here the term IS the organization boundary, as the
 *    `user_id` term is under `INBOX_SYSTEM_CONTEXT`.
 *  - A call that names no organization reads NO row and answers `null`, so the
 *    channel renders the producer's own title and body. There is no row with no
 *    organization (ADR-0131 D1), so there is no row such a delivery could own.
 *    The composed fan-out never hands a channel such a delivery: the event row
 *    takes its organization from the producer or from the engine's system-write
 *    rule (ADR-0131 D9), and an emit with neither is refused.
 */
export class NotificationTemplateStore {
    private readonly objectName: string;
    constructor(private readonly opts: NotificationTemplateStoreOptions) {
        this.objectName = opts.objectName ?? TEMPLATE_OBJECT;
    }

    async load(
        topic: string,
        channel: string,
        locale?: string,
        organizationId?: string,
    ): Promise<NotificationTemplateRow | null> {
        const data = this.opts.getData();
        if (!data) return null;
        if (!organizationId) return null;
        const candidates = localeCandidates(locale);
        for (const loc of candidates) {
            try {
                // The explicit system opt-in — see FAN_OUT_SYSTEM_CONTEXT: the
                // recipient organization's template row, read to render a
                // delivery to that recipient.
                const row = await data.findOne(this.objectName, {
                    where: { organization_id: organizationId, topic, channel, locale: loc, is_active: true },
                    fields: ['subject', 'body', 'format'],
                }, { context: FAN_OUT_SYSTEM_CONTEXT });
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
