/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Setup app's identity, and the one signal a page reads to know it is
 * drawn inside Setup (objectui#12606).
 *
 * The constants lived in `ConsoleShell.tsx`, which still re-exports them; they
 * sit in this dependency-free module so the page header and the list pages can
 * read them without importing the console shell.
 */

import { useParams } from 'react-router-dom';

/**
 * The Setup app's canonical package id (ADR-0048 — one app per package).
 * `@objectstack/setup` declares it, and `/apps/<packageId>` is the app's
 * canonical URL (see `utils/appRoute.ts`).
 */
export const SETUP_APP_PACKAGE_ID = 'com.objectstack.setup';

/**
 * The Setup app's metadata `name`. `matchAppBySegment()` treats the name as a
 * per-tenant friendly alias, so a deployment that registers Setup without an
 * owning package (runtime/DB apps, older bundles) is still resolvable by it.
 */
export const SETUP_APP_NAME = 'setup';

/**
 * Does this `/apps/:appName` segment name the Setup app? The package id and
 * the name both address it, in the order `matchAppBySegment()` resolves them.
 */
export function isSetupAppSegment(segment: string | null | undefined): boolean {
  return segment === SETUP_APP_PACKAGE_ID || segment === SETUP_APP_NAME;
}

/**
 * Is the calling page drawn inside the Setup app? Read off the route the page
 * is mounted under — the `:appName` param of `/apps/:appName/*` — so no host
 * threads a prop for it. Outside that route (Studio, a test that mounts the
 * page bare) the answer is `false` and the page keeps its default shape.
 */
export function useInSetupApp(): boolean {
  const { appName } = useParams<{ appName?: string }>();
  return isSetupAppSegment(appName);
}
