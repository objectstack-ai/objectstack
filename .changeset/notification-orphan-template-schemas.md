---
"@objectstack/spec": major
---

feat(spec)!: `@objectstack/spec/system` no longer exports the orphan notification-template vocabulary — `EmailTemplate(Schema)`, `SMSTemplate(Schema)`, `PushNotification(Schema)`, `InAppNotification(Schema)` (#4616)

These four schemas existed **only** as the member shapes of the
`NotificationConfigSchema.template` union, and #4610 (#4535 C3) deleted that
union. Since then they have been reachable from no parent schema and from no
metadata-type root: nothing in framework, cloud or objectui parsed a document
against them, so they declared delivery capability the runtime never read
(ADR-0049 enforce-or-remove, resolved by REMOVE in the v17 breaking window).

Migration — one line each, and in every case the replacement already exists:

- FROM `import { EmailTemplateSchema, type EmailTemplate } from '@objectstack/spec/system'` →
  TO `import { EmailTemplateDefinitionSchema, type EmailTemplateDefinition } from '@objectstack/spec/system'`.
  **Shape change** — this is a different, richer contract, not a rename:
  `EmailTemplateDefinitionSchema` is keyed `name` + `locale` (not `id`), splits
  the body into `bodyHtml` / `bodyText` (not `body` + `bodyType`), and adds
  `label` / `category` / `active` / `fromOverride` / `replyTo`. It is also a
  `strictObject`, so the old keys are rejected loudly rather than stripped.
  This is the schema the `email_template` metadata kind has resolved to since
  spec **7.1.0**, which demoted `EmailTemplateSchema` when it fixed that Prime
  Directive #8 double-declaration and kept it "only as an inline sub-shape
  inside `Notification`" — #4610 removed that holder, and #4616 finishes the
  job. If your code registers a client-side or publish-time validator for
  `email_template`, it must point at `EmailTemplateDefinitionSchema`;
  `BUILTIN_METADATA_TYPE_SCHEMAS` (`kernel/metadata-type-schemas.ts`) is the
  authority.
- FROM `import { SMSTemplateSchema, type SMSTemplate } from '@objectstack/spec/system'` →
  TO: no spec replacement, and none is needed. SMS templates are
  `sys_notification_template` rows resolved by `(topic, 'sms', locale)`
  (`service-messaging/src/sms-channel.ts`) and rendered by
  `template-renderer.ts`; the provider-side template is Aliyun's pre-registered
  `TemplateCode` in `service-sms` — a vendor API shape, never a spec constant.
- FROM `import { PushNotificationSchema, type PushNotification } from '@objectstack/spec/system'`
  and FROM `import { InAppNotificationSchema, type InAppNotification } from '@objectstack/spec/system'` →
  TO: no replacement. Neither channel has a delivery implementation (#3197):
  the dispatcher dead-letters any message addressed to them, so these payload
  shapes advertised a capability nothing delivers. The live delivery ingress is
  `NotificationService.emit` (`INotificationService`,
  `@objectstack/spec/contracts`); the in-app bell reads `./api`'s
  `Notification(Schema)` inbox row; the presentation vocabulary is
  `@objectstack/spec/ui` (`NotificationTypeSchema`, `NotificationSeveritySchema`,
  `NotificationPositionSchema`, `NotificationActionSchema` — all unchanged).

Unchanged and explicitly NOT part of this removal:
`@objectstack/spec/system`'s `NotificationChannel(Schema)` (live — re-exported
by `@objectstack/spec/contracts`, consumed by `service-messaging`),
`EmailTemplateDefinition*`, and every `@objectstack/spec/ui` notification
export.

No ADR-0087 D2 conversion accompanies this change, deliberately: a conversion
rewrites authored or stored sources, and these defs were reachable from no
metadata-type root, so `os migrate meta` would have nothing to match. The
removal is a TypeScript export-surface break only — same disposition as #4610
in this very module. `json-schema.manifest.json` loses 4 keys and
`authorable-surface.json` loses their 22 lines; both deletions are adjudicated
by `gen:schema`'s #4650 route-3 check ("def no longer emitted by this build").
