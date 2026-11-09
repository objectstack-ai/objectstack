// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { PushDeliveryDataSchema, PushRouteSchema } from '@objectstack/spec/api';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { UserDevice } from '@objectstack/spec/system';
import { RECIPIENT_LOCALE_FIELD, USER_OBJECT, resolveRecipientLocale } from './recipient-locale.js';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';
import type {
    ChannelAvailability,
    ChannelAvailabilityQuery,
    ChannelUnavailableReason,
    Delivery,
    ErrorClass,
    MessagingChannel,
    MessagingChannelContext,
    SendResult,
} from './channel.js';

/**
 * Structural view of the push service (`@objectstack/service-push`'s
 * `IPushService`), declared locally so service-messaging takes no runtime
 * dependency on it: the channel resolves whatever is registered under the
 * `push` service and sends through this shape (as `SmsSenderSurface` does in
 * sms-channel.ts).
 */
export interface PushSenderSurface {
    /** The vendors the service has a transport for. */
    vendors(): readonly string[];
    send(message: {
        vendor: UserDevice['vendor'];
        token: string;
        title: string;
        body: string;
        data: Record<string, string>;
        /** The generic visible line a hosted relay delivery shows instead of the content, in the recipient's language. */
        notice?: string;
    }): Promise<
        | { status: 'sent'; messageId?: string }
        | { status: 'invalid_token'; reason: string }
        | { status: 'failed'; error: string; retryable: boolean }
    >;
}

/** The two device-registry members the channel uses (`INotificationService`, implemented by `MessagingService`). */
export interface PushDeviceSurface {
    listDevices(userId: string): Promise<UserDevice[]>;
    invalidateDeviceToken(token: string): Promise<void>;
}

export interface PushChannelOptions {
    /**
     * Resolve the push service; `undefined` ⇒ there is no transport, which
     * {@link MessagingChannel.send} refuses with the declared
     * `transport_not_configured` reason, as the sms and email channels do.
     */
    getPush(): PushSenderSurface | undefined;
    /** The device registry: the recipient's devices, and the dead-token retirement. */
    devices: PushDeviceSurface;
    /**
     * The data engine the recipient's `sys_user.locale` is read from, for the
     * generic notice line ({@link pushNoticeLine}). Absent, or a read that
     * fails: the deployment default, then English. Never costs the delivery.
     */
    getData?(): IDataEngine | undefined;
    /** The deployment default locale (`II18nService.getDefaultLocale()`), probed per delivery. */
    getDefaultTemplateLocale?(): string | undefined;
}

/**
 * The generic visible line a hosted relay delivery shows, per locale. The
 * relay is a third party to the notification, so its payload carries this
 * line instead of the title and body (`PushRelayPayloadSchema.text`), in the
 * recipient's language: the same chain every channel reads
 * (`resolveRecipientLocale`, ruling on #29920 Q4 C). A locale with no line
 * here takes its language's line, else English.
 */
export const PUSH_NOTICE_LINES: Readonly<Record<string, string>> = {
    en: 'You have a new notification',
    'zh-CN': '您有一条新通知',
    'ja-JP': '新しい通知があります',
    'es-ES': 'Tienes una notificación nueva',
};

/** The notice line for `locale`: its own line, else its language's, else English. */
export function pushNoticeLine(locale: string | undefined): string {
    if (locale) {
        const wanted = locale.toLowerCase();
        const keys = Object.keys(PUSH_NOTICE_LINES);
        const exact = keys.find((k) => k.toLowerCase() === wanted);
        if (exact) return PUSH_NOTICE_LINES[exact]!;
        const language = wanted.split('-')[0];
        const sameLanguage = keys.find((k) => k.toLowerCase().split('-')[0] === language);
        if (sameLanguage) return PUSH_NOTICE_LINES[sameLanguage]!;
    }
    return PUSH_NOTICE_LINES.en!;
}

/** The one token for "there is no transport", shared with `isAvailable()` (see sms-channel.ts). */
const TRANSPORT_NOT_CONFIGURED: ChannelUnavailableReason = 'transport_not_configured';

/**
 * Error-string prefixes, read back by {@link classify}. The dispatcher hands
 * `classifyError` the `SendResult.error` string, so the grade travels as its
 * leading token, the convention sms-channel.ts uses.
 */
const NO_PUSH_DEVICE = 'no_push_device';
const ALL_TOKENS_DEAD = 'invalid_recipient';
const PUSH_REFUSED = 'push_refused';

/**
 * Byte ceilings for the visible text. APNs and FCM both refuse a payload over
 * 4 KB; the title, the body and the data together stay well under it, so a
 * long notification is shortened rather than refused.
 */
const TITLE_MAX_BYTES = 256;
const BODY_MAX_BYTES = 2048;
/** A route longer than this is left out (the tap then opens the shell's default screen). */
const ROUTE_MAX_BYTES = 1024;

/**
 * The `push` channel (ADR-0012 §4, §6; #29041) — delivers a notification to
 * the recipient's phones through the registered `push` service
 * (`@objectstack/service-push`: APNs and FCM).
 *
 * For one delivery (one recipient user): read the user's devices from the
 * device registry (`sys_user_device`, which this package owns), keep the
 * enabled ones whose vendor the push service has a transport for, and send
 * each one the notification's title and body (already in the recipient's
 * language: fan-out renders keyed text per recipient) plus its delivery data
 * (`PushDeliveryDataSchema`): the notification id, when it passes
 * `PushRouteSchema` its `actionUrl` as `route`, and the device row's `origin`
 * when it holds one. An `actionUrl` that is not a
 * same-server path is left out, never sent; the delivery is not failed for it.
 *
 * **Dead tokens are retired here.** A device the vendor answers `invalid_token`
 * for (APNs `BadDeviceToken` / `Unregistered`, FCM `UNREGISTERED`) is retired
 * through `invalidateDeviceToken`: the row is kept, disabled, with its time
 * (`UserDeviceSchema` rule c). The channel does it, not the dispatcher, because
 * one delivery fans out to several devices and only the channel knows which
 * token died; the rest of the user's devices still receive the push.
 *
 * Outcome of one delivery:
 *
 * - at least one device accepted it ⇒ delivered. A device that failed beside
 *   it is logged, not retried: a retry would push the devices that already
 *   received it a second time.
 * - every addressed device was reported dead ⇒ `invalid_recipient`
 *   (suppressed, not dead-lettered: the recipient, not the transport, is gone).
 * - the user has no enabled device ⇒ `invalid_recipient` too: there is
 *   nothing to deliver to, and no retry changes that.
 * - devices exist but none on a vendor the service can reach, or the vendor
 *   refused the push for a reason no retry repairs ⇒ `permanent`.
 * - a timeout, a 429 or a 5xx with nothing delivered ⇒ `retryable`.
 * - no push service registered ⇒ refused `transport_not_configured`,
 *   `permanent`, exactly as the sms and email channels answer it.
 */
export function createPushChannel(opts: PushChannelOptions): MessagingChannel {
    /**
     * The recipient's language (#13881's chain: `sys_user.locale`, then the
     * deployment default), read once per delivery for the notice line. A
     * failed read falls to the deployment default: it never costs the push.
     */
    async function recipientLocale(ctx: MessagingChannelContext, recipient: string): Promise<string | undefined> {
        const deploymentLocale = () => opts.getDefaultTemplateLocale?.();
        const data = opts.getData?.();
        let own: unknown;
        if (data) {
            try {
                // The explicit system opt-in — see FAN_OUT_SYSTEM_CONTEXT: the
                // recipient's locale, read for the delivery only.
                const user = await data.findOne(
                    USER_OBJECT,
                    { where: { id: recipient }, fields: [RECIPIENT_LOCALE_FIELD] },
                    { context: FAN_OUT_SYSTEM_CONTEXT },
                );
                own = (user as Record<string, unknown> | null | undefined)?.[RECIPIENT_LOCALE_FIELD];
            } catch (err) {
                ctx.logger.warn(
                    `[push] recipient locale lookup for '${recipient}' failed (${(err as Error).message}); the notice line takes the deployment default`,
                );
            }
        }
        return resolveRecipientLocale(own, deploymentLocale);
    }

    return {
        id: 'push',

        /**
         * Can this deployment push at all? A registered push service with at
         * least one vendor transport. A service-registry call and a property
         * read: no I/O, no cache (the sms channel's reasoning applies as is).
         */
        isAvailable(_ctx: MessagingChannelContext, _query: ChannelAvailabilityQuery): ChannelAvailability {
            const push = opts.getPush();
            return push && push.vendors().length > 0
                ? { available: true }
                : { available: false, reason: TRANSPORT_NOT_CONFIGURED };
        },

        async send(ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult> {
            const push = opts.getPush();
            const vendors = push?.vendors() ?? [];
            if (!push || vendors.length === 0) {
                ctx.logger.warn(`[push] no push transport is configured; '${delivery.recipient}' was NOT pushed`);
                return {
                    ok: false,
                    error: `${TRANSPORT_NOT_CONFIGURED}: no 'push' service with a configured vendor is registered; `
                        + `nothing was sent to '${delivery.recipient}'`,
                };
            }

            const devices = (await opts.devices.listDevices(delivery.recipient)).filter((d) => d.enabled);
            if (devices.length === 0) {
                return { ok: false, error: `${NO_PUSH_DEVICE}: recipient '${delivery.recipient}' has no enabled push device` };
            }
            const reachable = devices.filter((d) => vendors.includes(d.vendor));
            if (reachable.length === 0) {
                return {
                    ok: false,
                    error: `${PUSH_REFUSED}: recipient '${delivery.recipient}' has devices only on `
                        + `${[...new Set(devices.map((d) => d.vendor))].join(', ')}, which no push transport is configured for`,
                };
            }

            const n = delivery.notification;
            const title = truncateUtf8(plain(n.title), TITLE_MAX_BYTES);
            const body = truncateUtf8(plain(n.body), BODY_MAX_BYTES);
            const data = deliveryData(n.notificationId, n.actionUrl);
            const notice = pushNoticeLine(await recipientLocale(ctx, delivery.recipient));

            const sent: string[] = [];
            const dead: string[] = [];
            const failures: Array<{ error: string; retryable: boolean }> = [];
            for (const device of reachable) {
                const result = await push.send({
                    vendor: device.vendor,
                    token: device.token,
                    title,
                    body,
                    data: withOrigin(data, device.origin),
                    notice,
                });
                if (result.status === 'sent') {
                    sent.push(result.messageId ?? '');
                } else if (result.status === 'invalid_token') {
                    dead.push(device.deviceId);
                    try {
                        await opts.devices.invalidateDeviceToken(device.token);
                    } catch (err) {
                        ctx.logger.warn(
                            `[push] device '${device.deviceId}' of '${delivery.recipient}' was reported dead (${result.reason}) `
                            + `but could not be retired: ${(err as Error).message}`,
                        );
                    }
                } else {
                    failures.push({ error: result.error, retryable: result.retryable });
                }
            }

            if (sent.length > 0) {
                if (failures.length > 0) {
                    ctx.logger.warn(
                        `[push] '${delivery.recipient}': ${sent.length} device(s) pushed, ${failures.length} failed `
                        + `(${failures.map((f) => f.error).join('; ')}); not retried, so the pushed devices are not pushed twice`,
                    );
                }
                const ids = sent.filter(Boolean);
                return { ok: true, externalId: ids.length > 0 ? ids.join(',') : undefined };
            }
            if (failures.length === 0) {
                return {
                    ok: false,
                    error: `${ALL_TOKENS_DEAD}: every push device of '${delivery.recipient}' was reported dead `
                        + `and retired (${dead.join(', ')})`,
                };
            }
            const detail = failures.map((f) => f.error).join('; ');
            return failures.some((f) => f.retryable)
                ? { ok: false, error: `push send failed: ${detail}` }
                : { ok: false, error: `${PUSH_REFUSED}: ${detail}` };
        },

        classifyError(err: unknown): ErrorClass {
            return classify(err instanceof Error ? err.message : String(err ?? ''));
        },
    };
}

function classify(text: string): ErrorClass {
    if (text.startsWith(`${TRANSPORT_NOT_CONFIGURED}:`)) return 'permanent';
    if (text.startsWith(`${NO_PUSH_DEVICE}:`) || text.startsWith(`${ALL_TOKENS_DEAD}:`)) return 'invalid_recipient';
    if (text.startsWith(`${PUSH_REFUSED}:`)) return 'permanent';
    return 'retryable';
}

/**
 * The delivery data (`PushDeliveryDataSchema`): the notification id, plus
 * `route` when the `actionUrl` is a same-server path `PushRouteSchema` admits.
 */
export function deliveryData(notificationId: string | undefined, actionUrl: string | undefined): Record<string, string> {
    const data: Record<string, string> = {};
    if (notificationId) data.notificationId = notificationId;
    if (actionUrl && Buffer.byteLength(actionUrl, 'utf8') <= ROUTE_MAX_BYTES && PushRouteSchema.safeParse(actionUrl).success) {
        data.route = actionUrl;
    }
    return data;
}

/**
 * The device's `origin` added to the delivery data (`PushDeliveryDataSchema.origin`),
 * when the row holds one the schema admits: the server the Console registered
 * from, so a shell with several saved servers opens the tap on this one. A row
 * without one, or with one the schema refuses, sends the data as is.
 */
export function withOrigin(data: Record<string, string>, origin: string | undefined): Record<string, string> {
    if (!origin || !PushDeliveryDataSchema.shape.origin.safeParse(origin).success) return data;
    return { ...data, origin };
}

/** Collapse whitespace runs: a push shows one plain line of text per member. */
function plain(text: string | undefined): string {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Cut `text` to at most `maxBytes` UTF-8 bytes on a character boundary, marking the cut with an ellipsis. */
export function truncateUtf8(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
    const ellipsis = '…';
    const budget = maxBytes - Buffer.byteLength(ellipsis, 'utf8');
    let out = '';
    let used = 0;
    for (const ch of text) {
        const size = Buffer.byteLength(ch, 'utf8');
        if (used + size > budget) break;
        out += ch;
        used += size;
    }
    return out + ellipsis;
}
