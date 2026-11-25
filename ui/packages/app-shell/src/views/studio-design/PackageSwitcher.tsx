// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package-list toast id Studio's surface shares. The top-bar package
 * switcher that lived here with it, since objectstack#29988's move-only split,
 * was removed by objectstack#36501: the top bar's left end is 「‹ Back to app」
 * (`StudioBackToApp.tsx`), and a package is picked in the app or in Setup →
 * Packages (objectstack#36834, objectstack#36908). The installed-row read that
 * the Studio home's Manage opened the package sheet with went with that home
 * (objectstack#36908).
 */

/**
 * One sonner id for EVERY `fetchPackages()` failure on this surface
 * (objectui#7368). More than one effect calls that one endpoint on mount — the
 * writability courtesy gate and the namespace lookup — so a single 503 rejects
 * them all. Sonner UPDATES a toast that already carries the id instead of
 * stacking a new one (the `outcomeToastId` pattern this repo already uses in
 * `packages/components/src/renderers/form/form.tsx`), so one outage produces
 * one toast, not several. Reporting the failure is the point;
 * reporting it three times is noise that would get the report muted.
 */
export const PACKAGE_LIST_TOAST_ID = 'studio-package-list';
