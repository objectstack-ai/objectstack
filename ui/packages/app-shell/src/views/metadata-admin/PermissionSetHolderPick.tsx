// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32537 — the pick a door's refusal of a permission-set name
 * becomes (`permission-set-holder.ts`): the server's sentence, then one
 * button per holder it named. Choosing one sends the request again with that
 * holder's package; ⛔ nothing is chosen for the administrator, by order or
 * otherwise. Built from the generic primitives only.
 *
 * Two faces: {@link PermissionSetHolderPick}, inline (the clone dialog shows it
 * in place of its refusal line), and {@link PermissionSetHolderPickDialog}, a
 * confirm-style dialog for a control with no room of its own (an active
 * switch).
 */

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@object-ui/components';
import { t, tFormat } from './i18n.js';
import type { PermissionSetHolderCandidate, PermissionSetHolderConflict } from './permission-set-holder.js';

function candidateKey(candidate: PermissionSetHolderCandidate): string {
  return candidate.kind === 'package' ? candidate.packageId : 'environment';
}

function candidateLabel(candidate: PermissionSetHolderCandidate, locale: string): string {
  return candidate.kind === 'package'
    ? tFormat('perm.holder.pick.package', locale, { package: candidate.packageId })
    : t('perm.holder.pick.environment', locale);
}

function CandidateButtons({
  candidates,
  locale,
  busy,
  onPick,
}: {
  candidates: readonly PermissionSetHolderCandidate[];
  locale: string;
  busy: boolean;
  onPick: (candidate: PermissionSetHolderCandidate) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {candidates.map((candidate) => (
        <Button
          key={candidateKey(candidate)}
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onPick(candidate)}
          data-testid={`perm-holder-pick-${candidateKey(candidate)}`}
        >
          {candidateLabel(candidate, locale)}
        </Button>
      ))}
    </div>
  );
}

/** The inline pick: the refusal in the server's words, the hint, a button per holder. */
export function PermissionSetHolderPick({
  conflict,
  locale,
  busy = false,
  onPick,
}: {
  conflict: PermissionSetHolderConflict;
  locale: string;
  busy?: boolean;
  onPick: (candidate: PermissionSetHolderCandidate) => void;
}) {
  return (
    <div role="group" data-testid="perm-holder-pick" className="space-y-2 rounded-md border p-3 text-sm">
      <p role="alert" className="text-destructive">
        {conflict.message}
      </p>
      <p className="text-xs text-muted-foreground">{t('perm.holder.pick.hint', locale)}</p>
      <CandidateButtons candidates={conflict.candidates} locale={locale} busy={busy} onPick={onPick} />
    </div>
  );
}

/** A refused switch waiting on the administrator's pick: the item, and the refusal. */
export interface PendingHolderPick {
  name: string;
  /** The item's label for the title; its name when it has none. */
  label: string;
  conflict: PermissionSetHolderConflict;
}

/** The dialog face, for a control with no room for the pick beside it. Cancel sends nothing. */
export function PermissionSetHolderPickDialog({
  pending,
  locale,
  busy = false,
  onPick,
  onCancel,
}: {
  pending: PendingHolderPick | null;
  locale: string;
  busy?: boolean;
  onPick: (candidate: PermissionSetHolderCandidate) => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent data-testid="perm-holder-pick-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{tFormat('perm.holder.pick.title', locale, { name: pending?.label ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.conflict.message ?? ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-xs text-muted-foreground">{t('perm.holder.pick.hint', locale)}</p>
        {pending && <CandidateButtons candidates={pending.conflict.candidates} locale={locale} busy={busy} onPick={onPick} />}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="perm-holder-pick-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
