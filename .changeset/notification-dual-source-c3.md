---
"@objectstack/spec": major
---

feat(spec)!: the notification vocabulary has one owner per name — `@objectstack/spec/ui` no longer exports `Notification(Schema)` / `NotificationConfig(Schema)`, and `@objectstack/spec/system` no longer exports `NotificationConfig(Schema)` (#4610)

The names `Notification` / `NotificationSchema` (`./api` vs `./ui`) and
`NotificationConfig` / `NotificationConfigSchema` (`./system` vs `./ui`)
each resolved to **two different declarations** depending on the import
path — the #4411 dual-source trap. Resolution (three-repo,
import-statement-level consumer scan: framework, cloud, objectui):

- **Removed** `NotificationSchema` / `Notification` from
  `@objectstack/spec/ui`. This was a toast/banner "notification instance"
  shape (`type`/`severity`/`message`/`duration`/`actions`/`position` + ARIA
  props) with **zero importers** in all three repos — objectui's toaster
  never adopted it. The live contract is `./api`'s `Notification(Schema)`:
  the REST inbox row (`id`/`type`/`title`/`body`/`read`/`data`/`actionUrl`/
  `createdAt`) embedded in `ListNotificationsResponseSchema`, served by
  `/api/v1/notifications`, implemented by `@objectstack/client`, and
  mirrored by `InboxNotification` in `@objectstack/spec/contracts`
  (ADR-0030: the bell reads this shape).
  - FROM `import { NotificationSchema, type Notification } from '@objectstack/spec/ui'` →
    TO `import { NotificationSchema, type Notification } from '@objectstack/spec/api'`.
    **Shape change**: the api row is an inbox record, not a presentation
    config — the ui shape's `severity` / `duration` / `dismissible` /
    `actions` / `position` / ARIA fields do not exist there. For the
    presentation vocabulary keep using the ui enums, which are unchanged:
    `NotificationTypeSchema`, `NotificationSeveritySchema`,
    `NotificationPositionSchema`, `NotificationActionSchema` (+ their
    types) still live in `@objectstack/spec/ui`.
- **Removed** `NotificationConfigSchema` / `NotificationConfig` from **both**
  `@objectstack/spec/system` and `@objectstack/spec/ui` — the bare name left
  the spec export surface entirely. Both declarations had zero importers in
  all three repos and were wired into no parent schema. The system side (a
  channel + template + recipients + schedule + retryPolicy + tracking
  "unified notification management protocol") predates ADR-0030's accepted
  delivery architecture and advertised capability the runtime does not
  deliver (its channel enum's `push`/`slack`/`teams`/`webhook` dead-letter,
  #3197; nothing reads `schedule`/`retryPolicy`/`tracking`). The ui side (a
  toaster global config: `defaultPosition`/`defaultDuration`/`maxVisible`/
  `stackDirection`/`pauseOnHover`) was never adopted by objectui.
  - FROM `import { NotificationConfigSchema } from '@objectstack/spec/system'` (or `.../ui`) →
    TO: no direct replacement. The live delivery vocabulary is
    `NotificationService.emit` (`INotificationService`,
    `@objectstack/spec/contracts`), the `notify` flow node
    (`NotifyConfigSchema`, `@objectstack/spec/automation`) and the
    `sys_notification*` platform objects; per-user delivery preferences are
    `NotificationPreferences(Schema)` in `@objectstack/spec/api`.
- `@objectstack/spec/api`'s `Notification(Schema)` and
  `NotificationPreferences(Schema)` are **unchanged**; `./api` is now the
  sole owner of the bare `Notification(Schema)` names. Imports from `./api`
  need no migration. `@objectstack/spec/system`'s `NotificationChannel(Schema)`,
  `EmailTemplate(Schema)`, `SMSTemplate(Schema)`, `PushNotification(Schema)`
  and `InAppNotification(Schema)` are **unchanged**.

`dual-source-exports.baseline.json` shrinks by exactly these 4 rows (28 → 24,
#4535 C3).
