// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — optimistic concurrency for Studio's metadata DRAFT saves.
 *
 * Two editors of one metadata item (two admins, or one admin in two tabs) used
 * to overwrite each other's drafts in silence: every draft save was a
 * whole-document last-writer-wins PUT, because no save sent the version it was
 * built on. The `/meta` PUT door honours ADR-0008's precondition on a
 * `?mode=draft` write, and `MetadataClient.save` sends it from its options:
 * `ifMatch` as `If-Match`, `ifNoneMatch` as `If-None-Match: *`.
 *
 * ## What the door serves and refuses (`@objectstack/*` 18, measured)
 *
 * Read off the spec this package installs (`GetMetaItemResponseSchema`,
 * `MetadataConflictErrorSchema`) and measured against the published server of
 * the same release (the readings are on the pull request):
 *
 *  - The draft READ (`GET …?state=draft&package=P`) serves `version`: the token
 *    of the draft row a draft save at the SAME address (`?package=P`) compares
 *    against, or `null` when that address holds none. With no draft at all it
 *    answers 404, which `getDraft` resolves as `null`.
 *  - ⚠️ The address is the read's, not the served row's. A read that names no
 *    package serves a package-bound draft's body and `version: null`, so its
 *    answer says nothing about a save that names the package. A load therefore
 *    reads at the address its saves write ({@link readDraftForSave}).
 *  - A draft SAVE answers `{ success, version, seq, state, message }`; that
 *    `version` is the same token the next read serves.
 *  - `If-Match: <token>` that is not the current draft's token, and
 *    `If-None-Match: *` while a draft row exists, are refused
 *    `409 METADATA_CONFLICT`, whose body carries the current token as
 *    `currentVersion` (`null` when no draft row is there). The pair together is
 *    refused 400.
 *  - `409 DESTRUCTIVE_CHANGE` is a different refusal, judged BEFORE the version;
 *    it is passed through untouched to the caller's own flow.
 *
 * ## One guard per editing buffer
 *
 * The pin a guard holds describes the buffer it saves, so a guard belongs to
 * ONE buffer — never to an item globally. Two surfaces in one tab that each
 * hold their own copy of the same item are two editors: sharing one pin between
 * them would let the second one's stale copy through. The rules:
 *
 *  1. A draft save sends the pin this guard holds for that same item (type,
 *     name, package) — `If-Match` with a version, or `If-None-Match: *` for "no
 *     draft row" — and nothing otherwise. Never both.
 *  2. A save that lands holds the receipt's `version`.
 *  3. A buffer installed from a load holds what that load's draft read says
 *     ({@link draftPinOf}): the caller calls `recordRead` with the pin
 *     {@link readDraftForSave} returned, where it installs the buffer. A read
 *     that failed, or a server that serves no `version`, pins nothing; a buffer
 *     installed with no draft read behind it (a reset, a discard) holds nothing
 *     either: the caller says so with `forget()`. A read-back of the guard's
 *     OWN save is not an install.
 *     A draft read REFUSED `403` is not a failure that says nothing: a draft
 *     row is there that this session may not read (its audience gate,
 *     `requiredPermissions`, names a capability the author does not hold).
 *     {@link readDraftForSave} hands that refusal back as `refused`, and a load
 *     that sees it installs no buffer: one seeded from the published layer
 *     would be saved over the draft it never read.
 *  4. A `409 METADATA_CONFLICT` opens the conflict dialog: reload the saved
 *     version (the caller's reload runs; the buffer is replaced), overwrite it
 *     after a confirmation (re-sent pinned to the refusal's `currentVersion`,
 *     parsed by the spec's `MetadataConflictErrorSchema`, so a third save that
 *     lands in between is refused again rather than overwritten), or keep
 *     editing (nothing is saved, and the stale pin is kept so the next save is
 *     refused again rather than slipping through).
 *  5. Saves through one guard run one at a time, so each sends the version the
 *     previous one received and an autosave never conflicts with the save the
 *     same buffer sent a moment earlier.
 *
 * A create, with nothing read, calls the client directly with
 * `ifNoneMatch: '*'`: the door refuses it when the name already holds a draft,
 * instead of writing the new skeleton over it.
 *
 * ## The published layer (objectstack#36601)
 *
 * A Studio Save is a draft save and then that one item's publish, so it leaves
 * no draft behind, and a draft pin alone cannot tell two editors apart: each
 * opened the item with no draft, each asserts none, and the later Save used to
 * publish over the earlier one. The guard therefore also holds the PUBLISHED
 * layer's version for the same buffer:
 *
 *  6. A load records what its `/layers` read served as `overlayVersion`
 *     ({@link publishedPinOf}) with `recordPublished`: a token pins the publish
 *     `If-Match`, a served `null` (no published row) `If-None-Match: *`, and a
 *     server that serves no `overlayVersion` pins nothing — the publish goes
 *     unpinned, as before.
 *  7. {@link DraftVersionGuard.publish} sends that pin; a publish that lands
 *     holds its receipt's `version`, the published row it left.
 *  8. A `409 METADATA_CONFLICT` on the publish opens the same dialog, worded for
 *     a live change: reload (the caller's `beforeReload` runs first, so the
 *     draft the Save just wrote is taken back before the buffer is re-read),
 *     overwrite after the confirmation (re-sent pinned to the refusal's
 *     `currentVersion`), or keep editing (nothing goes live).
 *  9. objectstack#36726 — a reload whose `beforeReload` leaves a draft pending
 *     (`'kept'`: one that was there before the Save, a copilot's, which the
 *     Save wrote into and never discards) re-reads THAT draft, now carrying
 *     the page's edits. Its publish stays pinned to the version the conflict
 *     was raised on until the author re-confirms: the next Save is refused and
 *     asked again, and only an overwrite, a publish that lands, or a load that
 *     reads no pending draft (the buffer is then the live row) takes the
 *     fresh read's pin. A reload over a discarded draft re-reads the live row
 *     and is pinned to it at once, as before.
 * 10. objectstack#37440 — the Save's publish is also pinned to the DRAFT it
 *     promotes when its caller passes `draftVersion`: the version its own
 *     draft save's receipt returned (`heldDraftVersion` right after a guarded
 *     save), ⛔ never a fresh re-read, which would pin another writer's draft.
 *     A draft another writer changed in between is refused
 *     `409 METADATA_CONFLICT` and nothing is published. That refusal carries
 *     the same code as the published row's (rule 8) and does not say which
 *     pin refused, so the guard reads the draft at the address once: still
 *     the pinned version, the live row moved and rule 8 asks; moved, gone, or
 *     unreadable, the refusal is the draft's, nothing is asked, and it is
 *     thrown marked ({@link isPublishDraftMoved}): the caller ⛔ never
 *     discards that draft — it now holds the other writer's change — and the
 *     next Save's draft write, still pinned to the old receipt, is refused and
 *     asked about by rule 4.
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  buttonVariants,
  cn,
} from '@object-ui/components';
import type { MetadataClient } from '@object-ui/data-objectstack';
import { t, tFormat, translateMetadataType, useMetadataLocale } from './i18n.js';

export {
  isPublishConflictKeptEditing,
  isPublishDraftMoved,
  isDraftVersionConflict,
  draftReceiptVersion,
  draftPinOf,
  publishedPinOf,
  isDraftReadRefused,
  readDraftForSave,
  DraftVersionGuard,
  heldDraftVersionOf,
  type BeforeReloadOutcome,
  type DraftSaveOutcome,
  type DraftConflictChoice,
  type DraftConflict,
  type DraftPin,
  type DraftReadForSave,
  type DraftVersionGuardDeps,
  type DraftSaveGuard,
} from './draftVersionGuard.js';
import { DraftVersionGuard, heldDraftVersionOf, type DraftConflict, type DraftConflictChoice, type DraftSaveGuard } from './draftVersionGuard.js';

/**
 * One guard for one editing buffer. `onReload` replaces the buffer with the
 * saved version — the caller's own load, re-run.
 */
export function useDraftSaveGuard(client: Pick<MetadataClient, 'save'>, onReload: () => void): DraftSaveGuard {
  const locale = useMetadataLocale();
  const [pending, setPending] = React.useState<{
    conflict: DraftConflict;
    resolve: (choice: DraftConflictChoice) => void;
  } | null>(null);
  const notSavedIn = (lang: string) => (conflict: DraftConflict) =>
    new Error(
      tFormat('engine.draftConflict.notSaved', lang, {
        type: translateMetadataType(conflict.type, lang),
        name: conflict.name,
      }),
    );
  // A state initializer, not a memo: the guard and the version it holds must
  // outlive any render (AGENTS.md #10). Its per-render inputs are re-bound
  // below, after every commit.
  const [guard] = React.useState(
    () =>
      new DraftVersionGuard({
        client: () => client,
        ask: (conflict) =>
          new Promise<DraftConflictChoice>((resolve) => {
            setPending({ conflict, resolve });
          }),
        reload: onReload,
        notSaved: notSavedIn(locale),
      }),
  );
  React.useLayoutEffect(() => {
    guard.bind({ client: () => client, reload: onReload, notSaved: notSavedIn(locale) });
  });
  // objectstack#37440 — one function for the guard's life, as the guard's own
  // members are: a Save callback may name it among its dependencies.
  const [heldDraftVersion] = React.useState(() => heldDraftVersionOf(guard));
  // A dialog left open by an unmount answers "keep editing": nothing is sent.
  const pendingRef = React.useRef(pending);
  React.useLayoutEffect(() => {
    pendingRef.current = pending;
  });
  React.useEffect(() => () => pendingRef.current?.resolve('cancel'), []);
  const choose = React.useCallback((choice: DraftConflictChoice) => {
    const asked = pendingRef.current;
    setPending(null);
    asked?.resolve(choice);
  }, []);
  return {
    save: guard.save,
    recordRead: guard.recordRead,
    forget: guard.forget,
    recordPublished: guard.recordPublished,
    publish: guard.publish,
    heldDraftVersion,
    dialog: <DraftConflictDialog conflict={pending?.conflict ?? null} onChoose={choose} />,
  };
}

export interface DraftConflictDialogProps {
  /** The refused save's item; `null` keeps the dialog closed. */
  conflict: DraftConflict | null;
  onChoose: (choice: DraftConflictChoice) => void;
}

/**
 * Tells the author their draft save was refused because the draft changed
 * since they loaded it, and offers the two ruled ways out: reload the saved
 * version, or overwrite it with this buffer after a second, explicit
 * confirmation. Closing it keeps the author's edits on screen, unsaved.
 */
export function DraftConflictDialog({ conflict, onChoose }: DraftConflictDialogProps): React.ReactElement {
  const locale = useMetadataLocale();
  const [confirming, setConfirming] = React.useState(false);
  const open = conflict !== null;
  // Every way out lands the next conflict on the first step again.
  const finish = (choice: DraftConflictChoice): void => {
    setConfirming(false);
    onChoose(choice);
  };
  const vars = {
    type: conflict ? translateMetadataType(conflict.type, locale) : '',
    name: conflict?.name ?? '',
  };
  // objectstack#36601 — a live change is worded as one; the choices are the same.
  const live = conflict?.layer === 'published';
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish('cancel');
      }}
    >
      <AlertDialogContent data-testid="draft-conflict-dialog">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <span
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
              aria-hidden="true"
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <AlertDialogTitle>
                {confirming
                  ? t(live ? 'engine.draftConflict.publishedOverwriteTitle' : 'engine.draftConflict.overwriteTitle', locale)
                  : t(live ? 'engine.draftConflict.publishedTitle' : 'engine.draftConflict.title', locale)}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-1">
                {confirming
                  ? tFormat(
                      live ? 'engine.draftConflict.publishedOverwriteDescription' : 'engine.draftConflict.overwriteDescription',
                      locale,
                      vars,
                    )
                  : tFormat(live ? 'engine.draftConflict.publishedDescription' : 'engine.draftConflict.description', locale, vars)}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                data-testid="draft-conflict-back"
                onClick={() => setConfirming(false)}
                className={cn(buttonVariants({ variant: 'ghost' }), 'mt-2 sm:mt-0')}
              >
                {t('engine.draftConflict.back', locale)}
              </button>
              <button
                type="button"
                data-testid="draft-conflict-overwrite-confirm"
                onClick={() => finish('overwrite')}
                className={cn(buttonVariants({ variant: 'destructive' }), 'mt-2 sm:mt-0')}
              >
                {t('engine.draftConflict.overwriteConfirm', locale)}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="draft-conflict-cancel"
                onClick={() => finish('cancel')}
                className={cn(buttonVariants({ variant: 'ghost' }), 'mt-2 sm:mt-0')}
              >
                {t('engine.draftConflict.keepEditing', locale)}
              </button>
              <button
                type="button"
                data-testid="draft-conflict-overwrite"
                onClick={() => setConfirming(true)}
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'mt-2 sm:mt-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive',
                )}
              >
                {t('engine.draftConflict.overwrite', locale)}
              </button>
              <button
                type="button"
                data-testid="draft-conflict-reload"
                onClick={() => finish('reload')}
                className={cn(buttonVariants({ variant: 'default' }), 'mt-2 sm:mt-0')}
              >
                {t('engine.draftConflict.reload', locale)}
              </button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
