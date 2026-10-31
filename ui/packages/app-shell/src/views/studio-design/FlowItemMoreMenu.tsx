// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowItemMoreMenu — the Automations pillar's ⋯ menu on an open flow.
 *
 * A writable package's flow gets Delete flow (#27356 row 19, maintainer-ruled
 * A1; Studio had no delete, objectui#12725). The confirmation is Setup's: the
 * in-app dialog naming the flow by its label and `type/name` (objectui#13333).
 *
 * A read-only package's flow gets Clone flow (ADR-0146 D4): the pillar opens
 * `FlowCloneDialog` and holds the result. When the caller's posture facts say
 * the clone door refuses them, the item is drawn disabled with the console's
 * own sentence under it (`cloneDisabledReason`), never a live item that always
 * answers 403.
 *
 * The pillar decides which items a flow gets and sends every request itself.
 * Reset overlay is not offered: it arrives with ADR-0146 D2's overlay editing.
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
import { Copy, MoreHorizontal, Trash2 } from 'lucide-react';
import { t, tFormat, translateMetadataType } from '../metadata-admin/i18n.js';
import { STUDIO_HEADER_ICON_BUTTON } from './studio-tokens.js';

/**
 * `label` is the flow's display label; `disabled` holds the items while a
 * write is in flight. Each item is drawn only when its handler is passed.
 */
export function FlowItemMoreMenu({ name, label, locale, disabled, onDelete, onClone, cloneDisabledReason }: {
  name: string;
  label: string;
  locale: string;
  disabled?: boolean;
  onDelete?: () => void;
  onClone?: () => void;
  /** The console's sentence for why the clone door refuses this caller; the item draws disabled under it. */
  cloneDisabledReason?: string;
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
        <DropdownMenuContent align="end" className={cloneDisabledReason ? 'w-60' : 'w-44'}>
          {onClone && (
            <>
              <DropdownMenuItem
                data-testid="auto-item-clone"
                disabled={disabled || !!cloneDisabledReason}
                onSelect={onClone}
              >
                <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {t('engine.studio.auto.clone.menu', locale)}
              </DropdownMenuItem>
              {cloneDisabledReason && (
                <p data-testid="auto-item-clone-reason" className="px-2 pb-1.5 text-[11px] leading-4 text-muted-foreground">
                  {cloneDisabledReason}
                </p>
              )}
            </>
          )}
          {onDelete && (
            <DropdownMenuItem
              data-testid="auto-item-delete"
              disabled={disabled}
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirming(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              {t('engine.studio.auto.deleteFlow', locale)}
            </DropdownMenuItem>
          )}
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
              onClick={() => { setConfirming(false); onDelete?.(); }}
            >
              {t('engine.edit.delete', locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
