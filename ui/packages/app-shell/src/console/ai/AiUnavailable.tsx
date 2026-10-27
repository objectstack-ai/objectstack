// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AiUnavailable — what `/ai` shows where no AI assistant answers.
 *
 * Two hosts render it. `RequireAiSurface` (`ConsoleShell.tsx`) renders it at
 * the route itself when the runtime serves no agent at all, the Community
 * Edition shape: the route used to redirect home there, so a stale bookmark
 * or an external link to `/ai` landed on Home with no word of why
 * (objectstack#26614). `AiChatPage` renders it inside its own frame when the
 * catalog resolves empty after the gate let it through: a transient `/agents`
 * failure, or an external AI server that lists nothing.
 *
 * `hasError` tells "AI is not enabled on this deployment" apart from "couldn't
 * reach the AI service"; only the latter offers a retry. Either way there is a
 * way home, so the route never dead-ends. Where AI is simply not enabled,
 * Studio is the other way to build, so a session that may author is offered
 * Studio's new-package flow beside it: the same entry, under the same label
 * and on the same terms, as Home's "New in Studio" chip (an admin, on a
 * runtime that offers authoring, holding the authoring capability).
 */

import { Link } from 'react-router-dom';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { Button, Empty, EmptyDescription, EmptyTitle } from '@object-ui/components';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { isAiStudioEnabled } from '../../runtime-config.js';
import { STUDIO_NEW_PACKAGE_PATH } from '../../views/studio-design/studioNewPackage.js';

export function AiUnavailable({
  hasError,
  onRetry,
  onHome,
  t,
}: {
  hasError: boolean;
  /** Re-reads the agent catalog; offered only with `hasError`. */
  onRetry?: () => void;
  onHome: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { isAdmin } = useWorkspaceAdminStatus();
  const canAuthorMetadata = useCanAuthorMetadata();
  const offerStudio = !hasError && isAdmin && isAiStudioEnabled() && canAuthorMetadata;
  return (
    <div className="flex flex-1 items-center justify-center p-6" data-testid="ai-unavailable">
      <Empty>
        <EmptyTitle>
          {t('console.ai.unavailableTitle', { defaultValue: 'AI assistant unavailable' })}
        </EmptyTitle>
        <EmptyDescription>
          {hasError
            ? t('console.ai.unavailableError', {
                defaultValue:
                  "Couldn't reach the AI service. It may be temporarily offline — try again, or head back home.",
              })
            : t('console.ai.unavailableDescription', {
                defaultValue:
                  "This deployment doesn't have an AI assistant enabled. Everything else works as usual.",
              })}
        </EmptyDescription>
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
          {hasError && onRetry && (
            <Button variant="outline" onClick={onRetry} data-testid="ai-unavailable-retry">
              {t('console.ai.unavailableRetry', { defaultValue: 'Try again' })}
            </Button>
          )}
          {offerStudio && (
            <Button variant="outline" asChild>
              <Link to={STUDIO_NEW_PACKAGE_PATH} data-testid="ai-unavailable-studio">
                {t('home.build.inStudio', { defaultValue: 'New in Studio' })}
              </Link>
            </Button>
          )}
          <Button onClick={onHome} data-testid="ai-unavailable-home">
            {t('console.ai.unavailableHome', { defaultValue: 'Back to home' })}
          </Button>
        </div>
      </Empty>
    </div>
  );
}
