// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time only config for `os i18n extract` (ADR-0029 D8). Not deployed.
 * The plugin owns the i18n extraction for the objects it owns; the
 * `translations` baseline is this plugin's OWN generated bundles so re-running
 * `--merge` preserves every hand-translated string. (Initial zh-CN/ja-JP/es-ES
 * strings were seeded from @objectstack/platform-objects.)
 *
 *   os i18n extract packages/plugins/plugin-audit/scripts/i18n-extract.config.ts \
 *     --locales=zh-CN,ja-JP,es-ES --fill=default --objects-only --no-metadata-forms \
 *     --source-hashes \
 *     --out=packages/plugins/plugin-audit/src/translations
 *
 * The `source-hashes` flag on the command above also emits
 * `<locale>.source-hashes.generated.ts` — the provenance companion from
 * maintainer ruling #12069 Option A (#11671), rolled out to every bundle set by
 * #12559. Without it every generated leaf here is LEGACY-TRUSTED: a leaf filled
 * from the source and then left behind when the source was revised is
 * indistinguishable BY VALUE from a real translation, so it publishes a
 * superseded draft under a green `check:i18n` forever, and
 * `check:i18n-stale-fill` cannot see it either unless two locales happen to
 * hold the same stale bytes.
 *
 * A record is written only for a leaf that IS currently a byte copy of the
 * CURRENT source, so the companion arrives 0-stale by construction and only
 * ever reports drift accruing afterwards. Records count the leaves currently
 * RECORDABLE, never the leaves covered — a table with few entries, or with none
 * at all where a locale is fully translated, is the instrument armed, and an
 * entry appears by itself on the first extract after a leaf becomes a fill.
 *
 * The flag is named in prose WITHOUT its leading dashes on purpose:
 * `flagsFromDocstring` (scripts/i18n-bundle-surface.mjs) harvests every
 * recognised flag spelling out of this whole comment, so a second spelling
 * would keep the opt-in switched on after someone deleted it from the command
 * block — the one place that decides.
 */

import { defineStack, type ObjectStackDefinition } from '@objectstack/spec';
import { SysAuditLog } from '../src/objects/sys-audit-log.object.js';
import { SysActivity } from '../src/objects/sys-activity.object.js';
import { SysComment } from '../src/objects/sys-comment.object.js';
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
  objects: [SysAuditLog, SysActivity, SysComment] as any,
  translations: [
    { en: { objects: enObjects } },
    { 'zh-CN': { objects: zhCNObjects } },
    { 'ja-JP': { objects: jaJPObjects } },
    { 'es-ES': { objects: esESObjects } },
  ],
});

export default config;
