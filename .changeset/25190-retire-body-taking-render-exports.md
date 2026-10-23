---
'@objectstack/service-messaging': patch
---

fix(service-messaging)!: retire `renderNotification`, the render export that takes a notification template body with no save moment

The hole-placement rule for notification templates is judged where a template is saved: the `sys_notification_template` save hooks. `renderNotification` took a template body inline and rendered it at once, with no save moment, so the rule could not see it. It leaves the published entry of `@objectstack/service-messaging`. Nothing in this repository imported it from that entry. The renderer stays inside the package: the email and sms channels still render every stored template through it, unchanged.

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/service-messaging#renderNotification) One runtime function leaves a published package entry; no key of any metadata schema, no object definition and no stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. A TypeScript consumer meets the break at its own import, and the line below names the door to use instead. -->

**BREAKING** (a runtime export is removed). It ships as `patch` because the metadata protocol does not move. There is no staged window.

- FROM `renderNotification` TO a `sys_notification_template` row for the topic, channel and locale, which the delivering channel renders when the notification is emitted.

Unchanged: `interpolate` (the plain-text face, which the placement rule judges at no door), `NotificationTemplateStore`, `TEMPLATE_OBJECT`, `DEFAULT_LOCALE` and the template types; and how every stored template renders.
