// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The "Clone to customize" dialog for a permission set (objectui#7611, PR-4):
 * it asks for the copy's new machine name and label, sends them through
 * {@link clonePermissionSet} (the server's clone door — see
 * `permission-set-clone.ts` for the door and what it decides), and shows a
 * refusal in the server's own words.
 *
 * objectstack#32537 — a name more than one package holds is cloned from the
 * `sourcePackage` the host holds; a host that holds none is refused naming
 * every holder, and the dialog shows that refusal as a pick
 * (`PermissionSetHolderPick.tsx`): choosing a holder sends the clone again
 * from that holder's set. ⛔ Nothing is chosen by order.
 */

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@object-ui/components';
import { t as translate, tFormat } from './i18n.js';
import { clonePermissionSet, type PermissionSetCloned } from './permission-set-clone.js';
import {
  candidatePackage,
  PermissionSetHolderConflict,
  type PermissionSetHolderCandidate,
} from './permission-set-holder.js';
import { PermissionSetHolderPick } from './PermissionSetHolderPick.js';

export interface PermissionSetCloneDialogProps {
  /** Machine name of the set being copied. */
  source: string;
  /**
   * The package whose set of that name is copied, where the host holds one and
   * the name alone does not address it (`permission-set-holder.ts`). Absent:
   * the name alone, as before.
   */
  sourcePackage?: string;
  locale: string;
  /** Closes the dialog (Cancel, Escape, the overlay). */
  onClose: () => void;
  /** The server accepted the clone. */
  onCloned: (cloned: PermissionSetCloned) => void;
}

/**
 * The dialog. Mounted only while open, so every opening starts empty. Both
 * fields are required; the name rule itself is the server's (its `400` names
 * it), never a second copy of it here.
 */
export function PermissionSetCloneDialog({ source, sourcePackage, locale, onClose, onCloned }: PermissionSetCloneDialogProps) {
  const t = (k: string) => translate(k, locale);
  const [name, setName] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  /** The server's refusal, verbatim. */
  const [refusal, setRefusal] = React.useState<string | null>(null);
  /** A refusal naming the name's holders, shown as a pick in place of {@link refusal}. */
  const [conflict, setConflict] = React.useState<PermissionSetHolderConflict | null>(null);
  const ready = name.trim() !== '' && label.trim() !== '';

  /** Send the clone of `fromPackage`'s set — none names the set by its name alone. */
  async function submit(fromPackage: string | undefined) {
    if (!ready || busy) return;
    setBusy(true);
    setRefusal(null);
    setConflict(null);
    try {
      const cloned = await clonePermissionSet(
        source,
        { name: name.trim(), label: label.trim() },
        (status) => tFormat('perm.clone.failedHttp', locale, { status }),
        fromPackage,
      );
      onCloned(cloned);
    } catch (err: unknown) {
      if (err instanceof PermissionSetHolderConflict) setConflict(err);
      else setRefusal(err instanceof Error && err.message ? err.message : t('perm.clone.failed'));
      setBusy(false);
    }
  }

  const pick = (candidate: PermissionSetHolderCandidate) => void submit(candidatePackage(candidate));

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('perm.clone.dialogTitle')}</DialogTitle>
          <DialogDescription>{tFormat('perm.clone.dialogBody', locale, { name: source })}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(sourcePackage);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="perm-clone-name">{t('perm.clone.name')}</Label>
            <Input
              id="perm-clone-name"
              value={name}
              disabled={busy}
              onChange={(e) => {
                setName(e.target.value);
                setRefusal(null);
                setConflict(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="perm-clone-label">{t('perm.clone.label')}</Label>
            <Input
              id="perm-clone-label"
              value={label}
              disabled={busy}
              onChange={(e) => {
                setLabel(e.target.value);
                setRefusal(null);
                setConflict(null);
              }}
            />
          </div>
          {refusal !== null && (
            <p role="alert" className="text-sm text-destructive">
              {refusal}
            </p>
          )}
          {conflict !== null && <PermissionSetHolderPick conflict={conflict} locale={locale} busy={busy} onPick={pick} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('engine.cancel')}
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('perm.clone.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
