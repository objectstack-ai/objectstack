---
'@objectstack/service-messaging': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/platform-objects': patch
---

feat(service-messaging,spec,cli)!: `sys_notification_subscription` retires — no reader ever expanded a subscription into recipients (ADR-0030 L3, amended)

Clause-②: yes (narrowing)

<!-- adr-0087: registered sys-notification-subscription-retired -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes. It goes into 18.x because its ADR-0087 semantic entry, `sys-notification-subscription-retired`, carries the narrowing.

ADR-0030 described `sys_notification_subscription` as Layer-3 audience expansion: "who is subscribed to a topic". That expansion was never wired. Every producer names its recipients explicitly (`EmitInput.audience` is required: a flow notification node's recipients, an approval's approvers, a mention's users), no audience member asks for subscribers, and nothing reads the table's rows. So an administrator could author subscriptions in Setup that made nobody receive anything. The maintainer ruled to retire the object rather than build the expansion. The ruling supersedes the earlier decision to keep it with a code comment saying it was not wired, and ADR-0030 is amended to match.

**What moves for consumers, FROM → TO.**

- **The object.** FROM `import { NotificationSubscription } from '@objectstack/service-messaging'` TO nothing: delete the import. `MessagingServicePlugin` neither registers nor provisions the object any more, so the generic data door no longer serves it.
- **Setup navigation.** FROM a Notification Subscriptions item (`nav_notification_subscriptions`) in the Setup app's Configuration group TO no item. Notification Preferences and Notification Templates stay. The item's labels leave the platform app translations, and the object's keys leave service-messaging's generated object bundles.
- **The name.** `PLATFORM_OBJECTS_BY_PACKAGE['service-messaging']` (`@objectstack/spec/system`) lists six objects, and `isPlatformProvidedObjectName` answers `false` for `sys_notification_subscription`. A stack that names it (a lookup target, a flow trigger, a permission entry, a navigation item) is now flagged as naming an unknown object. Fix: remove the reference. To control who gets a notification, name the audience on the producer. To mute a topic for a user, write a `sys_notification_preference` row, which is unchanged.
- **`os migrate organization-ownership` (`@objectstack/cli`).** The inventory row for `sys_notification_subscription` moves FROM fate 3 (`attribution`: organization-less rows went to the Default Organization under `single`) TO fate 4 (`report`: rows listed by id, never attributed, never deleted). The table is exempt from NOT NULL, because no declaration anchors tenancy on its column any more. The row stays, so a database that still holds the table plans instead of being refused as carrying an uninventoried platform table. The plan's `inventoryDigest` changes: a plan file written by an earlier CLI no longer matches, and `--apply --plan-file` refuses it with `plan-digest-mismatch`. Re-run `os migrate organization-ownership --out PLAN`, review it, and apply that.

**Existing databases.** The table is left in place untouched: no backfill, no reaper, no migrate command. Schema sync is additive and never drops a table, so a database an earlier release provisioned keeps `sys_notification_subscription` and any rows an administrator wrote, and nothing reads them. Export any row worth keeping. Dropping the table is the operator's call, by hand: `DROP TABLE sys_notification_subscription`.
