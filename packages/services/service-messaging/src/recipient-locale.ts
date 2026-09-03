// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13881 — the recipient locale, resolved PER RECIPIENT, after fan-out.
 *
 * Maintainer ruling 2026-09-01, quoted verbatim and untranslated:
 *
 * > **解析点移到 fan-out 后按收件人**:`payload.locale` 不再是 fan-out 前单值
 * > **解析链 = 收件人 `locale` → 部署默认**(`II18nService.getDefaultLocale()`),缺失恒回退,⛔ 任何路径不得死信
 *
 * This module is the ONE read point of that chain. Every channel that picks a
 * localized row for a recipient (`sys_email_template` on the notify template
 * path, `sys_notification_template` on the topic path) resolves through
 * {@link resolveRecipientLocale}, so "which language does this recipient get"
 * has exactly one answer across email, inbox and SMS — a notification cannot
 * arrive in Chinese by mail and in English in the inbox.
 *
 * ## The chain
 *
 *  1. the recipient's own `sys_user.locale` ({@link RECIPIENT_LOCALE_FIELD}),
 *     read from the SAME `sys_user` row the channel already fetches for the
 *     address (email / phone) — one query per recipient, no second lookup;
 *  2. the deployment default — `II18nService.getDefaultLocale()`, probed
 *     lazily at delivery time by the plugin (`getDefaultTemplateLocale`).
 *
 * Absent, empty, whitespace, non-string, or malformed ⇒ rung 2. Nothing in
 * rung 1 can ever produce a value the template lookup has not seen a locale
 * tag shaped like. Rung 2 absent too ⇒ `undefined`, which is what the
 * downstream ladders are written against: `IEmailService.sendTemplate` then
 * resolves its documented `en-US` default, and `NotificationTemplateStore`
 * walks to {@link DEFAULT_LOCALE}.
 *
 * ## What is deliberately NOT in the chain
 *
 *  - `payload.locale` — the pre-ruling single value, interpolated once BEFORE
 *    fan-out so every recipient of a notify node got the same row. The ruling
 *    retired it (「不再是 fan-out 前单值」) and measured no in-repo producer;
 *    a value a producer still writes there is ignored, and the notify node's
 *    contract text says so.
 *  - `sys_user_preference` — the ruling rejected the preference-bag shape
 *    (option B) outright; there is no fallback read from it.
 *  - request-scoped locale (`Accept-Language`) — does not exist at async
 *    delivery time.
 *
 * ## The dead-letter pin
 *
 * hotcrm measured the failure shape this chain must never reproduce: a
 * missing preference interpolated to the literal string `"undefined"` and
 * handed to the template lookup, which then dead-lettered every delivery for
 * every user without a preference row (`TEMPLATE_NOT_FOUND` classifies
 * `permanent`). {@link normalizeRecipientLocale} refuses that literal — and
 * anything else that is not a locale tag — so the only value that can reach a
 * lookup from rung 1 is a tag-shaped string the recipient actually holds.
 *
 * ## Interaction with the `TEMPLATE_*` permanent-failure class
 *
 * The downstream ladders are unchanged: a named locale that has no row falls
 * to `en-US` inside `sendTemplate`, and to `DEFAULT_LOCALE` inside the store.
 * So a recipient locale can dead-letter a delivery ONLY where the deployment
 * default would have too — a bundle with no `en-US` row and no row for the
 * requested tag. The one asymmetry: such a bundle that carries the deployment
 * default's row but not `en-US` delivered under the old single value and
 * fails for a recipient whose own locale is a third tag. That bundle is off
 * the documented contract (`en-US` is the ladder's floor), so the fix is the
 * bundle, not a third rung here.
 */

/** The `sys_user` column that carries a recipient's own notification language. */
export const RECIPIENT_LOCALE_FIELD = 'locale';

/** The user identity object a recipient id is resolved against. */
export const USER_OBJECT = 'sys_user';

/**
 * BCP-47-shaped: a 2–8 letter language subtag, then any number of 1–8
 * alphanumeric subtags (`zh`, `zh-CN`, `zh-Hans-CN`, `es-419`). Shape only —
 * membership is the template bundle's business, and the ladders below handle
 * a shipped-nowhere tag by falling to their floor.
 */
const LOCALE_TAG_SHAPE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * The stringified-nothing literals a lossy producer can leave in a column.
 * hotcrm's measured dead-letter shape was exactly `"undefined"`; `"null"` is
 * the same accident one serializer over.
 */
const NOTHING_LITERALS: ReadonlySet<string> = new Set(['undefined', 'null']);

/**
 * The recipient's own locale, or `undefined` when the value cannot name one.
 *
 * Pure and total: never throws, never returns a non-tag string. Trims
 * whitespace; refuses empty, non-string, the stringified-nothing literals, and
 * anything not shaped like a BCP-47 tag.
 */
export function normalizeRecipientLocale(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const value = raw.trim();
    if (!value || NOTHING_LITERALS.has(value)) return undefined;
    return LOCALE_TAG_SHAPE.test(value) ? value : undefined;
}

/**
 * The ruled chain, as one function: the recipient's own `sys_user.locale`
 * (already read off the recipient row — pass the raw column value) → the
 * deployment default (probed lazily, so live `localization` changes and a
 * late-registered i18n service are both honoured) → `undefined`.
 *
 * `deploymentDefault` may itself return an empty or non-string value; that is
 * normalized too, because "nothing named" must arrive at the ladders as an
 * absent key, never as `''`.
 */
export function resolveRecipientLocale(
    recipientLocale: unknown,
    deploymentDefault: (() => string | undefined) | undefined,
): string | undefined {
    const own = normalizeRecipientLocale(recipientLocale);
    if (own) return own;
    let fallback: unknown;
    try {
        fallback = deploymentDefault?.();
    } catch {
        // The deployment default is a best-effort probe — a throwing i18n
        // service must not cost the delivery. Nothing named ⇒ the ladders'
        // documented floor.
        fallback = undefined;
    }
    return normalizeRecipientLocale(fallback);
}
