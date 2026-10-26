/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

/**
 * Translated accessible name for the close button the Shadcn `Sheet` and
 * `Dialog` primitives auto-render — objectstack#5505.
 *
 * Those buttons are icon-only (a lucide `X`), so their `sr-only` span is not
 * decoration: it IS the control's accessible name, the thing a screen reader
 * announces and the thing `getByRole('button', { name })` matches. Upstream
 * ships it as a hardcoded English literal, so under zh/ja/es every drawer and
 * modal in the console announced "Close" in English.
 *
 * ## Why the implementation lives HERE and not in the primitives
 *
 * `packages/components/src/ui/**` is regenerated from the Shadcn registry
 * (AGENTS.md Commandment #7) — anything written there is overwritten by the
 * next `pnpm shadcn:update`. `src/lib/` is not part of that regeneration, so
 * this file is permanent. The primitives get only a one-line
 * `<CloseSrLabel />` reference, re-applied on every sync by the declared patch
 * in `scripts/shadcn-local-patches.mjs`. Keeping the payload out of the
 * regenerated zone is what makes the patch small enough to survive upstream
 * churn: two anchored lines rather than an inlined hook.
 *
 * ## Why `createSafeTranslation`
 *
 * The no-provider path must stay English. A large number of existing unit
 * tests and e2e specs address dialogs and drawers by their English accessible
 * name with no `I18nProvider` mounted (e.g.
 * `packages/plugin-form/src/discardGuard.test.tsx`),
 * and a primitive that rendered a raw `common.close` key there would break all
 * of them. `createSafeTranslation` probes its test key and falls back to the
 * defaults map below when translations are not configured, so "no provider"
 * resolves to "Close" rather than to a key.
 */

import * as React from "react"
import { createSafeTranslation } from "@object-ui/i18n"

/**
 * The English fallback, used when no `I18nProvider` is mounted.
 *
 * `common.close` is deliberately the key the rest of the console already uses
 * for a bare "Close" (present in all ten locale packs since objectstack#5430),
 * not a new primitive-private one.
 *
 * Deliberately NOT exported: this file's only export is a component, which is
 * what `react-refresh/only-export-components` wants, and nothing outside needs
 * the map — consumers that want the string should read `common.close` from the
 * locale packs like everyone else.
 */
const CLOSE_LABEL_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'common.close': 'Close',
}

/**
 * Probe key is `common.close` itself: it exists in every shipped pack, so a
 * mounted provider always resolves it and the real `t` is used; with no
 * provider the probe fails and the default above is returned.
 */
const useCloseTranslation = createSafeTranslation(
  CLOSE_LABEL_DEFAULT_TRANSLATIONS,
  'common.close',
)

/**
 * `sr-only` accessible name for an icon-only close control.
 *
 * A component rather than a helper call because it owns a hook — the
 * primitives render it as `<CloseSrLabel />` inside their close button, which
 * keeps the hook call legal in files whose components are expression-bodied
 * `forwardRef` arrows with no statement block to put a hook in.
 */
export function CloseSrLabel(): React.ReactElement {
  const { t } = useCloseTranslation()
  return <span className="sr-only">{t('common.close')}</span>
}
