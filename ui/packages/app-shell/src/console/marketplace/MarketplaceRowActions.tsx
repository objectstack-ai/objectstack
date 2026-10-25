// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The marketplace actions on a Setup → Packages row whose Source is
 * `marketplace` (objectui#12675, ruling B on objectstack#23892).
 *
 * Moved here from the Installed Apps list (`InstalledList`), which carried
 * exactly these two: **Details**, which opens the package's marketplace page
 * (where Update and the sample-data Re-seed / Purge menu live), and
 * **Uninstall**, offered only when the list is this runtime's install-local
 * ledger (a cloud-connected environment's installs are managed by the control
 * plane). The Packages page renders this only when the marketplace capability
 * (`features.installLocal`) is present and the viewer is a workspace admin —
 * the same two gates the Installed Apps page had.
 *
 * The confirm is in-app (`AlertDialog`), the Packages page's convention
 * (objectui#11784), with the Installed Apps sentences unchanged.
 */

import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { AlertCircle, ExternalLink, Trash2 } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { uninstallLocal, type LocalInstallEntry, type LocalInstallNotLoaded } from './marketplaceApi.js';

/**
 * The reason a `notLoaded` entry was refused, in plain words (objectui#11645).
 * A code the console has no sentence for still reads as not loaded, naming
 * the code, rather than hiding the row the operator needs to uninstall.
 */
export function MarketplaceNotLoaded({ marker }: { marker: LocalInstallNotLoaded }) {
  const { t } = useObjectTranslation();
  const reason =
    marker.code === 'OS_PROTOCOL_INCOMPATIBLE'
      ? t('marketplace.notLoaded.protocolIncompatible', { requiredRange: marker.requiredRange })
      : t('marketplace.notLoaded.otherReason', { code: marker.code });
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="destructive" className="self-start">{t('marketplace.notLoaded.badge')}</Badge>
      <p className="text-xs text-destructive flex items-start gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" />
        <span>{reason}</span>
      </p>
    </div>
  );
}

export interface MarketplaceRowActionsProps {
  entry: LocalInstallEntry;
  /** Which list the entry came from; Uninstall is offered on `local` only. */
  listSource: 'cloud' | 'local';
  /** `/apps/APP`, or `''` outside an app. */
  basePath: string;
  /** The outcome of an action, for the page to show. */
  onResult: (result: { ok: boolean; message: string }) => void;
  /** Called after a successful uninstall, so the page reloads its list. */
  onChanged: () => void;
}

export function MarketplaceRowActions({ entry, listSource, basePath, onResult, onChanged }: MarketplaceRowActionsProps) {
  const navigate = useNavigate();
  const { t } = useObjectTranslation();
  const kernelNoteId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);

  // A loaded package's confirm and result say what the DELETE does: the app
  // leaves the running kernel at once, with its permission sets and their
  // grants, and its records stay (objectui#12684). A package the runtime did
  // not load leaves nothing in the running kernel, so its texts say that
  // instead, rather than describe a withdrawal that would contradict the row's
  // own "Not loaded" (objectui#11645).
  const question = entry.notLoaded
    ? t('marketplace.uninstall.confirmNotLoaded', { manifestId: entry.manifestId, version: entry.version })
    : t('marketplace.uninstall.confirm', { manifestId: entry.manifestId, version: entry.version });

  const doUninstall = async () => {
    setConfirmOpen(false);
    setWorking(true);
    try {
      await uninstallLocal(entry.manifestId);
      onResult({
        ok: true,
        message: entry.notLoaded
          ? t('marketplace.uninstall.successNotLoaded', { manifestId: entry.manifestId })
          : t('marketplace.uninstall.successInList', { manifestId: entry.manifestId }),
      });
      onChanged();
    } catch (e: any) {
      onResult({ ok: false, message: e?.message ?? String(e) });
    } finally {
      setWorking(false);
    }
  };

  const uninstallButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setConfirmOpen(true)}
      disabled={working}
      aria-describedby={entry.notLoaded ? undefined : kernelNoteId}
      data-testid={`pkg-row-uninstall-${entry.manifestId}`}
    >
      <Trash2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
      {working ? t('marketplace.action.uninstalling') : t('marketplace.action.uninstall')}
    </Button>
  );

  return (
    // The row itself opens the package's detail sheet; a click on an action
    // must not also open it.
    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`${basePath}/system/marketplace/${entry.packageId}`)}
        data-testid={`pkg-row-details-${entry.manifestId}`}
      >
        <ExternalLink className="h-4 w-4 mr-1.5" aria-hidden="true" />
        {t('marketplace.action.details')}
      </Button>
      {listSource === 'local' &&
        (entry.notLoaded ? (
          uninstallButton
        ) : (
          // The kernel note is about a LOADED package: what uninstalling it
          // withdraws from the running kernel at once, and what it leaves in
          // the database (objectui#12684). It rides the Uninstall it qualifies,
          // as a tooltip (objectui#12610); the sr-only copy is what a screen
          // reader announces as the button's description.
          <>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>{uninstallButton}</TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>{t('marketplace.installedAdditiveNote')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span id={kernelNoteId} className="sr-only">{t('marketplace.installedAdditiveNote')}</span>
          </>
        ))}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid={`pkg-row-uninstall-dialog-${entry.manifestId}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('marketplace.action.uninstall')}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{question}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doUninstall()} data-testid={`pkg-row-uninstall-confirm-${entry.manifestId}`}>
              {t('marketplace.action.uninstall')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
