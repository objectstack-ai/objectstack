// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time only config for `os i18n extract` (ADR-0029 D8). Not deployed.
 * The service owns the i18n extraction for the objects it owns; the
 * `translations` baseline is this service's OWN generated bundles so re-running
 * `--merge` preserves every hand-translated string.
 *
 *   os i18n extract packages/services/service-messaging/scripts/i18n-extract.config.ts \
 *     --locales=zh-CN,ja-JP,es-ES --fill=default --objects-only \
 *     --out=packages/services/service-messaging/src/translations
 */

import { defineStack } from '@objectstack/spec';
import {
  InboxMessage,
  NotificationReceipt,
  NotificationDelivery,
  NotificationPreference,
  NotificationSubscription,
  NotificationTemplate,
  HttpDelivery,
} from '../src/objects/index.js';
import { enObjects } from '../src/translations/en.objects.generated.js';
import { zhCNObjects } from '../src/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../src/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../src/translations/es-ES.objects.generated.js';

export default defineStack({
  name: 'service-messaging-i18n-extract',
  objects: [
    InboxMessage,
    NotificationReceipt,
    NotificationDelivery,
    NotificationPreference,
    NotificationSubscription,
    NotificationTemplate,
    HttpDelivery,
  ] as any,
  translations: [
    { en: { objects: enObjects } },
    { 'zh-CN': { objects: zhCNObjects } },
    { 'ja-JP': { objects: jaJPObjects } },
    { 'es-ES': { objects: esESObjects } },
  ],
});
