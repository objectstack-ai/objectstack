// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app page the person last had open, for Studio's 「‹ Back to app」
 * (objectstack#36501).
 *
 * `ConsoleLayout` records it on every app route; Studio's top bar reads it.
 * An app → Studio entry is an in-app navigation, so the record names the page
 * the author came from, and the back link returns there.
 *
 * Held in module memory on purpose, never in browser storage: a Studio URL
 * opened directly (a new tab, a pasted link, a reload) starts with no record,
 * and the back link then lands on the package's own app instead of on a page
 * from some earlier visit.
 */

/** One app page, as the app bar names it. */
export interface AppReturnPage {
  /** The route, with its query and hash: where the back link navigates. */
  path: string;
  /** The app's name (its route key). */
  app: string;
  /** The app's display label, in the language it was shown in. */
  label: string;
}

let lastAppPage: AppReturnPage | null = null;

/** Records `page` as the app page now open. */
export function rememberAppReturnPage(page: AppReturnPage): void {
  if (!page.path || !page.app) return;
  lastAppPage = { ...page };
}

/** The app page last open in this page load, or `null` when none was. */
export function readAppReturnPage(): AppReturnPage | null {
  return lastAppPage;
}

/** Tests only: forget the record, as a fresh page load starts. */
export function resetAppReturnPageForTests(): void {
  lastAppPage = null;
}
