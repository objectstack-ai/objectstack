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

/**
 * Lightweight chrome for the package-documentation routes (ADR-0046).
 *
 * The doc viewer/portal are app-independent top-level routes, so they don't
 * get the console's app sidebar. This adds a minimal sticky header — a
 * "Documentation" home link (→ `/docs`) plus an optional breadcrumb — so a
 * reader always knows where they are and has a way back, without pulling in
 * the full app shell (which ADR-0046 deliberately keeps out of v1).
 *
 * Under an app (`/apps/:appName/docs/...`, ADR-0048) the home link is that
 * app's docs index, so it keeps the reader inside the app shell, the same
 * answer the sidebar and the body cross-references give. The label reads the
 * session language (`help.documentation`).
 */
export function DocShell({ breadcrumb, children }: { breadcrumb?: string; children: ReactNode }) {
  const { appName } = useParams<{ appName?: string }>();
  const { t } = useObjectTranslation();
  const home = appName ? `/apps/${appName}/docs` : '/docs';
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
