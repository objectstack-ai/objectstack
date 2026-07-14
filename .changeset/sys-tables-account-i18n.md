---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/platform-objects': patch
'@objectstack/service-messaging': minor
---

i18n: translate the system account/messaging surfaces end to end.

- **spec**: `ObjectTranslationDataSchema` / `ObjectTranslationNodeSchema` now
  accept `_views.<view>.emptyState.{title,message}` so list-view empty states
  are translatable (contract-first for the extractor below).
- **cli**: `os i18n extract` emits `_views.<view>.emptyState` keys when a view
  declares an empty state.
- **platform-objects**: fill every missing zh-CN/ja-JP/es-ES translation for
  `sys_user`, `sys_organization` and `sys_business_unit` (fields, options,
  views, actions); replace the hardcoded English tab/section/action labels in
  the `sys_user`, `sys_organization` and `sys_position` detail pages with
  inline i18n label objects, and route the user Security tab through
  `record:quick_actions` so object action labels localize.
- **service-messaging**: new ADR-0029 D8 translation bundle
  (`MessagingTranslations`) covering the seven `sys_*` messaging objects
  (inbox message, receipts, deliveries, preferences, subscriptions, templates,
  HTTP deliveries), registered on `kernel:ready`; zh-CN is fully translated
  and ja-JP/es-ES cover `sys_inbox_message` (incl. the `mine` view empty
  state).
