---
"@objectstack/spec": major
---

feat(spec)!: the notification vocabulary has one owner per name — `@objectstack/spec/ui` no longer exports `Notification(Schema)` / `NotificationConfig(Schema)`, and `@objectstack/spec/system` no longer exports `NotificationConfig(Schema)` (#4610)

The names `Notification` / `NotificationSchema` (`./api` vs `./ui`) and
`NotificationConfig` / `NotificationConfigSchema` (`./system` vs `./ui`)
each resolved to **two different declarations** depending on the import
path — the #4411 dual-source trap. Resolution (three-repo,
import-statement-level consumer scan: framework, cloud, objectui):

> **Correction (#5781): the `./ui` declarations were NOT consumer-free — the
> removal stands, the evidence sentence does not.** The scan above matched
> `import … from` statement text, and objectui reached these two names by two
> hops it could not see: `packages/types/src/index.ts` re-exported both with
> `export … from '@objectstack/spec/ui'`, and
> `packages/core/src/protocols/NotificationProtocol.ts` consumed them via the
> `@object-ui/types` barrel in the public signatures of
> `resolveNotificationConfig` / `specNotificationToToast` (objectui#3310, at
> 17.0.0-rc.1). objectui does not ask for the retirement back: that bridge had
> zero in-repo callers, `@object-ui/react`'s locally-declared
> `NotificationSystemConfig` is what runs, and objectui deleted the bridge to
> follow this retirement. A cross-repo liveness verdict must be read off the
> resolved SYMBOL GRAPH — covering `export … from` re-exports and
> barrel-indirect consumption — never off import-statement text; this was the
> third miss of that class, after #4667 / #4709 (`app.homePageId`).

- **Removed** `NotificationSchema` / `Notification` from
  `@objectstack/spec/ui`. This was a toast/banner "notification instance"
  shape (`type`/`severity`/`message`/`duration`/`actions`/`position` + ARIA
  props) that objectui's toaster never adopted — its only holders were the
  re-export bridge named in the correction above, which objectui has since
  deleted. The live contract is `./api`'s `Notification(Schema)`:
  the REST inbox row (`id`/`type`/`title`/`body`/`read`/`data`/`actionUrl`/
  `createdAt`) embedded in `ListNotificationsResponseSchema`, served by
  `/api/v1/notifications`, implemented by `@objectstack/client`, and
  mirrored by `InboxNotification` in `@objectstack/spec/contracts`
  (ADR-0030: the bell reads this shape).
  - FROM `import { NotificationSchema, type Notification } from '@objectstack/spec/ui'` →
    TO: **no replacement.** Do NOT re-point this import at
    `@objectstack/spec/api` — that is the same name under a different
    contract, and following it does not compile. The api `Notification` is the
    REST inbox row (`id` / `type` / `title` / `body` / `read` / `data` /
    `actionUrl` / `createdAt`); the removed ui shape was a toast instance
    (`message` / `severity` / `position` / `duration` / `dismissible` /
    `actions` + ARIA). The two share zero fields, and aliasing one to the
    other would re-create the dual-source trap this change closed. For the
    presentation vocabulary keep using the ui enums, which are unchanged:
    `NotificationTypeSchema`, `NotificationSeveritySchema` and
    `NotificationPositionSchema` (+ their types) still live in
    `@objectstack/spec/ui`. Declare the instance shape locally, as objectui
    does. (`NotificationActionSchema` was listed here too at the time of this
    change; #5015 retired it in 17.0.0-rc.3, so three enums survive, not
    four.)
- **Removed** `NotificationConfigSchema` / `NotificationConfig` from **both**
  `@objectstack/spec/system` and `@objectstack/spec/ui` — the bare name left
  the spec export surface entirely. Neither declaration was wired into any
  parent schema; the `./system` one had no importers in any of the three
  repos, and the `./ui` one was held only by the objectui re-export bridge
  named in the correction above. The system side (a
  channel + template + recipients + schedule + retryPolicy + tracking
  "unified notification management protocol") predates ADR-0030's accepted
  delivery architecture and advertised capability the runtime does not
  deliver (its channel enum's `push`/`slack`/`teams`/`webhook` dead-letter,
  #3197; nothing reads `schedule`/`retryPolicy`/`tracking`). The ui side (a
  toaster global config: `defaultPosition`/`defaultDuration`/`maxVisible`/
  `stackDirection`/`pauseOnHover`) was never adopted by objectui's toaster,
  which reads its own `NotificationSystemConfig` instead.
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
