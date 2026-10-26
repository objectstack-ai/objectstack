/**
 * ActionConfirmDialog — Promise-based confirmation dialog for action execution.
 *
 * Uses Shadcn AlertDialog to replace window.confirm with a styled, accessible
 * confirmation dialog. Renders only when state.open is true.
 *
 * `options.destructive` (objectui#11695) paints the confirm button in the
 * destructive button style — the record delete asks with it. It is a className
 * override on `AlertDialogAction`, resolved by `cn()`'s tailwind-merge over the
 * primitive's baked-in default, because `packages/components/src/ui/**` is a
 * No-Touch zone (AGENTS.md #7); the `alert-dialog` renderer's `actionVariant`
 * (objectui#8978) uses the same override. Without the flag the button keeps
 * exactly the class it had.
 */

import type { ConfirmationHandler } from '@object-ui/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  buttonVariants,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';

export interface ConfirmDialogState {
  open: boolean;
  message: string;
  /** The published handler's own options bag — not a re-spelled copy of it. */
  options?: Parameters<ConfirmationHandler>[1];
  resolve?: (value: boolean) => void;
}

interface ActionConfirmDialogProps {
  state: ConfirmDialogState;
  onOpenChange: (open: boolean) => void;
}

export function ActionConfirmDialog({ state, onOpenChange }: ActionConfirmDialogProps) {
  const { t } = useObjectTranslation();
  const handleConfirm = () => {
    state.resolve?.(true);
    onOpenChange(false);
  };

  const handleCancel = () => {
    state.resolve?.(false);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={state.open} onOpenChange={(open) => {
      if (!open) handleCancel();
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.options?.title || t('actionConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>{state.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {state.options?.cancelText || t('actionConfirm.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className={state.options?.destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
            onClick={handleConfirm}
          >
            {state.options?.confirmText || t('actionConfirm.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
