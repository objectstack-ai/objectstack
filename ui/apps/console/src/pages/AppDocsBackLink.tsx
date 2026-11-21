/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { AppDocsBackTo } from './useAppDocsBackTo';

/**
 * 「← Back to APP」 (objectstack#35424). An app's docs routes draw no app
 * menu, so every docs page inside an app carries this link: the reader in
 * its docs column, every other page (the app's docs index, a book with no
 * articles, a book or doc not found) at the top, through `DocShell`.
 */
export function AppDocsBackLink({ backTo }: { backTo: AppDocsBackTo }) {
  const { t } = useObjectTranslation();
  return (
    <Link
      to={backTo.to}
      data-testid="docs-nav-back"
      className="inline-flex items-center gap-1.5 self-start rounded px-2 py-1 text-sm font-medium text-primary hover:bg-muted/50"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      <span>{t('help.backToApp', { defaultValue: 'Back to {{app}}', app: backTo.label })}</span>
    </Link>
  );
}
