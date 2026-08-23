// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time only config for `os i18n extract` (ADR-0029 D8). Not deployed.
 * The service owns the i18n extraction for the objects it owns; the
 * `translations` baseline is this service's OWN generated bundles so re-running
 * `--merge` preserves every hand-translated string.
 *
 *   os i18n extract packages/services/service-messaging/scripts/i18n-extract.config.ts \
 *     --locales=zh-CN,ja-JP,es-ES --fill=default --objects-only --no-metadata-forms \
 *     --out=packages/services/service-messaging/src/translations
 */

import { defineStack, type ObjectStackDefinition } from '@objectstack/spec';
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

/**
 * The annotation is load-bearing, not decoration (#10868). `defineStack`
 * already RETURNS `ObjectStackDefinition`, but that type is
 * `z.input<typeof ObjectStackDefinitionSchema>` — a generic instantiation the
 * declaration emitter does not preserve as an alias, so an un-annotated
 * `export default` is emitted as the STRUCTURAL expansion instead. That
 * expansion mentions `FormFieldInput` / `NavigationItemInput` /
 * `StateNodeConfig`, which the root `@objectstack/spec` entry does not
 * re-export, so tsc falls back to naming them through the file that physically
 * declares them — a hash-named internal dist chunk it cannot address through
 * the package's `exports` map (TS2883, "likely not portable"). Naming the
 * public root-entry type here is what the diagnostic asks for and costs no
 * precision: the annotated type is the function's own return type.
 */
const config: ObjectStackDefinition = defineStack({
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

export default config;
