// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24978] A notification's text as CATALOG KEYS, rendered per recipient at
 * delivery, in that recipient's language.
 *
 * ## What was wrong
 *
 * `emit()` accepted the text a recipient reads only as two literal strings,
 * `payload.title` and `payload.body`, built by the producer at emit. A
 * notification reaches several people, and the producer holds no recipient
 * when it builds them, so every recipient read the producer's language: the
 * approvals plugin's `approval.requested`, reminders, SLA notices, decision
 * outcomes and out-of-office notices reached a zh-CN, ja-JP or es-ES approver
 * as English sentences.
 *
 * ## The contract
 *
 * {@link NotificationTextKeys} rides beside the literal text, never in place of
 * it (`EmitInput.keyedText`):
 *
 *  - `titleKey` / `bodyKey` are `II18nService` keys — a face and an id, e.g.
 *    `messages.approvalRequestedTitle` — whose entries a producer contributes
 *    through its own translation bundle (ADR-0029 D8, `i18n.loadTranslations`),
 *    the catalog every server-rendered string in this platform already uses.
 *    ⛔ There is no second catalog here.
 *  - `params` fills the entries' `{{name}}` holes. A value is used as given,
 *    or, spelled `{ key, fallback }`, is itself the recipient-language text of
 *    `key` (an object's label, `objects.<object>.label`), else `fallback`.
 *  - The literal `payload.title` / `payload.body` stay the text delivered
 *    whenever a key cannot be rendered: no `i18n` service, a key with no entry
 *    in the recipient's locale or in the catalog's own fallback locale, a
 *    member the producer left unkeyed. A producer that passes no keys is
 *    delivered exactly what it was delivered before this existed, on every
 *    channel.
 *
 * ## Where it renders
 *
 * At delivery, per recipient, ahead of the channel: the inline fan-out renders
 * before each `send()`, and the dispatcher renders each claimed row (and each
 * row of a digest group) before it builds the channel's `Notification`. So
 * every channel — inbox, email, SMS, and any channel a third party mounts —
 * receives the rendered `title` / `body` it already reads, and no channel had
 * to learn the contract.
 *
 * The recipient's language is the ruled chain (#13881), resolved through
 * {@link resolveRecipientLocale}: the recipient's own `sys_user.locale`, else
 * the deployment default. It is negotiated against the locales the `i18n`
 * service holds with `resolveBundleLocale` (`@objectstack/spec/system`), the
 * one negotiation rule, so a bare `zh` reaches a `zh-CN` pack.
 *
 * ## Cost
 *
 * One `sys_user` read per keyed delivery (one per digest group), and none at
 * all for a delivery that carries no keys or a deployment with no `i18n`
 * service. The email and SMS channels read the same row again for the address;
 * the two reads resolve one chain, so they cannot disagree on a language.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { resolveBundleLocale } from '@objectstack/spec/system';
import { RECIPIENT_LOCALE_FIELD, USER_OBJECT, resolveRecipientLocale } from './recipient-locale.js';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';
import { DEFAULT_LOCALE } from './template-renderer.js';

/**
 * One `{{name}}` value of {@link NotificationTextKeys.params}: the text itself,
 * or a catalog key rendered in the recipient's language with `fallback` as the
 * text when the key has no entry.
 */
export type NotificationTextParam = string | { readonly key: string; readonly fallback: string };

/**
 * A notification's text as catalog keys (`EmitInput.keyedText`). At least one
 * of `titleKey` / `bodyKey`; a member left out is delivered as the literal.
 */
export interface NotificationTextKeys {
    /** `II18nService` key of the headline, e.g. `messages.approvalRequestedTitle`. */
    readonly titleKey?: string;
    /** `II18nService` key of the body, e.g. `messages.approvalRequestedBody`. */
    readonly bodyKey?: string;
    /** Values for the `{{name}}` holes of both entries. */
    readonly params?: Readonly<Record<string, NotificationTextParam>>;
}

/** A notification's rendered text — what a channel reads as `title` / `body`. */
export interface RenderedNotificationText {
    readonly title: string;
    readonly body: string;
}

/** The slice of `II18nService` the render asks: `t()`, and `getLocales()` to negotiate when offered. */
export interface NotificationTextI18n {
    t(key: string, locale: string, params?: Record<string, unknown>): string;
    getLocales?(): string[];
}

/**
 * A catalog key: a face and an id, dot-separated (`messages.approvalRequestedTitle`,
 * `objects.crm_deal.label`). One segment alone never names an entry, because
 * `t()` walks the key from the root of a translation bundle and every bundle
 * entry lives under a face; refusing it at emit turns a key that could never
 * render into a loud error instead of a literal delivered forever.
 */
const CATALOG_KEY_SHAPE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

/** A `{{name}}` hole name, the one both `II18nService` implementations interpolate. */
const PARAM_NAME_SHAPE = /^\w+$/;

const TEXT_MEMBERS: ReadonlySet<string> = new Set(['titleKey', 'bodyKey', 'params']);
const KEYED_PARAM_MEMBERS: ReadonlySet<string> = new Set(['key', 'fallback']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The first thing wrong with `value` as {@link NotificationTextKeys}, or `undefined`. */
function problemOf(value: unknown): string | undefined {
    if (!isPlainObject(value)) return 'must be an object';
    for (const member of Object.keys(value)) {
        if (!TEXT_MEMBERS.has(member)) {
            return `has an undeclared member '${member}' (declared: titleKey, bodyKey, params)`;
        }
    }
    for (const member of ['titleKey', 'bodyKey'] as const) {
        const key = value[member];
        if (key !== undefined && (typeof key !== 'string' || !CATALOG_KEY_SHAPE.test(key))) {
            return `.${member} must be a catalog key, a face and an id such as 'messages.myTitle' (got ${JSON.stringify(key)})`;
        }
    }
    if (value.titleKey === undefined && value.bodyKey === undefined) {
        return 'names neither titleKey nor bodyKey';
    }
    const params = value.params;
    if (params === undefined) return undefined;
    if (!isPlainObject(params)) return '.params must be an object';
    for (const [name, param] of Object.entries(params)) {
        if (!PARAM_NAME_SHAPE.test(name)) return `.params has a name '${name}' no {{hole}} can spell`;
        if (typeof param === 'string') continue;
        if (!isPlainObject(param)) return `.params.${name} must be a string or { key, fallback }`;
        for (const member of Object.keys(param)) {
            if (!KEYED_PARAM_MEMBERS.has(member)) return `.params.${name} has an undeclared member '${member}' (declared: key, fallback)`;
        }
        if (typeof param.key !== 'string' || !CATALOG_KEY_SHAPE.test(param.key)) {
            return `.params.${name}.key must be a catalog key such as 'objects.my_object.label' (got ${JSON.stringify(param.key)})`;
        }
        if (typeof param.fallback !== 'string') return `.params.${name}.fallback must be a string`;
    }
    return undefined;
}

/**
 * Refuse a malformed {@link NotificationTextKeys} — `emit()` calls this before
 * it writes anything. The shape is closed: an undeclared member (a `title`
 * spelled for `titleKey`) is refused rather than ignored, so a producer that
 * meant to key its text cannot ship one that silently never renders.
 */
export function assertNotificationTextKeys(value: unknown): asserts value is NotificationTextKeys {
    const problem = problemOf(value);
    if (problem !== undefined) {
        throw new TypeError(`messaging: emit() keyedText ${problem}`);
    }
}

/**
 * The keys a stored delivery row carries, or `undefined` when it carries none
 * (or none that `emit()` could have written — the row is then delivered as its
 * literal text, which is what it held all along).
 */
export function readNotificationTextKeys(value: unknown): NotificationTextKeys | undefined {
    if (value === undefined || problemOf(value) !== undefined) return undefined;
    return value as NotificationTextKeys;
}

export interface NotificationTextRendererOptions {
    /** Resolve the data engine — the recipient's `sys_user.locale` is read from it. */
    getData(): IDataEngine | undefined;
    /** Resolve the `i18n` service, probed at render time. `undefined` ⇒ the literal text. */
    getI18n(): NotificationTextI18n | undefined;
    /** The DEPLOYMENT DEFAULT locale — the second rung of the recipient chain (#13881). */
    getDefaultLocale?(): string | undefined;
    /** User identity object the recipient's locale is read from (default `sys_user`). */
    userObject?: string;
    logger?: { warn(...args: unknown[]): void };
}

/** One notification to render for a recipient: its keys (absent ⇒ literal) and its literal text. */
export interface NotificationTextItem {
    readonly keys?: NotificationTextKeys;
    readonly literal: RenderedNotificationText;
}

/**
 * Renders {@link NotificationTextKeys} for one recipient. One instance per
 * messaging composition: the plugin hands the same one to the service (inline
 * fan-out) and to the dispatcher (durable path), so both paths answer one
 * recipient one way.
 */
export class NotificationTextRenderer {
    private readonly userObject: string;
    /** `key|locale` pairs whose miss has been said — said once, the lookup is not cached. */
    private readonly announcedMisses = new Set<string>();

    constructor(private readonly opts: NotificationTextRendererOptions) {
        this.userObject = opts.userObject ?? USER_OBJECT;
    }

    /**
     * The recipient's language: their own `sys_user.locale`, else the
     * deployment default, through the one chain (`resolveRecipientLocale`).
     * A failed read costs the language, never the delivery.
     */
    async recipientLocale(recipient: string): Promise<string | undefined> {
        const data = this.opts.getData();
        let own: unknown;
        if (data) {
            try {
                // The explicit system opt-in — see FAN_OUT_SYSTEM_CONTEXT: the
                // recipient's language, read to render a delivery to them.
                const user = await data.findOne(
                    this.userObject,
                    { where: { id: recipient }, fields: [RECIPIENT_LOCALE_FIELD] },
                    { context: FAN_OUT_SYSTEM_CONTEXT },
                );
                own = (user as Record<string, unknown> | null | undefined)?.[RECIPIENT_LOCALE_FIELD];
            } catch (err) {
                this.opts.logger?.warn(
                    `[messaging] locale lookup for '${recipient}' failed (${(err as Error)?.message ?? String(err)}); ` +
                    'rendering its notification text in the deployment default',
                );
            }
        }
        return resolveRecipientLocale(own, () => this.opts.getDefaultLocale?.());
    }

    /**
     * Render every item for ONE recipient: one locale read for the lot, and
     * none when no item carries keys or no `i18n` service is registered.
     */
    async renderAllFor(recipient: string, items: readonly NotificationTextItem[]): Promise<RenderedNotificationText[]> {
        if (!items.some((item) => item.keys)) return items.map((item) => item.literal);
        const i18n = this.i18n();
        if (!i18n) return items.map((item) => item.literal);
        const locale = await this.recipientLocale(recipient);
        return items.map((item) => (item.keys ? this.renderWith(i18n, item.keys, item.literal, locale) : item.literal));
    }

    /** Render one notification's text for `recipient`. */
    async renderFor(
        recipient: string,
        keys: NotificationTextKeys,
        literal: RenderedNotificationText,
    ): Promise<RenderedNotificationText> {
        const [rendered] = await this.renderAllFor(recipient, [{ keys, literal }]);
        return rendered;
    }

    /** Render `keys` in `locale` (`undefined` ⇒ {@link DEFAULT_LOCALE}), falling back to `literal` per member. */
    render(
        keys: NotificationTextKeys,
        literal: RenderedNotificationText,
        locale: string | undefined,
    ): RenderedNotificationText {
        const i18n = this.i18n();
        return i18n ? this.renderWith(i18n, keys, literal, locale) : literal;
    }

    private i18n(): NotificationTextI18n | undefined {
        try {
            const service = this.opts.getI18n();
            return service && typeof service.t === 'function' ? service : undefined;
        } catch {
            return undefined;
        }
    }

    private renderWith(
        i18n: NotificationTextI18n,
        keys: NotificationTextKeys,
        literal: RenderedNotificationText,
        requested: string | undefined,
    ): RenderedNotificationText {
        const locale = negotiatedLocale(i18n, requested ?? DEFAULT_LOCALE);
        const params: Record<string, string> = {};
        for (const [name, param] of Object.entries(keys.params ?? {})) {
            params[name] = typeof param === 'string' ? param : (lookup(i18n, param.key, locale) ?? param.fallback);
        }
        return {
            title: keys.titleKey ? (this.entry(i18n, keys.titleKey, locale, params) ?? literal.title) : literal.title,
            body: keys.bodyKey ? (this.entry(i18n, keys.bodyKey, locale, params) ?? literal.body) : literal.body,
        };
    }

    /** A title/body entry, or `undefined` (said once per key and locale) when the catalog holds none. */
    private entry(
        i18n: NotificationTextI18n,
        key: string,
        locale: string,
        params: Record<string, string>,
    ): string | undefined {
        const text = lookup(i18n, key, locale, params);
        if (text === undefined) {
            const said = `${key}|${locale}`;
            if (!this.announcedMisses.has(said)) {
                this.announcedMisses.add(said);
                this.opts.logger?.warn(
                    `[messaging] notification text key '${key}' has no catalog entry for '${locale}' ` +
                    "(nor in the catalog's fallback locale); the emitter's literal text was delivered",
                );
            }
        }
        return text;
    }
}

/** `t()`'s answer, or `undefined` for a miss (`t()` echoes the key), an empty answer or a throw. */
function lookup(
    i18n: NotificationTextI18n,
    key: string,
    locale: string,
    params?: Record<string, string>,
): string | undefined {
    try {
        const text = params && Object.keys(params).length > 0 ? i18n.t(key, locale, params) : i18n.t(key, locale);
        return typeof text === 'string' && text.trim().length > 0 && text !== key ? text : undefined;
    } catch {
        // A misbehaving i18n service costs the language, never the delivery.
        return undefined;
    }
}

/**
 * The locale `i18n` can ANSWER in, for the locale the recipient holds:
 * `resolveBundleLocale` over what `getLocales()` reports. The requested tag
 * passes through untouched when there is nothing to negotiate against.
 */
function negotiatedLocale(i18n: NotificationTextI18n, requested: string): string {
    if (typeof i18n.getLocales !== 'function') return requested;
    let available: unknown;
    try {
        available = i18n.getLocales();
    } catch {
        return requested;
    }
    if (!Array.isArray(available) || available.length === 0) return requested;
    const offered: Record<string, true> = {};
    for (const code of available) {
        if (typeof code === 'string' && code.length > 0) offered[code] = true;
    }
    return resolveBundleLocale(offered, requested) ?? requested;
}
