/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import type { AriaProps } from '@objectstack/spec/ui';

/**
 * Resolves the spec's NESTED `aria` bag to the DOM attributes it declares
 * (objectui#11051).
 *
 * The bag is `@objectstack/spec`'s `AriaPropsSchema`, the `aria` member a
 * block's own props schema carries (`element:text`, `element:button`,
 * `element:image` and `element:number` among them). It declares three keys,
 * and each maps to one attribute:
 *
 *   `ariaLabel`       → `aria-label`, resolved with the spec's own
 *                       `resolveI18nLabel` against `locale`: a plain string is
 *                       used as written, and an inline locale map
 *                       (`{ en: 'Order total', 'zh-CN': '订单合计' }`) gives the
 *                       entry for the viewer's language;
 *   `ariaDescribedBy` → `aria-describedby`;
 *   `role`            → `role`.
 *
 * A key that resolves to nothing, or to an empty string, is left out of the
 * result instead of being written as an empty or `undefined` attribute. A key
 * the bag does not declare is not read: the spec refuses such keys when the
 * document is parsed, so this function adds no alias for them.
 *
 * ## Two vocabularies, two readers (objectui#4580 Q2-B)
 *
 * This is NOT `SchemaRenderer`'s `resolveAriaProps`. That one reads the FLAT
 * node keys (`BaseSchema.ariaLabel` / `ariaDescribedBy` / `role`) and resolves
 * `ariaLabel` in objectui's KEYED vocabulary (`{ key, defaultValue?, params? }`,
 * via `resolveKeyedI18nLabel`). The nested bag uses the INLINE locale map.
 * Neither resolver accepts the other's shape: the keyed one returns `undefined`
 * for a locale map, and the spec's one treats `key` / `defaultValue` as locale
 * tags. So the two readers stay separate, as objectui#4580 Q2-B ruled.
 *
 * ## Why a pure function and not a hook
 *
 * The caller passes the locale; this function reads no React context. That
 * lets a renderer call it anywhere in its body, including after an early
 * return, and lets code outside React call it too. Renderers pass
 * `useDisplayLocale()` from `@object-ui/i18n`, the locale every
 * `resolveI18nLabel` read site in this repo resolves against (objectui#4580
 * revised Q1-A). Like the spec's resolver, `locale` is a required parameter
 * that may be `undefined` (which resolves as `en`), so a caller cannot forget
 * it by accident.
 *
 * @param aria - The authored bag, taken directly from the node's config. A
 *   missing bag, or a value that is not an object, gives `{}`.
 * @param locale - BCP-47 tag of the viewer's language, e.g. `zh-CN`.
 * @returns The attributes to spread onto the element that carries the name.
 */
export function resolveInlineAriaProps(
  aria: AriaProps | null | undefined,
  locale: string | undefined,
): { 'aria-label'?: string; 'aria-describedby'?: string; role?: string } {
  if (!aria || typeof aria !== 'object') return {};
  const out: { 'aria-label'?: string; 'aria-describedby'?: string; role?: string } = {};
  const label = resolveInlineI18nLabel(aria.ariaLabel, locale);
  if (label) out['aria-label'] = label;
  if (typeof aria.ariaDescribedBy === 'string' && aria.ariaDescribedBy) {
    out['aria-describedby'] = aria.ariaDescribedBy;
  }
  if (typeof aria.role === 'string' && aria.role) out.role = aria.role;
  return out;
}
