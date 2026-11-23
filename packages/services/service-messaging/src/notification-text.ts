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
 *    the catalog entry `key`, else `fallback`; or, spelled
 *    `{ objectLabel, fallback }`, is the label of the object named
 *    `objectLabel` in the recipient's language, else `fallback`.
 *  - [#35384] An object's label is METADATA, not a catalog sentence, so the
 *    `{ objectLabel }` param is resolved as `GET /meta/object/:name` serves it:
 *    by `translateObject` (`@objectstack/spec/system`) over the object's
 *    served definition and its packaged base, with the metadata route's
 *    `ResolveOptions` (the recipient's negotiated locale, the DECLARED
 *    fallback chain, and the authored language — the declared `sourceLocale`
 *    else `defaultLocale`). So a recipient in a deployment's `sourceLocale`
 *    reads the authored label, never the `defaultLocale` row `t()` falls back
 *    to, and a renamed packaged object reads its rename. A `{ key }` param
 *    still resolves through `t()`: rows stored before the typed param existed
 *    render exactly as they did.
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
 * row of a digest group, with that digest's heading) before it builds the
 * channel's `Notification`. So
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
 * service. A digest of two or more items always carries a key — its heading,
 * which this service keys from its own bundle (#25015, `digest-render.ts`) —
 * so each such group costs its one read. The email and SMS channels read the same row again for the address;
 * the two reads resolve one chain, so they cannot disagree on a language.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import {
    resolveBundleLocale,
    translateObject,
    type ObjectLike,
    type ResolveOptions,
    type TranslationBundle,
} from '@objectstack/spec/system';
import { RECIPIENT_LOCALE_FIELD, USER_OBJECT, resolveRecipientLocale } from './recipient-locale.js';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';
import { DEFAULT_LOCALE } from './template-renderer.js';

/**
 * One `{{name}}` value of {@link NotificationTextKeys.params}: the text itself;
 * a catalog key rendered in the recipient's language with `fallback` as the
 * text when the key has no entry; or [#35384] an object's label, by the
 * object's name, resolved as the metadata route serves it with `fallback` as
 * the text when nothing resolves ({@link NotificationObjectLabelParam}).
 */
export type NotificationTextParam =
    | string
    | { readonly key: string; readonly fallback: string }
    | NotificationObjectLabelParam;

/**
 * [#35384] A `{{name}}` value that is the label of the object `objectLabel`
 * names (its API name, `crm_deal`), in the recipient's language, as
 * `GET /meta/object/:name` serves it: `translateObject` over the object's
 * served definition and packaged base, with the metadata route's resolve
 * options. `fallback` is the text when nothing resolves (no `i18n` service
 * that can hand its translations over, no data engine that knows the object).
 */
export interface NotificationObjectLabelParam {
    readonly objectLabel: string;
    readonly fallback: string;
}

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

/**
 * The slice of `II18nService` the render asks: `t()`, `getLocales()` to
 * negotiate when offered, and [#35384] the members an object label is resolved
 * by, as the metadata route reads them: `getTranslations()` per locale, and the
 * declared `getFallbackLocale()` / `getSourceLocale()` / `getDefaultLocale()`.
 */
export interface NotificationTextI18n {
    t(key: string, locale: string, params?: Record<string, unknown>): string;
    getLocales?(): string[];
    getTranslations?(locale: string): Record<string, unknown>;
    getFallbackLocale?(): string | undefined;
    getSourceLocale?(): string | undefined;
    getDefaultLocale?(): string;
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
const OBJECT_LABEL_PARAM_MEMBERS: ReadonlySet<string> = new Set(['objectLabel', 'fallback']);

/**
 * An object's API name: one segment of {@link CATALOG_KEY_SHAPE}, so every
 * object a `{ key: 'objects.<object>.label' }` param could name, the typed
 * param names too.
 */
const OBJECT_NAME_SHAPE = /^[A-Za-z0-9_-]+$/;

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
        if (!isPlainObject(param)) return `.params.${name} must be a string, { key, fallback } or { objectLabel, fallback }`;
        if ('objectLabel' in param) {
            for (const member of Object.keys(param)) {
                if (!OBJECT_LABEL_PARAM_MEMBERS.has(member)) {
                    return `.params.${name} has an undeclared member '${member}' (declared: objectLabel, fallback)`;
                }
            }
            if (typeof param.objectLabel !== 'string' || !OBJECT_NAME_SHAPE.test(param.objectLabel)) {
                return `.params.${name}.objectLabel must be an object's API name such as 'crm_deal' (got ${JSON.stringify(param.objectLabel)})`;
            }
            if (typeof param.fallback !== 'string') return `.params.${name}.fallback must be a string`;
            continue;
        }
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

    /**
     * [#32240] Render a STORED notification's `keys` for a READER whose
     * request locale is `locale` — the inbox read (`inbox-reader-locale.ts`).
     * The same render as delivery, member by member over `literal` (the text
     * stored at delivery), with one difference: a key the catalog cannot
     * answer is not announced, because nothing was delivered — the stored
     * text is simply served. `undefined` when no `i18n` service is
     * registered, so the caller leaves the row as stored.
     */
    renderForReader(
        keys: NotificationTextKeys,
        literal: RenderedNotificationText,
        locale: string,
    ): RenderedNotificationText | undefined {
        const i18n = this.i18n();
        return i18n ? this.renderWith(i18n, keys, literal, locale, false) : undefined;
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
        announceMisses = true,
    ): RenderedNotificationText {
        const locale = negotiatedLocale(i18n, requested ?? DEFAULT_LOCALE);
        const params: Record<string, string> = {};
        // [#35384] Built on the first object label this render asks, once.
        let translation: { value: MetaLabelTranslation | undefined } | undefined;
        for (const [name, param] of Object.entries(keys.params ?? {})) {
            if (typeof param === 'string') {
                params[name] = param;
            } else if ('objectLabel' in param) {
                translation ??= { value: metaLabelTranslation(i18n, locale) };
                params[name] = this.objectLabel(translation.value, param.objectLabel) ?? param.fallback;
            } else {
                params[name] = lookup(i18n, param.key, locale) ?? param.fallback;
            }
        }
        const entry = (key: string): string | undefined => announceMisses
            ? this.entry(i18n, key, locale, params)
            : lookup(i18n, key, locale, params);
        return {
            title: keys.titleKey ? (entry(keys.titleKey) ?? literal.title) : literal.title,
            body: keys.bodyKey ? (entry(keys.bodyKey) ?? literal.body) : literal.body,
        };
    }

    /**
     * [#35384] The label of `objectName` as `GET /meta/object/:name` serves it
     * in the options' locale: `translateObject` over the object's served
     * definition (`getSchema`, its `label` a code extension's rename included)
     * with its packaged base (`registry.getPackagedObjectBase`, ADR-0029
     * D9.2a), the two reads the metadata route's own accessors make, off the
     * data engine this renderer already reads recipients from. `undefined`
     * when nothing resolves: no translation to resolve with, no engine that
     * knows the object, or a throw (a misbehaving service costs the language,
     * never the delivery).
     */
    private objectLabel(translation: MetaLabelTranslation | undefined, objectName: string): string | undefined {
        if (!translation) return undefined;
        try {
            const data = this.opts.getData() as unknown as ObjectLabelSource | undefined;
            const served = labelText(servedObjectDef(data, objectName)?.label);
            const doc: ObjectLike = { name: objectName, ...(served !== undefined ? { label: served } : {}) };
            const packagedBase = packagedBaseOf(data, objectName);
            return labelText(translateObject(doc, translation.bundle, {
                ...translation.options,
                ...(packagedBase !== undefined ? { packagedBase } : {}),
            }).label);
        } catch {
            return undefined;
        }
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

/** What an object label is translated with: the bundle and the metadata route's `ResolveOptions`. */
interface MetaLabelTranslation {
    readonly bundle: TranslationBundle | undefined;
    readonly options: ResolveOptions;
}

/**
 * [#35384] What the metadata route (`GET /meta/object/:name`) translates an
 * object with, for a recipient in `locale`: the bundle, every locale `i18n`
 * holds keyed by locale (`translationBundleOf` in rest), and the
 * `ResolveOptions` that route builds (`metaTranslateOptions` in rest): the
 * locale, the DECLARED fallback chain (`getFallbackLocale()`), and the
 * authored language, the declared `sourceLocale` (`getSourceLocale()`) else
 * `defaultLocale` (`getDefaultLocale()`). Each getter is feature-detected; a
 * service that declares none gets none. The locale is the negotiated one, as
 * objectql's refusal labels and the approvals reader hand it.
 *
 * `undefined` for a service that cannot hand its translations over (no
 * `getLocales` / `getTranslations`) or that throws: the param's fallback
 * stands.
 */
function metaLabelTranslation(i18n: NotificationTextI18n, locale: string): MetaLabelTranslation | undefined {
    if (typeof i18n.getLocales !== 'function' || typeof i18n.getTranslations !== 'function') return undefined;
    try {
        const bundle: Record<string, unknown> = {};
        for (const code of i18n.getLocales()) {
            const data = i18n.getTranslations(code);
            if (data && typeof data === 'object') bundle[code] = data;
        }
        const fallback = typeof i18n.getFallbackLocale === 'function' ? i18n.getFallbackLocale() : undefined;
        const source = typeof i18n.getSourceLocale === 'function' ? i18n.getSourceLocale() : undefined;
        const authored = typeof source === 'string' && source.length > 0
            ? source
            : typeof i18n.getDefaultLocale === 'function' ? i18n.getDefaultLocale() : undefined;
        const options: ResolveOptions = {
            locale,
            ...(typeof fallback === 'string' && fallback.length > 0 ? { fallbackChain: [fallback] } : {}),
            ...(typeof authored === 'string' && authored.length > 0 ? { defaultLocale: authored } : {}),
        };
        return { bundle: Object.keys(bundle).length > 0 ? (bundle as TranslationBundle) : undefined, options };
    } catch {
        return undefined;
    }
}

/**
 * [#35384] Where an object's label is served from: the data engine's
 * `getSchema(name)` (the served definition) and `registry.getPackagedObjectBase(name)`
 * (the packaged declaration). Each member is feature-detected.
 */
interface ObjectLabelSource {
    getSchema?(objectName: string): unknown;
    registry?: unknown;
}

/** The object's served definition, `undefined` when the source cannot answer. */
function servedObjectDef(source: ObjectLabelSource | undefined, objectName: string): Record<string, unknown> | undefined {
    if (!source || typeof source.getSchema !== 'function') return undefined;
    try {
        const def = source.getSchema(objectName);
        return def && typeof def === 'object' ? (def as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}

/** The object's packaged base, `undefined` when none is known (the translator then answers from the catalog). */
function packagedBaseOf(source: ObjectLabelSource | undefined, objectName: string): unknown {
    const registry = source?.registry as { getPackagedObjectBase?: (name: string) => unknown } | undefined;
    if (!registry || typeof registry.getPackagedObjectBase !== 'function') return undefined;
    try {
        const base = registry.getPackagedObjectBase(objectName);
        return base && typeof base === 'object' ? base : undefined;
    } catch {
        return undefined;
    }
}

/** A non-blank label, or `undefined`. */
function labelText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
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
