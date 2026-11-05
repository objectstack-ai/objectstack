// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PushVendor } from '@objectstack/spec/system';

/**
 * One push to one device, as the push channel hands it over.
 *
 * `data` is the push's delivery data (`PushDeliveryDataSchema`,
 * `@objectstack/spec/api`): the notification id and, when it is a same-server
 * path, its `route`. Every value is a string, because FCM's `message.data`
 * takes only strings. Each transport places it where its vendor reads it: FCM
 * in `message.data`, APNs at the top level of the payload beside `aps`.
 */
export interface PushMessage {
    /** The vendor the token belongs to: the device row's `vendor`. */
    readonly vendor: PushVendor;
    /** The vendor push token, as the device registered it. */
    readonly token: string;
    /** Plain-text title (the notification's title, in the recipient's language). */
    readonly title: string;
    /** Plain-text body. */
    readonly body: string;
    /** Delivery data for the shell: string values only. */
    readonly data: Readonly<Record<string, string>>;
}

/**
 * What one push attempt answered.
 *
 * - `sent`: the vendor accepted it (`messageId` is APNs' `apns-id` or FCM's
 *   message `name`).
 * - `invalid_token`: the vendor said the token is dead (APNs `BadDeviceToken`
 *   / `Unregistered`, FCM `UNREGISTERED`). The caller retires the device; the
 *   notification itself is not at fault.
 * - `failed`: anything else. `retryable` says whether the same push may
 *   succeed later (a timeout, a 429 or a 5xx) or never will as configured (a
 *   rejected credential, a refused payload, a vendor with no transport).
 */
export type PushSendResult =
    | { readonly status: 'sent'; readonly messageId?: string }
    | { readonly status: 'invalid_token'; readonly reason: string }
    | { readonly status: 'failed'; readonly error: string; readonly retryable: boolean };

/** A vendor transport: APNs or FCM. */
export interface IPushTransport {
    readonly vendor: PushVendor;
    send(message: PushMessage): Promise<PushSendResult>;
    /** Release held connections (the APNs HTTP/2 session). */
    close?(): Promise<void> | void;
}

/**
 * The push service the `push` channel delivers through, registered as the
 * kernel's `push` service by `PushServicePlugin`.
 *
 * It sends one push to one device and reports what the vendor answered. It
 * does not know users or devices: the channel (`push-channel.ts` in
 * `@objectstack/service-messaging`) reads the recipient's devices from the
 * device registry and retires a token this service reports `invalid_token`.
 */
export interface IPushService {
    /** The vendors this deployment has a transport for. Empty: push delivers nothing. */
    vendors(): PushVendor[];
    /** Send one push. Never throws: a transport error is answered `failed`. */
    send(message: PushMessage): Promise<PushSendResult>;
}

export interface PushServiceOptions {
    /** One transport per configured vendor. A vendor without one is not delivered to. */
    transports: Partial<Record<PushVendor, IPushTransport>>;
    logger?: { warn(msg: string): void };
}

/**
 * The last six characters of a token, for log lines. A push token addresses
 * one phone; logs never carry it whole.
 */
export function maskToken(token: string): string {
    const t = String(token ?? '');
    return t.length <= 6 ? '***' : `***${t.slice(-6)}`;
}

/** {@link IPushService} over one transport per vendor. */
export class PushService implements IPushService {
    constructor(private readonly opts: PushServiceOptions) {}

    vendors(): PushVendor[] {
        return (Object.keys(this.opts.transports) as PushVendor[]).filter((v) => this.opts.transports[v]);
    }

    async send(message: PushMessage): Promise<PushSendResult> {
        const transport = this.opts.transports[message.vendor];
        if (!transport) {
            return {
                status: 'failed',
                error: `vendor_not_configured: no ${message.vendor} transport is configured`,
                retryable: false,
            };
        }
        try {
            return await transport.send(message);
        } catch (err) {
            // A transport that throws (a dropped connection, a timeout) has
            // not been answered by the vendor, so the same push may succeed.
            const text = (err as Error)?.message ?? String(err);
            this.opts.logger?.warn(`[push] ${message.vendor} send to ${maskToken(message.token)} threw: ${text}`);
            return { status: 'failed', error: `${message.vendor} transport error: ${text}`, retryable: true };
        }
    }

    /** Close every transport's held connections. */
    async close(): Promise<void> {
        for (const transport of Object.values(this.opts.transports)) {
            await transport?.close?.();
        }
    }
}
