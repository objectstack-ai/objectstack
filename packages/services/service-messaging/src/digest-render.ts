// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { NotificationDeliveryRecord } from './outbox.js';
import type { NotificationTextItem } from './notification-text.js';
import { interpolate } from './template-renderer.js';
import { enMessages } from './translations/messages.js';

/**
 * One collapsed digest message assembled from a window's batched deliveries
 * (ADR-0030 P3b-2). `items` preserves the individual notifications so a
 * structured channel (inbox) can render a list, while `title`/`body` give a
 * flat rendering for plain channels (email text).
 */
export interface DigestRenderResult {
    title: string;
    body: string;
    severity: 'info';
    count: number;
    items: Array<{
        notificationId: string;
        title: string;
        body?: string;
        topic?: string;
        actionUrl?: string;
    }>;
}

/**
 * [#25015] The catalog key of the heading a digest of two or more items
 * carries: this service's own entry (`./translations/messages.ts`, loaded with
 * `MessagingTranslations`), rendered by the one keyed-text renderer
 * (`NotificationTextRenderer`, the `EmitInput.keyedText` path) in the digest's
 * recipient's language — `sys_user.locale`, then the deployment default
 * (#13881). ⛔ There is no second renderer for it.
 */
export const DIGEST_HEADING_KEY = 'messages.notificationDigestTitle';

/**
 * [#25015] The heading of a digest of `count` items (two or more), as the
 * keyed-text renderer takes it: {@link DIGEST_HEADING_KEY} with its
 * `{{count}}`, beside the literal a recipient reads whenever the key cannot be
 * rendered — the `en` entry interpolated, byte for byte the English sentence
 * every digest carried before its heading was keyed. A digest has no body
 * sentence to key; its body is the item list {@link renderDigest} builds.
 */
export function digestHeading(count: number): NotificationTextItem {
    const n = String(count);
    return {
        keys: { titleKey: DIGEST_HEADING_KEY, params: { count: n } },
        literal: { title: interpolate(enMessages.notificationDigestTitle, { count: n }), body: '' },
    };
}

/**
 * Collapse same-`(recipient, channel, window)` deliveries into a single message.
 * The caller guarantees `rows` is non-empty and shares a recipient + channel
 * (the digest group). Only non-`critical` notifications are ever batched, so the
 * digest severity is always `info`.
 *
 * `heading` is the title of a digest of two or more items as rendered for its
 * recipient — {@link digestHeading} through the keyed-text renderer, which the
 * dispatcher runs with the group's items in one locale read. Omitted, the
 * title is that heading's literal, which is also what the renderer delivers
 * when the key cannot render. A one-item digest is titled by its item, and
 * `heading` is not read.
 */
export function renderDigest(rows: NotificationDeliveryRecord[], heading?: string): DigestRenderResult {
    const items = rows.map((r) => {
        const p = r.payload ?? {};
        return {
            notificationId: r.notificationId,
            title: typeof p.title === 'string' && p.title ? p.title : (r.topic ?? 'Notification'),
            body: typeof p.body === 'string' && p.body ? p.body : undefined,
            topic: r.topic,
            actionUrl: typeof p.actionUrl === 'string' && p.actionUrl ? p.actionUrl : undefined,
        };
    });
    const count = items.length;
    const title = count === 1 ? items[0].title : (heading ?? digestHeading(count).literal.title);
    const body = items.map((it) => `• ${it.title}`).join('\n');
    return { title, body, severity: 'info', count, items };
}
