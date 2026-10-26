// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioEmptyState — the one centered block a Studio surface shows while it
 * holds nothing (objectui#12514, epic objectui#12446): the pillar's icon, one
 * sentence, and the primary button that creates the first item.
 *
 * The block never invents a create path of its own. The button is the
 * caller's, and every caller hands it the handler its "+" or "New" already
 * runs — or wraps it in the very popover that control opens. A read-only
 * surface passes no action: the sentence stands alone, and the read-only
 * posture (objectui#12453) says why elsewhere.
 */

import * as React from 'react';
import { Plus, type LucideIcon } from 'lucide-react';
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@object-ui/components';

export interface StudioEmptyStateProps {
  /** The pillar's or the tab's own icon. */
  icon: LucideIcon;
  /** The one sentence. */
  sentence: React.ReactNode;
  /** The primary button — a {@link StudioEmptyStateAction}, bare or wrapped in its popover's trigger. */
  action?: React.ReactNode;
  testId?: string;
}

export function StudioEmptyState({ icon: Icon, sentence, action, testId }: StudioEmptyStateProps): React.ReactElement {
  return (
    <Empty data-testid={testId} className="gap-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyDescription>{sentence}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}

export type StudioEmptyStateActionProps = React.ComponentPropsWithoutRef<typeof Button> & { label: string };

/** The block's primary button: a plus and the create control's own name. */
export const StudioEmptyStateAction = React.forwardRef<HTMLButtonElement, StudioEmptyStateActionProps>(
  function StudioEmptyStateAction({ label, ...props }, ref) {
    return (
      <Button ref={ref} type="button" size="sm" {...props}>
        <Plus aria-hidden className="h-4 w-4" />
        {label}
      </Button>
    );
  },
);
