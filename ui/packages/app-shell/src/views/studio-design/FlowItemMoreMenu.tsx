// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowItemMoreMenu — the Automations pillar's ⋯ menu on an open flow.
 *
 *  - **New similar** (objectstack#28567, ADR-0146 D4 · Q6): the flow clone
 *    door (`POST /api/v1/automation/<name>/clone`) under a NEW machine name and
 *    label, both mandatory (ADR-0126 §7.1). Offered on a read-only package's
 *    flow and on a writable package's flow alike. The pillar names the target:
 *    none on a read-only base, so the door picks the paired `<base>.custom`;
 *    the open package on a writable one. The door's answer names where the copy
 *    landed (`data.packageId`) and carries its sentence that the copy is
 *    switched off (`data.notice`); both go to the pillar as sent. A refusal (a
 *    `409` for a taken name included) is the server's sentence, verbatim, and
 *    the dialog stays open on it. No lineage is drawn (ADR-0126 §9): nothing
 *    here says what the copy was made from.
 *  - **Delete flow** (#27356 row 19, maintainer-ruled A1; Studio had no
 *    delete, objectui#12725), a writable package's flow only. The confirmation
 *    is Setup's: the in-app dialog naming the flow by its label and
 *    `type/name` (objectui#13333). The pillar sends the delete itself. Reset
 *    overlay is not offered: it arrives with the overlay editing of the
 *    Studio / Setup boundary record's phase 2 (#28045).
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
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
} from '@object-ui/components';
import { actionErrorDetail } from '@object-ui/core';
import { Copy, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { t, tFormat, translateMetadataType } from '../metadata-admin/i18n.js';
import { envelopeData, envelopeRefused } from '../setup/packagedFlows.js';
import { apiBase } from '../../utils/apiBase.js';
import { STUDIO_HEADER_ICON_BUTTON } from './studio-tokens.js';

/** What the clone door saved: the copy's name, the package it names, and its sentence. */
export interface FlowCopied {
  name: string;
  /** `data.packageId` as sent; `null` when the answer named none. */
  packageId: string | null;
  /** `data.notice`, verbatim (the copy is switched off); `''` when none was sent. */
  notice: string;
}

/** The clone door's answer: the copy, or its refusal verbatim. */
type FlowNewSimilarOutcome = { ok: true; copy: FlowCopied } | { ok: false; message: string };

/**
 * `POST /automation/<name>/clone` with EXACTLY the members the clone body
 * declares (`CloneFlowRequestSchema`, closed): `name`, `label`, and `package`
 * only when the pillar names a target. Never throws: a refusal comes back as
 * the server's sentence, read by `actionErrorDetail` like the toggle door's.
 */
async function requestFlowNewSimilar(
  source: string,
  body: { name: string; label: string; package?: string },
  fallbacks: { http: (status: number) => string; network: string },
): Promise<FlowNewSimilarOutcome> {
  try {
    const res = await fetch(`${apiBase()}/automation/${encodeURIComponent(source)}/clone`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body.package ? body : { name: body.name, label: body.label }),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok || envelopeRefused(json)) {
      return { ok: false, message: actionErrorDetail(json, fallbacks.http(res.status)) };
    }
    const data = envelopeData(json);
    const flowName = (data.flow as { name?: unknown } | undefined)?.name;
    return {
      ok: true,
      copy: {
        name: typeof flowName === 'string' && flowName ? flowName : body.name,
        packageId: typeof data.packageId === 'string' && data.packageId !== '' ? data.packageId : null,
        notice: typeof data.notice === 'string' ? data.notice : '',
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.message ? e.message : fallbacks.network };
  }
}

/** The "New similar" item's wiring, from the pillar. */
export interface FlowNewSimilarProps {
  /** The package the copy is sent to; `undefined` sends none (a read-only base: the door picks the pair). */
  target?: string;
  /** Why the item is disabled, in the console's words; `null` when it is live. */
  blocked: string | null;
  /** Asked before the dialog opens (a held edit the copy's opening would drop); `false` keeps it shut. */
  confirmOpen?: () => boolean;
  /** The door saved the copy. */
  onCopied: (copy: FlowCopied) => void;
}

interface NewSimilarDraft {
  name: string;
  label: string;
  busy: boolean;
  refusal: string | null;
}

/**
 * `label` is the flow's display label; `disabled` holds the menu's actions
 * while a save is in flight. `onDelete` draws Delete flow (a writable
 * package's flow); `newSimilar` draws New similar.
 */
export function FlowItemMoreMenu({ name, label, locale, disabled, onDelete, newSimilar }: {
  name: string;
  label: string;
  locale: string;
  disabled?: boolean;
  onDelete?: () => void;
  newSimilar?: FlowNewSimilarProps;
}): React.ReactElement {
  const [confirming, setConfirming] = React.useState(false);
  const [copy, setCopy] = React.useState<NewSimilarDraft | null>(null);
  const vars = { type: 'flow', name, typeLabel: translateMetadataType('flow', locale), item: label || name };
  const copyValid = !!copy && copy.name.trim() !== '' && copy.label.trim() !== '';

  const openNewSimilar = () => {
    if (newSimilar?.confirmOpen && !newSimilar.confirmOpen()) return;
    // Opens on a submittable default, both fields editable, as Setup's clone
    // dialog does (objectui#13344): `<source>_copy` keeps the source's machine
    // name shape. The server stays the judge of a taken name.
    setCopy({
      name: `${name}_copy`,
      label: tFormat('engine.studio.auto.newSimilar.copyLabel', locale, { label: label || name }),
      busy: false,
      refusal: null,
    });
  };

  const submit = async (draft: NewSimilarDraft) => {
    if (!newSimilar) return;
    setCopy({ ...draft, busy: true, refusal: null });
    const outcome = await requestFlowNewSimilar(
      name,
      { name: draft.name.trim(), label: draft.label.trim(), ...(newSimilar.target ? { package: newSimilar.target } : {}) },
      {
        http: (status) => tFormat('engine.studio.auto.newSimilar.failedHttp', locale, { status }),
        network: t('engine.studio.auto.newSimilar.failed', locale),
      },
    );
    if (!outcome.ok) {
      // VERBATIM, and the dialog stays open on the names the admin typed.
      setCopy({ ...draft, busy: false, refusal: outcome.message });
      return;
    }
    setCopy(null);
    newSimilar.onCopied(outcome.copy);
  };

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
        <DropdownMenuContent align="end" className="w-52">
          {newSimilar && (
            <DropdownMenuItem
              data-testid="auto-item-new-similar"
              disabled={disabled || newSimilar.blocked !== null}
              title={newSimilar.blocked ?? t('engine.studio.auto.newSimilar.hint', locale)}
              onSelect={openNewSimilar}
            >
              <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              {t('engine.studio.auto.newSimilar.action', locale)}
            </DropdownMenuItem>
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
      {onDelete && (
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
      )}
      {newSimilar && (
        <Dialog open={!!copy} onOpenChange={(open: boolean) => !open && !copy?.busy && setCopy(null)}>
          <DialogContent data-testid="auto-new-similar-dialog">
            <DialogHeader>
              <DialogTitle>{t('engine.studio.auto.newSimilar.title', locale)}</DialogTitle>
              <DialogDescription>
                {tFormat(
                  newSimilar.target ? 'engine.studio.auto.newSimilar.bodyHere' : 'engine.studio.auto.newSimilar.bodyPair',
                  locale,
                  { item: label || name },
                )}
              </DialogDescription>
            </DialogHeader>
            {copy && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="auto-new-similar-name">{t('engine.studio.auto.newSimilar.name', locale)}</Label>
                  <Input
                    id="auto-new-similar-name"
                    data-testid="auto-new-similar-name"
                    value={copy.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCopy({ ...copy, name: e.target.value, refusal: null })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="auto-new-similar-label">{t('engine.studio.auto.newSimilar.label', locale)}</Label>
                  <Input
                    id="auto-new-similar-label"
                    data-testid="auto-new-similar-label"
                    value={copy.label}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCopy({ ...copy, label: e.target.value, refusal: null })}
                  />
                </div>
                {copy.refusal && (
                  <p role="alert" data-testid="auto-new-similar-refusal" className="text-sm text-destructive">
                    {copy.refusal}
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={!!copy?.busy} onClick={() => setCopy(null)}>
                {t('engine.cancel', locale)}
              </Button>
              <Button
                type="button"
                data-testid="auto-new-similar-submit"
                disabled={!copyValid || !!copy?.busy}
                onClick={() => copy && void submit(copy)}
              >
                {copy?.busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('engine.studio.auto.newSimilar.submit', locale)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
