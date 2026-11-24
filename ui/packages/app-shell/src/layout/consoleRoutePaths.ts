// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which console routes change the chrome's shape: read by `ConsoleLayout` and
 * by the boot frame (`ConsoleBootShell`, objectstack#35981), which must draw
 * the shape the chrome will have, and is kept free of the layout's imports so
 * the boot path does not load the whole chrome to ask.
 */

/**
 * Is `pathname` a record page, the console route `RecordDetailView` draws:
 * `/apps/APP/OBJECT/record/ID`, or the same record on a named record page
 * (`.../page/PAGE`)? The record's edit form (`.../edit`) is not one.
 */
export function isRecordPagePath(pathname: string): boolean {
  return /^\/apps\/[^/]+\/[^/]+\/record\/[^/]+(?:\/page\/[^/]+)?\/?$/.test(pathname);
}

/**
 * Is `pathname` one of an app's documentation pages, `/apps/APP/docs` and
 * everything under it (objectstack#35424)? A reader there has one navigation,
 * the docs' own, so the app's menu is not drawn beside it.
 */
export function isAppDocsPath(pathname: string): boolean {
  return /^\/apps\/[^/]+\/docs(?:\/|$)/.test(pathname);
}
