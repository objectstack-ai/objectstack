// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `<NotFoundState>` — the one face of the console's "not found" states: an
 * unknown object, an unknown route, an unknown record and an unknown app.
 *
 * Each state keeps its own title and its own cause sentence (which object, a
 * URL that matches no view, a record that is gone or withheld, an app the
 * server did not return), and every one of them offers a way out: the state
 * names its own way back (the record's list, the browser history, a retry) and
 * `<BackToHomeButton>` takes the reader to Home. A state that strands its
 * reader on a dead end is the defect this component exists to prevent, so
 * `actions` is required.
 *
 * Home is `useHomePath()`, the target of every other Home affordance in the
 * chrome, so a deployment that declares a landing app returns there.
 *
 * @module
 */

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Button, Empty, EmptyDescription, EmptyTitle, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useHomePath } from '../hooks/useHomePath.js';

export interface NotFoundStateProps {
  /** What was not found, e.g. "Record not found". */
  title: ReactNode;
  /** Why: the state's own cause, in one or two sentences. */
  description: ReactNode;
  /** The ways out, the state's own first. At least one; `<BackToHomeButton>` is always available. */
  actions: ReactNode;
  /** An icon drawn above the title. */
  icon?: LucideIcon;
  /** `data-testid` of the state. */
  testId?: string;
  /** Classes for the centring wrapper (its height differs by where the state is drawn). */
  className?: string;
}

export function NotFoundState({ title, description, actions, icon: Icon, testId, className }: NotFoundStateProps) {
  return (
    <div className={cn('flex h-full w-full items-center justify-center p-4', className)}>
      <Empty data-testid={testId}>
        {Icon ? (
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      </Empty>
    </div>
  );
}

/** "Back to home": navigates to the console's Home (`useHomePath()`). */
export function BackToHomeButton({
  testId,
  variant = 'outline',
}: {
  testId?: string;
  variant?: 'default' | 'outline';
}) {
  const navigate = useNavigate();
  const homePath = useHomePath();
  const { t } = useObjectTranslation();
  return (
    <Button variant={variant} onClick={() => navigate(homePath)} data-testid={testId}>
      {t('empty.appAccessDeniedHome', { defaultValue: 'Back to home' })}
    </Button>
  );
}
