// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
    PushRelayErrorResponseSchema,
    PushRelayRequestSchema,
    PushRelayResponseSchema,
    type PushRelayPayload,
    type PushRelayRequest,
} from '@objectstack/spec/api';
import type { ICloudBindingService } from '@objectstack/spec/contracts';
import type { PushRelayTransportConfigParsed, PushVendor } from '@objectstack/spec/system';
import type { IPushTransport, PushMessage, PushSendResult } from '../push-service.js';

/**
 * The path the hosted push relay is served at, under the control-plane base
 * URL (`ICloudBindingService.controlPlaneUrl()`). The relay is served by the
 * cloud's control plane (objectstack-ai/cloud#3519, ruling 7B), at
 * `POST /api/v1/cloud/push/send`, behind the same runtime-credential gate as
 * the cloud's other runtime routes. The maintainer's ruling on #29920 (Q3 A)
 * puts the constant here and not in `packages/spec`: ADR-0012 §6.1 keeps the
 * production relay address out of the spec.
 */
export const PUSH_RELAY_PATH = '/api/v1/cloud/push/send';

/** The kernel service the binding credential is read from (`ICloudBindingService`, `@objectstack/cloud-connection`). */
export const CLOUD_BINDING_SERVICE = 'cloud-binding';

/**
 * The visible line a relay delivery shows when the caller names none: the
 * English one. The `push` channel picks the line in the recipient's language
 * (`PushMessage.notice`); this is the floor for any other caller.
 */
export const DEFAULT_PUSH_NOTICE = 'You have a new notification';

/** The error-text prefixes a relay send answers with, so a log or a test reads the cause, not the prose. */
export const RELAY_NOT_BOUND = 'relay_not_bound';
export const RELAY_ADDRESS_NOT_PUBLISHED = 'relay_address_not_published';
export const RELAY_BINDING_REFUSED = 'relay_binding_refused';

export interface RelayPushSenderOptions {
    /** The parsed relay block of `PushServiceConfigSchema`. */
    config: PushRelayTransportConfigParsed;
    /**
     * The binding service, resolved on every call: `undefined` when no
     * `cloud-binding` service is registered, which reads as "not bound".
     */
    binding: () => ICloudBindingService | undefined;
    /** Per-request timeout. Default 10 s. */
    timeoutMs?: number;
    /** `fetch`, injectable for a test. */
    fetch?: typeof fetch;
}

/**
 * The hosted push relay sender (ADR-0012 §6.1, cloud#3519): one
 * `PushRelayRequestSchema` POST per push, with one delivery for the push's
 * device token, authenticated by this server's cloud binding credential.
 *
 * **The credential.** Read from the `cloud-binding` service on every send,
 * never held, so a bind done while the server runs takes effect at once. It
 * goes into the `Authorization` header and nowhere else: no log line and no
 * error text this sender writes carries it.
 *
 * **ID-only.** The delivery's payload is the push delivery data
 * (`PushMessage.data`) and one generic visible line (`PushMessage.notice`);
 * the notification's title and body never leave the server. The request is
 * parsed with `PushRelayRequestSchema` before it is sent, so a content key in
 * the data is refused here rather than carried.
 *
 * **Answers.** A 200 answers each delivery: `ok` is sent, `invalid` is a dead
 * token (the channel retires the device row), `retry` is a retryable failure.
 * A 401 refuses the whole request: not retryable, naming the lapsed binding.
 * A 429 is retryable when the relay says so (`retryable`, pinned `true` on
 * `RATE_LIMIT_EXCEEDED`); a 5xx is retryable; any other refusal is not.
 */
export class RelayPushSender {
    private readonly timeoutMs: number;
    private readonly fetch: typeof fetch;

    constructor(private readonly opts: RelayPushSenderOptions) {
        this.timeoutMs = opts.timeoutMs ?? 10_000;
        this.fetch = opts.fetch ?? fetch;
    }

    /** Whether the server is bound to the cloud right now. Read on every call. */
    bound(): boolean {
        return this.credential() !== '';
    }

    /** The relay URL: the configured `endpoint`, else the control plane's relay path; `''` when neither is known. */
    endpoint(): string {
        if (this.opts.config.endpoint) return this.opts.config.endpoint;
        const base = (this.binding()?.controlPlaneUrl() ?? '').replace(/\/+$/, '');
        return base ? `${base}${PUSH_RELAY_PATH}` : '';
    }

    async send(message: PushMessage): Promise<PushSendResult> {
        const credential = this.credential();
        if (!credential) {
            return {
                status: 'failed',
                error: `${RELAY_NOT_BOUND}: the server is not bound to cloud, so the hosted push relay cannot be reached; `
                    + 'bind it on the Cloud connection setup page',
                retryable: false,
            };
        }
        const url = this.endpoint();
        if (!url) {
            return {
                status: 'failed',
                error: `${RELAY_ADDRESS_NOT_PUBLISHED}: the push relay address is not published for this deployment `
                    + '(no control-plane URL); write the relay block\'s endpoint',
                retryable: false,
            };
        }

        const request: PushRelayRequest = {
            deliveries: [{
                token: message.token,
                vendor: message.vendor,
                payload: { data: { ...message.data } as PushRelayPayload['data'], text: message.notice?.trim() || DEFAULT_PUSH_NOTICE },
                priority: 'high',
            }],
        };
        const parsed = PushRelayRequestSchema.safeParse(request);
        if (!parsed.success) {
            const where = parsed.error.issues
                .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
                .join('; ');
            return { status: 'failed', error: `relay_payload_refused: ${where}`, retryable: false };
        }

        const res = await this.fetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
            body: JSON.stringify(parsed.data),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();

        if (res.status === 200) {
            const answer = PushRelayResponseSchema.safeParse(readJson(text));
            const result = answer.success
                ? answer.data.results.find((r) => r.token === message.token) ?? answer.data.results[0]
                : undefined;
            if (!result) {
                return { status: 'failed', error: 'relay_answer_unreadable: the push relay answered 200 with no result for the delivery', retryable: false };
            }
            if (result.status === 'ok') return { status: 'sent' };
            if (result.status === 'invalid') return { status: 'invalid_token', reason: 'relay: invalid' };
            return { status: 'failed', error: 'relay_retry: the push relay reported a transient vendor failure', retryable: true };
        }

        const refusal = PushRelayErrorResponseSchema.safeParse(readJson(text));
        const error = refusal.success ? refusal.data.error : undefined;
        if (res.status === 401) {
            const reason = error?.code === 'UNAUTHENTICATED' ? ` (${error.details.reason})` : '';
            return {
                status: 'failed',
                error: `${RELAY_BINDING_REFUSED}: the push relay refused this server's cloud binding${reason}; `
                    + 'the binding has lapsed, bind the server to the cloud again',
                retryable: false,
            };
        }
        if (res.status === 429) {
            const code = error?.code ?? 'HTTP 429';
            return {
                status: 'failed',
                error: `the push relay answered 429 ${code}`,
                retryable: error ? error.retryable : true,
            };
        }
        return {
            status: 'failed',
            error: `the push relay answered HTTP ${res.status}`,
            retryable: res.status >= 500,
        };
    }

    private binding(): ICloudBindingService | undefined {
        try {
            return this.opts.binding();
        } catch {
            return undefined;
        }
    }

    private credential(): string {
        try {
            return this.binding()?.credential() ?? '';
        } catch {
            return '';
        }
    }
}

/**
 * One vendor's transport over the shared relay sender: the push service
 * keeps one transport per vendor, and the relay delivers to both. Available
 * only while the server is bound, so the push channel reports the deployment
 * unable to push (`transport_not_configured`) until the bind is done.
 */
export function relayTransport(vendor: PushVendor, sender: RelayPushSender): IPushTransport {
    return {
        vendor,
        available: () => sender.bound(),
        send: (message) => sender.send(message),
    };
}

function readJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
