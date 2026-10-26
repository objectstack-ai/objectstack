/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useLocalization } from './LocalizationContext.js';
import { useObjectTranslation } from './provider.js';

/**
 * `useDisplayLocale` — the BCP-47 tag that field / cell / metric renderers
 * format numbers and other `Intl` values with.
 *
 * This composes the two locale channels this repo already has; it does not add
 * a third. The precedence, highest first:
 *
 *  1. **`useLocalization().locale`** — the tenant's resolved regional default
 *     (ADR-0053, served by `GET /api/v1/auth/me/localization`). An org that has
 *     explicitly configured a display locale means it, so it outranks the UI
 *     language. Frequently `undefined`: the endpoint is
 *     cosmetic and non-blocking, so an unconfigured or still-loading tenant
 *     simply has no answer here (the state objectui#4033 was measured in — a
 *     fresh database, console running `zh-CN`).
 *
 *  2. **`useObjectTranslation().language`** — the ACTIVE UI language, i.e. what
 *     the user picked in the language switcher. This is the channel that makes
 *     grouping and decimal marks follow the user's language when the tenant has
 *     stated no regional preference.
 *
 *  3. **`'en'`** — a concrete last resort rather than `undefined`. `undefined`
 *     would hand `Intl` the *machine's* locale, which is invisible in review and
 *     non-deterministic in CI; `'en'` at least fails the same way everywhere.
 *     Note this is `'en'`, not `'en-US'`: the point of objectui#4033 is that
 *     `en-US` is not the world's default. In practice step 2 already answers,
 *     since `useObjectTranslation` falls back to the react-i18next global
 *     instance and ultimately reports `'en'` itself.
 *
 *     ⚠️ This last resort is the rule for THIS HOOK — a React renderer whose
 *     provider chain yielded no tag at all — and not for every caller that has
 *     no tag. A non-React display caller cannot call a hook, and
 *     `@object-ui/core` deliberately gives it a different answer:
 *     `DisplayNumberFormatOptions.locale`
 *     (`packages/core/src/utils/number-display.ts`) says `undefined` there
 *     means the runtime default, because the viewer's own environment is the
 *     honest locale for a user-facing display. The two rules govern different
 *     callers and do not contradict each other (objectui#10098); that docblock
 *     names this one in return.
 *
 * Provider-safe at every step: `useLocalization` returns `{}` outside its
 * provider and `useObjectTranslation` reads an optional context, so a renderer
 * mounted standalone (tests, docs demos) degrades instead of throwing.
 *
 * **This composition is also the whole `'zh'` ↔ BCP-47 story** (objectui#4468).
 * There is no mapping table anywhere and none is needed: the UI language codes
 * this renderer ships (`'zh'`, `'ja'`, `'de'`, …) are already well-formed
 * BCP-47 language subtags, so `Intl` accepts them verbatim. The one thing a
 * caller must not do is reach past this hook for the raw tenant locale and hand
 * `Intl` the `undefined` it gets on an unconfigured workspace — `undefined`
 * means "the MACHINE's locale", which is neither channel. Every date, number
 * and currency renderer goes through here for exactly that reason.
 */
export function useDisplayLocale(): string {
  const { locale } = useLocalization();
  const { language } = useObjectTranslation();
  return locale || language || 'en';
}
