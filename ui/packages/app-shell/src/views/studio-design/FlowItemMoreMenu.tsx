// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowItemMoreMenu — the Automations pillar's ⋯ menu on an open flow, with
 * Delete flow (#27356 row 19, maintainer-ruled A1; Studio had no delete,
 * objectui#12725). The confirmation is Setup's: the in-app dialog naming the
 * flow by its label and `type/name` (objectui#13333). The pillar draws it only
 * for a writable package's flow and sends the delete itself. Reset overlay is
 * not offered: it arrives with the overlay editing of the Studio / Setup
 * boundary record's phase 2 (#28045).
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { t, tFormat, translateMetadataType } from '../metadata-admin/i18n.js';
import { STUDIO_HEADER_ICON_BUTTON } from './studio-tokens.js';

/** `label` is the flow's display label; `disabled` holds the delete while a save is in flight. */
export function FlowItemMoreMenu({ name, label, locale, disabled, onDelete }: {
  name: string; label: string; locale: string; disabled?: boolean; onDelete: () => void;
}): React.ReactElement {
  const [confirming, setConfirming] = React.useState(false);
  const vars = { type: 'flow', name, typeLabel: translateMetadataType('flow', locale), item: label || name };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="auto-item-more"
            aria-label={t('engine.studio.if.more', locale)}
            title={t('engine.studio.if.more', locale)}
            className={STUDIO_HEADER_ICON_BUTTON}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            data-testid="auto-item-delete"
            disabled={disabled}
            className="text-destructive focus:text-destructive"
            onSelect={() => setConfirming(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t('engine.studio.auto.deleteFlow', locale)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent data-testid="auto-delete-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{tFormat('engine.edit.deleteConfirm', locale, vars)}</AlertDialogTitle>
            <AlertDialogDescription>{tFormat('engine.edit.deleteConfirmBody', locale, vars)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="auto-delete-confirm-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="auto-delete-confirm-action"
              onClick={() => { setConfirming(false); onDelete(); }}
            >
              {t('engine.edit.delete', locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
