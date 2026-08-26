// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time only config for `os i18n extract` (ADR-0029 D8). Not deployed.
 * The plugin owns the i18n extraction for the objects it owns; the
 * `translations` baseline is this plugin's OWN generated bundles so re-running
 * `--merge` preserves every hand-translated string. (Initial zh-CN/ja-JP/es-ES
 * strings were seeded from @objectstack/platform-objects.)
 *
 *   os i18n extract packages/services/service-realtime/scripts/i18n-extract.config.ts \
 *     --locales=zh-CN,ja-JP,es-ES --fill=default --objects-only --no-metadata-forms \
 *     --out=packages/services/service-realtime/src/translations
 *
 * ## Provenance: LEGACY-TRUSTED BY CHOICE, and here is the measurement
 *
 * #12559 rolled the generated-leaf provenance companion (maintainer ruling
 * #12069 Option A, #11671) out to every other bundle set. This one is the
 * measured exception, declared here rather than left silent — a set that is
 * simply missing from a rollout reads as covered to anyone who does not go
 * counting configs, which is the hazard #12559 was filed about.
 *
 * Measured on this set at rollout time: 23 generated leaves per locale, and
 * **0** of them — in any of zh-CN, ja-JP, es-ES — is a byte copy of the current
 * `en` source. The companion records a leaf only while it IS such a copy, so
 * opting in here would emit three `<locale>.source-hashes.generated.ts` files
 * containing zero entries. That is not coverage: all 23 leaves would stay
 * legacy-trusted exactly as they are today, while three committed files
 * announced an instrument that measures nothing. `sys_presence` is a single
 * fully-translated object; there is no filled leaf here to record.
 *
 * **Revisit when that stops being true.** The declaration above is a claim
 * about the tree, not a preference, and `presence-bundle-provenance.test.ts`
 * next to the bundles keeps it honest: it fails the moment any locale's leaf
 * becomes a byte copy of `en` — i.e. the moment this set gains a leaf the
 * companion could record — and sends the reader back to this paragraph.
 *
 * ⛔ Do not name the opt-in flag with its leading dashes anywhere in THIS
 * docstring, not even in prose arguing against it: `flagsFromDocstring`
 * (scripts/i18n-bundle-surface.mjs) harvests every recognised flag spelling out
 * of this comment and hands the result to the extractor, so a mention would
 * silently convert this declaration into the opt-in it declares against. The
 * flag is `source-hashes`; the files it would write are named above.
 */

import { defineStack, type ObjectStackDefinition } from '@objectstack/spec';
import { SysPresence } from '../src/objects/sys-presence.object.js';
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
  objects: [SysPresence] as any,
  translations: [
    { en: { objects: enObjects } },
    { 'zh-CN': { objects: zhCNObjects } },
    { 'ja-JP': { objects: jaJPObjects } },
    { 'es-ES': { objects: esESObjects } },
  ],
});

export default config;
