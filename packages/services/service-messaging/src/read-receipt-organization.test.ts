// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MessagingService, NOTIFICATION_EVENT_OBJECT } from './messaging-service.js';
import { RECEIPT_OBJECT } from './inbox-channel.js';

/**
 * [#11303] The SECOND `sys_notification_receipt` producer.
 *
 * Maintainer ruling, 2026-08-24, verbatim: 「11303
 * sys_inbox_message/sys_notification/sys_email 应该写 organization_id。」
 *
 * The inbox channel's `delivered` receipt already stamps the organization it
 * was handed. `markRead` writes the OTHER receipt — the `read` one, inserted
 * when a user reads a notification whose delivered-receipt never landed — and
 * that insert names no organization at all, so it lands org-less however well
 * the emit path was threaded. One table, two producers, and a per-producer
 * suite that only enumerated the first would have scored green with this one
 * still emitting nulls.
 *
 * ⭐ Threaded, never fabricated: the organization is read off the
 * `sys_notification` row the receipt is ABOUT — the subject record's own
 * organization, which is the platform's standing answer for a platform row
 * (#8287). When the notification itself carries none, the receipt carries none:
 * a null is visibly missing, a guess is silently authoritative.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/**
 * A data engine holding one `sys_notification` row and recording every insert.
 * `findOne` answers the notification row for the event object and `undefined`
 * for the receipt (so `markRead` takes the insert limb, not the flip limb).
 */
function engineWithNotification(notificationOrg: string | null) {
    const inserted: Array<{ object: string; row: Record<string, unknown> }> = [];
    const engine: any = {
        async insert(object: string, row: Record<string, unknown>) {
            inserted.push({ object, row: { ...row } });
            return { ...row, id: 'rec_1' };
        },
        async findOne(object: string, opts: any) {
            if (object === NOTIFICATION_EVENT_OBJECT) {
                return { id: 'evt_pin', organization_id: notificationOrg };
            }
            void opts;
            return undefined;
        },
        async find() { return []; },
    };
    return { engine, inserted };
}

describe('#11303 — the markRead receipt producer stamps organization_id', () => {
    it('PIN E: the `read` receipt carries the notification\'s own organization', async () => {
        const { engine, inserted } = engineWithNotification('org_pin_beta');
        const messaging = new MessagingService({ logger: silentLogger(), getData: () => engine });

        const result = await messaging.markRead('user_1', ['evt_pin']);
        expect(result).toMatchObject({ success: true, readCount: 1 });

        const receipts = inserted.filter((i) => i.object === RECEIPT_OBJECT);
        expect(receipts).toHaveLength(1);
        // Identity, not presence: the receipt must carry the SAME organization
        // the notification does, not merely some organization.
        expect(receipts[0].row.organization_id).toBe('org_pin_beta');
    });

    it('PIN E2 (over-denial control): an org-less notification still yields a receipt', async () => {
        // The single-tenant / no-organization deployment. Nothing is refused and
        // nothing is invented — the receipt simply carries the same null its
        // notification does.
        const { engine, inserted } = engineWithNotification(null);
        const messaging = new MessagingService({ logger: silentLogger(), getData: () => engine });

        const result = await messaging.markRead('user_1', ['evt_pin']);
        expect(result).toMatchObject({ success: true, readCount: 1 });

        const receipts = inserted.filter((i) => i.object === RECEIPT_OBJECT);
        expect(receipts).toHaveLength(1);
        expect(receipts[0].row.organization_id ?? null).toBeNull();
    });
});
