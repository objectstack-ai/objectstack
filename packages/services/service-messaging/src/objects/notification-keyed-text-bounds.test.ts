// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12978] The VALUE half of the keyed-text-bounds contract for this package's
// five `sys_notification_*` objects (#11374 route A). The class-level gate
// (`scripts/check-keyed-text-bounds.mjs`, #12147) asks whether a bound EXISTS;
// it cannot ask whether the bound is the RIGHT one, because "right" here is a
// RELATION to another declaration -- exactly what a later edit breaks without
// noticing. Same division of labour the plugin-audit pin states for its
// ActivityPointer columns, extended to the relations these five objects carry.
//
// Every expectation below that can be read off a sibling declaration IS read
// off it rather than restated, so an edit to the producer moves the
// expectation and leaves the stale STORED bound red -- never silently green.
import { describe, it, expect } from 'vitest';

import { SysEmailTemplate, SysNotification } from '@objectstack/platform-objects';

import { NotificationDelivery } from './notification-delivery.object.js';
import { NotificationPreference } from './notification-preference.object.js';
import { NotificationReceipt } from './notification-receipt.object.js';
import { NotificationSubscription } from './notification-subscription.object.js';
import { NotificationTemplate } from './notification-template.object.js';

/**
 * 255 is the width of the physical `id` column `driver-sql` creates
 * (`table.string('id').primary()` -- knex's varchar(255), spelled
 * `DEFAULT_STRING_VARCHAR_CHARS`), so a column holding a record id is bounded
 * by transitivity from the id itself. Pinned by VALUE for the same reason the
 * plugin-audit pin gives: a later "tidy" to a narrower sibling convention
 * would silently refuse ids the id column itself accepts, and would sail
 * through the existence gate.
 */
const PHYSICAL_ID_WIDTH = 255;

const bound = (obj: { fields: Record<string, { maxLength?: unknown }> }, field: string): unknown =>
  obj.fields[field]?.maxLength;

describe('sys_notification_* keyed-text bounds carry their producers’ widths (#12978, #11374 route A)', () => {
  it('id-family columns carry the referenced physical id width, not just any bound', () => {
    expect(bound(NotificationDelivery, 'notification_id')).toBe(PHYSICAL_ID_WIDTH);
    expect(bound(NotificationDelivery, 'recipient_id')).toBe(PHYSICAL_ID_WIDTH);
    expect(bound(NotificationReceipt, 'notification_id')).toBe(PHYSICAL_ID_WIDTH);
    expect(bound(NotificationReceipt, 'user_id')).toBe(PHYSICAL_ID_WIDTH);
    expect(bound(NotificationPreference, 'user_id')).toBe(PHYSICAL_ID_WIDTH);
  });

  it('topic columns equal sys_notification.topic’s own declared bound -- the event topic they are matched against', () => {
    const eventTopic = bound(SysNotification, 'topic');
    // Vacuity control: the producer itself must be a real declared bound.
    expect(typeof eventTopic).toBe('number');
    expect(bound(NotificationPreference, 'topic')).toBe(eventTopic);
    expect(bound(NotificationSubscription, 'topic')).toBe(eventTopic);
    expect(bound(NotificationTemplate, 'topic')).toBe(eventTopic);
  });

  it('channel columns agree with each other (one machine vocabulary, one width)', () => {
    const channel = bound(NotificationDelivery, 'channel');
    expect(typeof channel).toBe('number');
    expect(bound(NotificationPreference, 'channel')).toBe(channel);
    expect(bound(NotificationReceipt, 'channel')).toBe(channel);
    expect(bound(NotificationTemplate, 'channel')).toBe(channel);
  });

  it('digest_key equals its derivation from the sibling bounds: recipient + "|" + channel + "|" + window(10)', () => {
    const recipient = bound(NotificationDelivery, 'recipient_id') as number;
    const channel = bound(NotificationDelivery, 'channel') as number;
    // `digestDeferral` emits a local ISO date (`YYYY-MM-DD`) as the window
    // label for both cadences -- 10 chars.
    const WINDOW_LABEL_WIDTH = 10;
    expect(bound(NotificationDelivery, 'digest_key')).toBe(recipient + 1 + channel + 1 + WINDOW_LABEL_WIDTH);
  });

  it('template locale equals sys_email_template.locale’s declared bound -- the sibling BCP-47 declaration', () => {
    const emailLocale = bound(SysEmailTemplate, 'locale');
    expect(typeof emailLocale).toBe('number');
    expect(bound(NotificationTemplate, 'locale')).toBe(emailLocale);
  });

  it('principal covers the widest declared selector arm: owner_of:<object>:<id>', () => {
    // 'owner_of:' (9) + object API name (<= 255, storage-owned by
    // `sys_metadata.name`, #12144) + ':' (1) + record id (<= 255, the physical
    // id width above). #9807: every other arm is narrower (an email is <= 254;
    // 'user:' + id is 260).
    expect(bound(NotificationSubscription, 'principal')).toBe(9 + 255 + 1 + PHYSICAL_ID_WIDTH);
  });
});
