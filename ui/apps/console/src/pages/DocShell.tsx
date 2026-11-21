/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { AppDocsBackLink } from './AppDocsBackLink';
import { useAppDocsBackTo } from './useAppDocsBackTo';

/**
 * Lightweight chrome for the package-documentation routes (ADR-0046).
 *
 * The doc viewer/portal are app-independent top-level routes, so they don't
 * get the console's app sidebar. This adds a minimal sticky header — a
 * "Documentation" home link (→ `/docs`) plus an optional breadcrumb — so a
 * reader always knows where they are and has a way back, without pulling in
 * the full app shell (which ADR-0046 deliberately keeps out of v1).
 *
 * Under an app (`/apps/:appName/docs/...`, ADR-0048) it draws no bar of its
 * own (objectstack#35424): the app bar above already reads 「APP /
 * Documentation」, and the reader names its book and article above the
 * article. An app's docs routes draw no app menu either, so the bar's place
 * holds 「← Back to APP」 (`AppDocsBackLink`) on every page but the reader,
 * which carries it in its docs column and passes `backLink={false}`. The
 * label reads the session language (`help.documentation`).
 */
export function DocShell({
  breadcrumb,
  backLink = true,
  children,
}: {
  breadcrumb?: string;
  /** Inside an app: draw 「← Back to APP」 above the page. The reader turns it off (its column has it). */
  backLink?: boolean;
  children: ReactNode;
}) {
  const { appName } = useParams<{ appName?: string }>();
  const { t } = useObjectTranslation();
  const backTo = useAppDocsBackTo();
  if (appName) {
    return (
      <div className="min-h-full">
        {backLink && backTo ? (
          <div className="mx-auto flex max-w-3xl px-4 pt-4 sm:px-6" data-testid="docs-back-bar">
            <AppDocsBackLink backTo={backTo} />
          </div>
        ) : null}
        {children}
      </div>
    );
  }
  const home = '/docs';
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
          <Link
            to={home}
            className="flex items-center gap-2 text-sm font-semibold hover:opacity-80"
          >
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span>{t('help.documentation', { defaultValue: 'Documentation' })}</span>
          </Link>
          {breadcrumb ? (
            <>
              <span className="text-muted-foreground/60" aria-hidden>
                /
              </span>
              <span className="truncate text-sm text-muted-foreground">{breadcrumb}</span>
            </>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}
