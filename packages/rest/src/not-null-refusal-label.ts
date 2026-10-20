// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24715] A `/data` write's NOT NULL refusal, named by the field's LABEL in the
 * caller's language.
 *
 * ## What was wrong
 *
 * A field declared `storage: { notNull: true }` without `required` is
 * ADR-0113's engine-populated column: the record validator judges `required`
 * only, so a write with no value for it reaches the driver, and the DATABASE
 * refuses it. `mapDataError` classifies that refusal from the driver's text,
 * which carries the column and nothing else, so `PATCH` with
 * `{ "unit_price": null }` answered `error: "unit_price is required"` for a
 * field labelled "Sales Price", and the hint told the author to declare the
 * field `required` — the move ADR-0113 D1 / D2 rule out for a column a hook
 * fills. The same field declared `required` was refused by the validator
 * instead, by its label, so the posture the ADR recommends read worse.
 *
 * ## The split
 *
 * The classification stays field-map-free: it sees the driver's text and the
 * object's name, and its answer names the column. THIS door holds the object,
 * so it names the field — and only the field — for that one answer
 * (`notNullRefusalSite` recognises it, `relabelNotNullRefusal` rewrites it, both
 * in `@objectstack/types`). Nothing else moves: `status`, `code`,
 * `fields[0].field`, `fields[0].code`, `object` and the key set are the
 * classification's.
 *
 * ## Localized the way the record validator localizes its own `required`
 *
 * The validator (`@objectstack/objectql`, `record-validator.ts`) renders
 * `{{label}} is required` from the shared catalog in the caller's locale, and
 * names the field translation bundle → declared `label` → API name. Its
 * builder is not on `@objectstack/objectql`'s public entry, and this package
 * does not depend on the engine at run time, so what is shared is what that
 * builder is made of — every piece a `@objectstack/spec/system` export:
 *
 *  - the sentence: `renderValidationMessage`, message key `required`, with the
 *    deployment's `validation.field.required` override honoured through the
 *    i18n service's `t`;
 *  - the label: `t(objectFieldLabelKey(object, field), locale)`, a miss being
 *    the key echoed back, then the declared `label`, then the API name;
 *  - the locale: `ExecutionContext.locale` — the value the engine's validator
 *    received for this same request — negotiated against the locales the i18n
 *    service holds by `resolveBundleLocale`, the one negotiation rule the engine
 *    asks too (`zh` reaches a `zh-CN` bundle).
 *
 * ## What is left alone
 *
 *  - A column the object does not declare: the drift where metadata dropped a
 *    field and the column stayed NOT NULL. There is no label to give; the
 *    column's sentence and the drift hint are the answer.
 *  - A refusal the driver attributes to ANOTHER table (SQLite and Postgres name
 *    it): a hook's write to a second object failed inside this request, and the
 *    column is that object's, not one of the requested object's fields.
 *  - Any read that fails: the classification's answer goes out unchanged. A
 *    label is a courtesy on an answer that is already correct; it never turns a
 *    `400` into anything else.
 */

import {
    objectFieldLabelKey,
    renderValidationMessage,
    resolveBundleLocale,
    type ValidationMessageTranslator,
} from '@objectstack/spec/system';
import { notNullRefusalSite, relabelNotNullRefusal } from '@objectstack/types';

/** The I/O {@link labelNotNullRefusal} needs from the door; each is asked only for a NOT NULL refusal. */
export interface NotNullRefusalLabelSources {
    /** The object the request addressed — the route's `:object` segment. */
    readonly object: string | undefined;
    /** That object's definition by name, or `undefined` when nothing is behind the name. */
    readObject(name: string): Promise<unknown>;
    /** The caller's `ExecutionContext.locale`, or `undefined` when it has none. */
    readonly locale: string | undefined;
    /** The request environment's i18n service, or `undefined` when none is registered. */
    resolveI18nService(): Promise<unknown>;
}

type ClassifiedAnswer = { status: number; body: Record<string, unknown> };

/**
 * Name the field of a NOT NULL refusal by its label, in the caller's locale —
 * or hand `answer` back unchanged when it is not one, or when the field cannot
 * be named (see the module header for each case).
 */
export async function labelNotNullRefusal(
    answer: ClassifiedAnswer,
    sources: NotNullRefusalLabelSources,
): Promise<ClassifiedAnswer> {
    const site = notNullRefusalSite(answer);
    const object = sources.object;
    if (!site || !object) return answer;
    if (site.table !== undefined && site.table !== object) return answer;
    try {
        const definition = (await sources.readObject(object)) as { fields?: Record<string, unknown> } | undefined;
        const field = definition?.fields?.[site.column] as
            | { label?: unknown; storage?: { notNull?: unknown } }
            | undefined;
        if (!field || typeof field !== 'object') return answer;

        const i18n = (await sources.resolveI18nService()) as
            | { t?: (key: string, locale: string, params?: Record<string, unknown>) => string; getLocales?: () => unknown }
            | undefined;
        const translate: ValidationMessageTranslator | undefined = typeof i18n?.t === 'function'
            ? (key, locale, params) => i18n.t!(key, locale, params)
            : undefined;
        const locale = negotiatedLocale(i18n, sources.locale);
        const label = fieldLabel(object, site.column, field.label, translate, locale);
        const message = renderValidationMessage(
            { messageKey: 'required', label, field: site.column, params: {} },
            { locale, translate },
        );
        return relabelNotNullRefusal(answer, {
            message,
            // Truthiness, as the driver reads it when it builds the column.
            declaresNotNull: Boolean(field.storage?.notNull),
        });
    } catch {
        return answer;
    }
}

/**
 * The field's display name: the translation bundle in `locale`, then the
 * declared `label`, then the API name. A translator echoing the key back is a
 * miss (the `II18nService.t` contract), and a throwing one is a miss too.
 */
function fieldLabel(
    object: string,
    column: string,
    declared: unknown,
    translate: ValidationMessageTranslator | undefined,
    locale: string | undefined,
): string {
    if (translate && locale) {
        const key = objectFieldLabelKey(object, column);
        try {
            const translated = translate(key, locale);
            if (typeof translated === 'string' && translated.length > 0 && translated !== key) return translated;
        } catch {
            // The declared label below.
        }
    }
    const label = typeof declared === 'string' ? declared.trim() : '';
    return label.length > 0 ? label : column;
}

/**
 * The locale the i18n service can answer in, for the one the caller asked for:
 * `resolveBundleLocale` over the service's `getLocales()`. The requested tag
 * passes through untouched when there is nothing to negotiate against.
 */
function negotiatedLocale(
    i18n: { getLocales?: () => unknown } | undefined,
    requested: string | undefined,
): string | undefined {
    if (!requested || typeof i18n?.getLocales !== 'function') return requested;
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
