/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useState } from 'react';
import { useDisplayLocale, useLocalization, useObjectTranslation } from '@object-ui/i18n';

/** What `ActionRunner.setTranslator` takes. */
type ActionRunnerTranslate = (key: string, options: { defaultValue: string }) => string;

/**
 * The translator both React owners of an `ActionRunner` — `<ActionProvider>`
 * and `useActionRunner` — install on the runner they build, so the text the
 * runner writes itself (the generic success toast an action with no
 * `successMessage` ends in) renders in the session's language instead of
 * English. Internal to this package; not re-exported from its entry.
 *
 * The function is created once per mount and reads the latest `t` when it is
 * CALLED, so a language switch reaches a runner that was built before it. Both
 * owners rebuild their runner only when their `context` changes, and a
 * translator captured at build time would keep answering in the language that
 * was active then. The identity comes from `useState`'s initializer, not from a
 * memo, so nothing depends on a `useMemo` result staying put (AGENTS.md #10).
 */
export function useActionRunnerTranslator(): ActionRunnerTranslate {
  const { t } = useObjectTranslation();
  const latest = useRef(t);
  // No dependency list: after every render, the ref holds that render's `t`.
  // Actions run from user events, which arrive after the commit.
  useEffect(() => {
    latest.current = t;
  });
  const [translate] = useState<ActionRunnerTranslate>(() => {
    const read: ActionRunnerTranslate = (key, options) => String(latest.current(key, options));
    return read;
  });
  return translate;
}

/**
 * What `ActionRunner.setDisplayLocale` takes: the viewer's display locale, read
 * when a copy template is filled.
 */
type ActionRunnerDisplayLocale = () => string;

/**
 * The display locale both React owners of an `ActionRunner` install beside the
 * translator, so the `template` formatters in an action's `confirmText` and
 * `successMessage` render in the viewer's locale instead of `en-US`
 * (objectstack#26232). It is `useDisplayLocale()` — the one resolution every
 * date, number and currency renderer reads; ⛔ no second copy here.
 *
 * Read when CALLED, by the same latest-ref pattern as
 * {@link useActionRunnerTranslator}, so a locale switch reaches a runner that
 * was built before it.
 */
export function useActionRunnerDisplayLocale(): ActionRunnerDisplayLocale {
  const displayLocale = useDisplayLocale();
  const latest = useRef(displayLocale);
  useEffect(() => {
    latest.current = displayLocale;
  });
  const [read] = useState<ActionRunnerDisplayLocale>(() => () => latest.current);
  return read;
}

/**
 * What `ActionRunner.setTenantCurrency` takes: the tenant default currency,
 * read when a copy template is filled.
 */
type ActionRunnerTenantCurrency = () => string | undefined;

/**
 * The tenant default currency both React owners of an `ActionRunner` install
 * beside the display locale, so a `{{ amount | currency }}` hole with no
 * argument in an action's `confirmText` and `successMessage` formats in it. It
 * is `useLocalization().currency` — the `localization.currency` setting every
 * currency field and measure renderer reads; ⛔ no second copy here. Undefined
 * when the tenant has none, and such a hole then does not render.
 *
 * Read when CALLED, by the same latest-ref pattern as
 * {@link useActionRunnerTranslator}, so a settings change reaches a runner
 * that was built before it.
 */
export function useActionRunnerTenantCurrency(): ActionRunnerTenantCurrency {
  const { currency } = useLocalization();
  const latest = useRef(currency);
  useEffect(() => {
    latest.current = currency;
  });
  const [read] = useState<ActionRunnerTenantCurrency>(() => () => latest.current);
  return read;
}
