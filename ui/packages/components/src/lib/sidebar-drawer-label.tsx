/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

/**
 * Translated accessible name for the phone navigation drawer — the Sheet the
 * Shadcn `Sidebar` renders in place of the panel below the mobile breakpoint.
 *
 * That Sheet is a dialog, and its `sr-only` title IS the dialog's accessible
 * name: the thing a screen reader announces on opening it and the thing
 * `getByRole('dialog', { name })` matches. Upstream ships it as the English
 * literal "Sidebar" beside a "Displays the mobile sidebar." description, so a
 * zh / ja / es workspace heard English on opening a drawer whose every visible
 * row is translated.
 *
 * ## The key
 *
 * `console.nav.menuLabel` ("App navigation") is the name the app menu inside
 * the drawer already announces (`UnifiedSidebar`, `nav-menu-renderer`), and it
 * is present in every shipped locale pack, so the drawer is named for what it
 * holds without a primitive-private key. The upstream description has no
 * counterpart in the packs and says nothing the name does not, so the primitive
 * drops it and tells Radix so with `aria-describedby={undefined}` (the
 * `sidebar-drawer-label-*` patches in `ui/scripts/shadcn-local-patches.mjs`).
 *
 * ## Why it lives HERE and not in the primitive
 *
 * `src/ui/**` is regenerated from the Shadcn registry (ui/AGENTS.md #7), so the
 * primitive gets only an anchored one-line reference, re-applied on every sync;
 * the hook and the English fallback live in this file, which the sync never
 * touches. Same arrangement as `close-label.tsx`.
 *
 * ## Why `createSafeTranslation`
 *
 * With no `I18nProvider` mounted the name must stay English ("App navigation"),
 * never a raw key. Deliberately not exported from the package index.
 */

import * as React from "react"
import { createSafeTranslation } from "@object-ui/i18n"

/** The `en` pack's value, served when no `I18nProvider` is mounted. */
const DRAWER_LABEL_DEFAULT_TRANSLATIONS: Record<string, string> = {
  "console.nav.menuLabel": "App navigation",
}

const useDrawerLabelTranslation = createSafeTranslation(
  DRAWER_LABEL_DEFAULT_TRANSLATIONS,
  "console.nav.menuLabel",
)

/**
 * The text of the phone drawer's `SheetTitle`. A component rather than a
 * helper call because it owns a hook, and the primitive's `Sidebar` renders it
 * inside its JSX: `<SheetTitle><SidebarDrawerTitle /></SheetTitle>`.
 */
export function SidebarDrawerTitle(): React.ReactElement {
  const { t } = useDrawerLabelTranslation()
  return <>{t("console.nav.menuLabel")}</>
}
