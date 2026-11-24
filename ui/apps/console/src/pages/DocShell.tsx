/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { AppDocsBackLink } from './AppDocsBackLink';
import { useAppDocsBackTo } from './useAppDocsBackTo';

/**
 * The frame of the package-documentation pages (ADR-0046), inside the
 * console's own top bar. It draws no bar of its own (objectstack#35424):
 *
 * - Under an app (`/apps/:appName/docs/...`, ADR-0048) the app bar above reads
 *   「APP / Documentation」, and the reader names its book and article above
 *   the article. An app's docs routes draw no app menu either, so the bar's
 *   place holds 「← Back to APP」 (`AppDocsBackLink`) on every page but the
 *   reader, which carries it in its docs column and passes `backLink={false}`.
 * - The portal (`/docs/...`) is drawn in Home's frame, whose bar reads
 *   「PRODUCT / Documentation」 and links to the portal's index (`App.tsx`,
 *   the `docs` variant of `AppHeader`).
 */
export function DocShell({
  backLink = true,
  children,
}: {
  /** Inside an app: draw 「← Back to APP」 above the page. The reader turns it off when its column has it. */
  backLink?: boolean;
  children: ReactNode;
}) {
  const { appName } = useParams<{ appName?: string }>();
  const backTo = useAppDocsBackTo();
  return (
    <div className="min-h-full">
      {appName && backLink && backTo ? (
        <div className="mx-auto flex max-w-3xl px-4 pt-4 sm:px-6" data-testid="docs-back-bar">
          <AppDocsBackLink backTo={backTo} />
        </div>
      ) : null}
      {children}
    </div>
  );
}
