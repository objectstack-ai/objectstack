// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2 — what an item a read-only package lets this environment
 * customize carries in Studio: the "customized in this environment" chip (in
 * the item header and on its rail row), and Reset to package default on the
 * item's ⋯ menu. Both read the item's layered envelope (`overlayInPlace.ts`);
 * the pillar sends the reset.
 */

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenuItem,
  DropdownMenuSeparator,
  cn,
} from '@object-ui/components';
import { Layers, RotateCcw, Trash2 } from 'lucide-react';
import { t, tFormat, translateMetadataType } from '../metadata-admin/i18n.js';

/**
 * The "customized in this environment" chip. `compact` is the rail row's
 * form: the glyph alone, its text kept as the accessible name and tooltip.
 */
export function StudioCustomizedChip({ locale, compact = false }: { locale: string; compact?: boolean }): React.ReactElement {
  const label = t('engine.studio.overlay.customized', locale);
  return (
    <span
      data-testid={compact ? 'studio-customized-mark' : 'studio-customized-chip'}
      title={t('engine.studio.overlay.customizedTitle', locale)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300',
        compact ? 'h-5 w-5 justify-center' : 'h-6 px-2 text-[11px]',
      )}
    >
      <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </span>
  );
}

/**
 * Reset to package default (`verb: 'reset'`) or Delete (`verb: 'delete'`, an
 * overlay row with no package version behind it) on the item's ⋯ menu, with
 * Setup's confirmation wording. `hasDraft` adds that the unpublished draft is
 * discarded first; `onConfirm` sends both.
 */
export function StudioOverlayRemoval({
  verb,
  type,
  name,
  label,
  hasDraft,
  disabled,
  locale,
  onConfirm,
}: {
  verb: 'reset' | 'delete';
  type: string;
  name: string;
  /** The item's display label; its machine name when it has none. */
  label: string;
  hasDraft: boolean;
  disabled?: boolean;
  locale: string;
  onConfirm: () => void;
}): React.ReactElement {
  const [confirming, setConfirming] = React.useState(false);
  const vars = { type, name, typeLabel: translateMetadataType(type, locale), item: label || name };
  const reset = verb === 'reset';
  const body = tFormat(reset ? 'engine.edit.resetConfirmBody' : 'engine.edit.deleteConfirmBody', locale, vars);
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-testid="studio-overlay-removal"
        data-verb={verb}
        disabled={disabled}
        className={reset ? undefined : 'text-destructive focus:text-destructive'}
        onSelect={() => setConfirming(true)}
      >
        {reset ? (
          <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        )}
        {t(reset ? 'engine.studio.overlay.reset' : 'engine.edit.delete', locale)}
      </DropdownMenuItem>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent data-testid="studio-overlay-removal-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tFormat(reset ? 'engine.edit.resetConfirm' : 'engine.edit.deleteConfirm', locale, vars)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasDraft ? `${body} ${t('engine.studio.overlay.draftDiscarded', locale)}` : body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="studio-overlay-removal-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
            <AlertDialogAction
              className={reset ? undefined : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
              data-testid="studio-overlay-removal-confirm"
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              {t(reset ? 'engine.studio.overlay.reset' : 'engine.edit.delete', locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
