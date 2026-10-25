/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0037 — the draft preview's own empty/error states.
 *
 * A `?preview=draft` tree (the Live Canvas iframe, or a hand-opened preview
 * URL) must NEVER fall through to the console's generic "No Apps Configured"
 * screen: that screen tells the user nothing exists and offers "Create Your
 * First App" — both wrong and disorienting inside a preview of an app the AI
 * just drafted. Preview has exactly three honest non-happy states, all
 * rendered here:
 *
 *  - loading failed   → say so, offer Retry (the overlay read errored);
 *  - app not in draft → the build likely failed or hasn't run — point the
 *                       user back to the conversation, never to "create app";
 *  - nothing drafted  → same message, generic (no app name in the URL).
 *
 * Deliberately CTA-free beyond Retry: the preview is a window owned by the
 * build conversation; every corrective action lives there.
 */

import { Eye, RefreshCw, TriangleAlert } from 'lucide-react';
import { Empty, EmptyTitle, EmptyDescription, Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';

export interface PreviewDraftEmptyStateProps {
  /** The app the URL asked to preview (`/apps/:appName?preview=draft`). */
  appName?: string;
  /** Why the draft world failed to load, when it errored (null = loaded fine). */
  error?: Error | null;
  /** Re-read the draft overlay (MetadataProvider.refresh). */
  onRetry: () => void;
}

export function PreviewDraftEmptyState({ appName, error, onRetry }: PreviewDraftEmptyStateProps) {
  const { t } = useObjectTranslation();
  const failed = Boolean(error);
  return (
    <div className="flex h-screen items-center justify-center" data-testid="preview-draft-empty-state">
      <Empty>
        <div className="mb-2 flex justify-center text-muted-foreground" aria-hidden="true">
          {failed ? <TriangleAlert className="h-8 w-8" /> : <Eye className="h-8 w-8" />}
        </div>
        <EmptyTitle>
          {failed
            ? t('preview.empty.loadFailedTitle', { defaultValue: 'Draft preview failed to load' })
            : appName
              ? t('preview.empty.notReadyTitle', {
                  app: appName,
                  defaultValue: '“{{app}}” isn’t in the draft yet',
                })
              : t('preview.empty.nothingTitle', { defaultValue: 'Nothing to preview yet' })}
        </EmptyTitle>
        <EmptyDescription>
          {failed
            ? t('preview.empty.loadFailedDescription', {
                defaultValue: 'The draft overlay could not be read. Retry, or check your connection.',
              })
            : t('preview.empty.notReadyDescription', {
                defaultValue:
                  'The build may still be running, or it may have failed before this app was staged. Check the conversation for the build status — this pane refreshes as drafts land.',
              })}
        </EmptyDescription>
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={onRetry} data-testid="preview-draft-retry">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('preview.empty.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      </Empty>
    </div>
  );
}
