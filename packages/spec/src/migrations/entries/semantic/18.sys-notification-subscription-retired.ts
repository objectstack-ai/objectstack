// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0030 L3 (amended) — a platform-object RETIREMENT, not a spec-key
// retirement: no authorable spec key moves, so nothing lands in
// RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair with (the
// scim-provider-object-retired and sys-view-definition-retired shape). The
// reader census behind the verdict is cited in the reason.
export const entry: SemanticMigration = {
  id: 'sys-notification-subscription-retired',
  surface:
    'the sys_notification_subscription platform object (NotificationSubscription, exported by '
    + '@objectstack/service-messaging and its objects barrel), its registration and boot '
    + 'provisioning by MessagingServicePlugin, the Setup navigation item Notification '
    + 'Subscriptions (nav_notification_subscriptions) the plugin contributed to the Configuration '
    + 'group, its generated object translations, and its name in PLATFORM_OBJECTS_BY_PACKAGE '
    + '(@objectstack/spec system constants)',
  replacement:
    'nothing replaces it — the recipients of a notification are the explicit audience its '
    + 'producer passes to `emit()` (`EmitInput.audience` is required): a flow notification '
    + 'node\'s recipients, an approval\'s approvers, a mention\'s mentioned users. Per-user '
    + 'muting stays on `sys_notification_preference`, which is unchanged. Delete any import of '
    + '`NotificationSubscription`. A stack that names `sys_notification_subscription` (a lookup '
    + 'target, a flow trigger, a permission entry, a navigation item) removes the reference: the '
    + 'name no longer resolves to a platform object',
  reason:
    'ADR-0030 described a topic subscription as Layer-3 audience expansion, and that expansion '
    + 'was never wired: no audience member asks for subscribers, every producer names its '
    + 'recipients explicitly, and no recipient-resolver branch reads a topic\'s subscriptions. '
    + 'Census at commit e4d604efd3 of this repository\'s main branch, glob pathspec over '
    + 'packages/**/src without tests and generated bundles: 6 files name the object (its own '
    + 'declaration, the plugin\'s registration and nav item, a translation-bundle comment, the '
    + 'platform-object registry, a doc comment in the object schema and the CLI ownership '
    + 'inventory), none of them a reader of its rows; the control word '
    + 'sys_notification_preference names 8 files there, two of them its readers (the preference '
    + 'resolver and the fan-out system context). The Studio repository at the pinned console '
    + 'commit cf153eb2e5 names it 0 times (2 files for the control word). So the Setup grid '
    + 'let an administrator author rows that never made anyone receive anything — declared and '
    + 'not delivered. The maintainer ruled to retire it rather than build the expansion, which '
    + 'would also need a who-may-subscribe-whom permission model nothing asked for; that ruling '
    + 'supersedes the earlier decision to keep the object with a code comment saying it was not '
    + 'wired, a comment no administrator could see.',
  acceptanceCriteria:
    'No code imports NotificationSubscription from @objectstack/service-messaging (TS2305 after '
    + 'upgrade). isPlatformProvidedObjectName answers false for sys_notification_subscription, '
    + 'so a stack referencing the name is flagged as a probable typo rather than resolved. '
    + 'MessagingServicePlugin neither registers nor provisions the object, and the Setup app\'s '
    + 'Configuration group offers Notification Preferences and Notification Templates but no '
    + 'Notification Subscriptions item. Existing databases: the table is left in place '
    + 'untouched, by ruling — no backfill, no reaper, no migrate command. Schema sync is '
    + 'additive and never drops a table, so a database an earlier release provisioned keeps '
    + 'sys_notification_subscription and any rows an administrator wrote, and nothing reads '
    + 'them; os migrate organization-ownership keeps an inventory row for the table (fate 4: '
    + 'its rows listed, never attributed), so a database still holding it plans instead of '
    + 'being refused as carrying an uninventoried platform table. Export any row worth keeping; '
    + 'dropping the table is the operator\'s call, by hand.',
};
