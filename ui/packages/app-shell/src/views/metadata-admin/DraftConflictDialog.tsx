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
import type { MetadataClient, MetadataClientSaveOptions } from '@object-ui/data-objectstack';
import { GetMetaItemLayeredResponseSchema, GetMetaItemResponseSchema, MetadataConflictErrorSchema } from '@objectstack/spec/api';
import { errorCodeIs } from '@object-ui/types';
import { t, tFormat, translateMetadataType, useMetadataLocale } from './i18n.js';

/** What a guarded save ended in, when it did not throw. */
export type DraftSaveOutcome = 'saved' | 'reloaded';

/** The author's answer to a conflict. */
export type DraftConflictChoice = 'reload' | 'overwrite' | 'cancel';

/** The item a refused save addressed. */
export interface DraftConflict {
  type: string;
  name: string;
  /**
   * objectstack#36601 — which layer moved: the draft (the draft save was
   * refused, the default) or the published row (the Save's publish was).
   */
  layer?: 'draft' | 'published';
}

const KEPT_EDITING = new WeakSet<object>();

/**
 * objectstack#36601 — `err` is the "not saved" error the guarded publish
 * throws when the author, asked about a published row that moved, chose to
 * keep editing: no request failed, so the caller shows it as the draft
 * conflict's own "not saved" line, never as a refused publish.
 */
export function isPublishConflictKeptEditing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && KEPT_EDITING.has(err);
}

/**
 * The version-conflict refusal of the `/meta` draft door, told apart from the
 * door's OTHER 409 (`DESTRUCTIVE_CHANGE`) by its code, never by its prose.
 */
export function isDraftVersionConflict(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 409 && errorCodeIs(err, 'METADATA_CONFLICT');
}

/**
 * The precondition a guarded draft save is sent with: exactly one of the two
 * headers, by construction never both.
 */
export type DraftPin = { readonly ifMatch: string } | { readonly ifNoneMatch: '*' };

/**
 * A served `version` — a token, or `null` for "no row at this address" — as the
 * pin a save to that address sends. An empty token pins nothing: the client
 * sends no `If-Match` for it.
 */
function pinOfVersion(version: string | null): DraftPin | null {
  if (version === null) return { ifNoneMatch: '*' };
  return version.length > 0 ? { ifMatch: version } : null;
}

/**
 * What a load's DRAFT read (`MetadataClient.getDraft`, at the address the
 * buffer's saves write) says the next draft save is pinned with:
 *
 *  - `null` — no pending draft (the drafts ledger lists none, or the read
 *    answered 404 `NO_DRAFT`): `If-None-Match: *`;
 *  - the envelope's `version`, read through `GetMetaItemResponseSchema`'s own
 *    member: a token pins `If-Match`, a served `null` pins `If-None-Match: *`;
 *  - an envelope that carries no `version` (a server from before the read
 *    served one) pins nothing, and the save goes unpinned as it always did.
 */
export function draftPinOf(answer: unknown): DraftPin | null {
  if (answer === null) return { ifNoneMatch: '*' };
  if (!answer || typeof answer !== 'object' || !('version' in answer)) return null;
  const version = GetMetaItemResponseSchema.shape.version.safeParse((answer as { version: unknown }).version);
  return version.success && version.data !== undefined ? pinOfVersion(version.data) : null;
}

/**
 * objectstack#36601 — what a load's `/layers` read (`MetadataClient.layered`,
 * at the address the buffer's publish writes) says the Save's publish is
 * pinned with: its `overlayVersion`, read through
 * `GetMetaItemLayeredResponseSchema`'s own member — a token pins `If-Match`, a
 * served `null` (no published row there) pins `If-None-Match: *`. An answer
 * that carries no `overlayVersion` (a server from before it was served) pins
 * nothing, and the publish goes unpinned as it always did.
 */
export function publishedPinOf(layered: unknown): DraftPin | null {
  if (!layered || typeof layered !== 'object' || !('overlayVersion' in layered)) return null;
  const version = GetMetaItemLayeredResponseSchema.shape.overlayVersion.safeParse(
    (layered as { overlayVersion: unknown }).overlayVersion,
  );
  return version.success && version.data !== undefined ? pinOfVersion(version.data) : null;
}

/**
 * The pin an "overwrite" re-sends with: the refused save's `currentVersion`,
 * parsed by the spec's `MetadataConflictErrorSchema` off the body the client
 * kept. A body that does not carry one (a server from before the field)
 * pins nothing, and the overwrite is sent unpinned, as it was before.
 */
function pinOfConflict(err: unknown): DraftPin | null {
  const body = MetadataConflictErrorSchema.safeParse((err as { body?: unknown } | null | undefined)?.body);
  return body.success ? pinOfVersion(body.data.currentVersion) : null;
}

/**
 * Whether a draft read was REFUSED for this session (`403`): the read reached
 * a draft row and the server withheld it, so the row exists and its body is
 * not this session's to hold. Told apart by status, never by prose.
 */
export function isDraftReadRefused(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 403;
}

/** What {@link readDraftForSave} answers. */
export interface DraftReadForSave<T> {
  /** The served draft envelope, or `null`: no pending draft, or a read that failed. */
  answer: T | null;
  /** The pin the next draft save at the read's address is sent with. */
  pin: DraftPin | null;
  /**
   * The server's refusal, present only when the read was refused `403`
   * ({@link isDraftReadRefused}). `answer` is then `null` although a draft is
   * pending: a load that sees `refused` installs no buffer, because one seeded
   * from the published layer would be saved over the draft it never read.
   */
  refused?: unknown;
}

/**
 * A load's draft read at `packageId` — the address the buffer's draft saves
 * write — with the pin it serves for that address. Read and pin come from one
 * call so a load cannot pin a save to a read of another address (see the
 * module header). A read that fails resolves `answer: null`, as the loads'
 * `.catch(() => null)` always did, and pins nothing: a failure says nothing
 * about the row. A read refused `403` says the row is there and withheld, and
 * carries the refusal as `refused`. Record the pin with `recordRead` where the
 * buffer is installed, not here: a load that is cancelled installs nothing.
 */
export async function readDraftForSave<T = unknown>(
  client: Pick<MetadataClient, 'getDraft'>,
  type: string,
  name: string,
  packageId: string | null | undefined,
  // objectstack#26649 — the bundle member whose draft this is; omitted, the
  // canonical member's. The save it pins is addressed by its body's member.
  member?: string,
): Promise<DraftReadForSave<T>> {
  try {
    const answer = await client.getDraft<T>(type, name, {
      ...(packageId ? { packageId } : {}),
      ...(member ? { member } : {}),
    });
    return { answer, pin: draftPinOf(answer) };
  } catch (err) {
    return isDraftReadRefused(err) ? { answer: null, pin: null, refused: err } : { answer: null, pin: null };
  }
}

function itemKey(type: string, name: string, packageId: string | null | undefined): string {
  return JSON.stringify([type, name, packageId ?? null]);
}

function receiptVersion(receipt: unknown): string | null {
  const version = (receipt as { version?: unknown } | null | undefined)?.version;
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/** `options` sent with `pin` in place of whatever precondition they carried. */
function pinned(options: MetadataClientSaveOptions, pin: DraftPin | null): MetadataClientSaveOptions {
  if (!pin) return options;
  const { ifMatch: _ifMatch, ifNoneMatch: _ifNoneMatch, ...rest } = options;
  return { ...rest, ...pin };
}

export interface DraftVersionGuardDeps {
  /** The client to save through, read at the moment of the save. */
  client: () => Pick<MetadataClient, 'save'>;
  /** Ask the author how to resolve a conflict. */
  ask: (conflict: DraftConflict) => Promise<DraftConflictChoice>;
  /** Replace the buffer with the saved version (the caller's load). */
  reload: () => void;
  /** The error a save the author chose not to send ends in. */
  notSaved: (conflict: DraftConflict) => Error;
}

/**
 * The React-free half of the guard: the pins held for one buffer, the
 * one-at-a-time queue, and the conflict branch. {@link useDraftSaveGuard} binds
 * it to a client, a dialog and the caller's reload.
 */
export class DraftVersionGuard {
  /**
   * The pin held per item (type, name, package) this buffer saves. One entry in
   * the usual case; a surface whose one buffer switches between items (the
   * hook panel) keeps each item's own.
   */
  private readonly held = new Map<string, DraftPin>();
  /** objectstack#36601 — the published layer's pin per item, for the Save's publish (rules 6–8). */
  private readonly published = new Map<string, DraftPin>();
  private tail: Promise<void> | null = null;
  /** Bumped by a reload: a save queued before it carries the replaced buffer. */
  private epoch = 0;

  constructor(private deps: DraftVersionGuardDeps) {}

  /** Re-bind inputs that change between renders (the client, the reload, the locale's text). */
  bind(deps: Pick<DraftVersionGuardDeps, 'client' | 'reload' | 'notSaved'>): void {
    this.deps = { ...this.deps, ...deps };
  }

  /** The pin held, for the item `save` would address (tests read it). */
  heldFor(type: string, name: string, packageId?: string | null): DraftPin | null {
    return this.held.get(itemKey(type, name, packageId)) ?? null;
  }

  /** The published pin held, for the item `publish` would address (tests read it). */
  publishedFor(type: string, name: string, packageId?: string | null): DraftPin | null {
    return this.published.get(itemKey(type, name, packageId)) ?? null;
  }

  /** The buffer was installed with no draft read behind it: nothing describes it. */
  forget = (): void => {
    this.held.clear();
    this.published.clear();
  };

  /**
   * objectstack#36601 — the buffer was installed from a load whose `/layers`
   * read, at the address the buffer's publish writes, served `pin`
   * ({@link publishedPinOf}). `null` pins nothing.
   */
  recordPublished = (type: string, name: string, packageId: string | null | undefined, pin: DraftPin | null): void => {
    const key = itemKey(type, name, packageId);
    if (pin) this.published.set(key, pin);
    else this.published.delete(key);
  };

  /**
   * objectstack#36601 — the Save's publish of the draft it just wrote, pinned
   * to the published version this buffer holds (rules 6–8 above). Resolves
   * `'published'`, or `'reloaded'` when the author chose to reload after a
   * conflict (`beforeReload` has run, then the caller's reload); throws the
   * client's error otherwise, and the guard's "not saved" error when the
   * author kept editing.
   */
  publish = async (
    client: Pick<MetadataClient, 'publish'>,
    type: string,
    name: string,
    options: { packageId?: string; member?: string } = {},
    beforeReload?: () => Promise<void>,
  ): Promise<'published' | 'reloaded'> => {
    const key = itemKey(type, name, options.packageId);
    let pin = this.published.get(key) ?? null;
    for (;;) {
      try {
        const receipt = await client.publish(type, name, { ...options, ...(pin ?? {}) });
        const version = receiptVersion(receipt);
        if (version) this.published.set(key, { ifMatch: version });
        else this.published.delete(key);
        return 'published';
      } catch (err) {
        if (!isDraftVersionConflict(err)) throw err;
        const conflict: DraftConflict = { type, name, layer: 'published' };
        const choice = await this.deps.ask(conflict);
        if (choice === 'reload') {
          // A `beforeReload` that throws (its draft could not be taken back)
          // stops the reload here: nothing is re-read and the pins stay, so
          // the next Save is asked about again (contract review S2).
          await beforeReload?.();
          this.held.clear();
          this.published.clear();
          this.epoch += 1;
          this.deps.reload();
          return 'reloaded';
        }
        if (choice !== 'overwrite') {
          const kept = this.deps.notSaved(conflict);
          KEPT_EDITING.add(kept);
          throw kept;
        }
        // As for a draft: the re-send is pinned to the version the refusal
        // names, so a publish landing in between is asked about again.
        pin = pinOfConflict(err);
        if (pin) this.published.set(key, pin);
        else this.published.delete(key);
      }
    }
  };

  /**
   * The buffer was installed from a load whose draft read, at the address the
   * buffer's saves write (`type`, `name`, `packageId`), served `pin` — what
   * {@link readDraftForSave} returned. `null` pins nothing, as `forget()`.
   */
  recordRead = (type: string, name: string, packageId: string | null | undefined, pin: DraftPin | null): void => {
    this.pin(itemKey(type, name, packageId), pin);
  };

  /**
   * Save `item` through the client. A non-draft save (no `mode: 'draft'`) is
   * passed straight through: the guard pins drafts only.
   */
  save = (
    type: string,
    name: string,
    item: unknown,
    options: MetadataClientSaveOptions = {},
  ): Promise<DraftSaveOutcome> => {
    if (options.mode !== 'draft') {
      return this.deps.client().save(type, name, item, options).then(() => 'saved' as const);
    }
    const epoch = this.epoch;
    const run = (): Promise<DraftSaveOutcome> => this.run(epoch, type, name, item, options);
    // Started at once when nothing is in flight, so the request leaves in the
    // same tick as before; queued behind the save in flight otherwise.
    const result = this.tail ? this.tail.then(run) : run();
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.tail = settled;
    void settled.then(() => {
      if (this.tail === settled) this.tail = null;
    });
    return result;
  };

  private async run(
    epoch: number,
    type: string,
    name: string,
    item: unknown,
    options: MetadataClientSaveOptions,
  ): Promise<DraftSaveOutcome> {
    // The author chose to reload while this save waited: its buffer is gone.
    if (epoch !== this.epoch) return 'reloaded';
    const key = itemKey(type, name, options.packageId);
    let pin = this.held.get(key) ?? null;
    const client = this.deps.client();
    for (;;) {
      try {
        const receipt = await client.save(type, name, item, pinned(options, pin));
        this.hold(key, receipt);
        return 'saved';
      } catch (err) {
        if (!isDraftVersionConflict(err)) throw err;
        const conflict: DraftConflict = { type, name };
        const choice = await this.deps.ask(conflict);
        if (choice === 'reload') {
          this.held.clear();
          this.published.clear();
          this.epoch += 1;
          this.deps.reload();
          return 'reloaded';
        }
        if (choice !== 'overwrite') throw this.deps.notSaved(conflict);
        // The author has seen that the draft moved and chose this buffer over
        // the version the refusal names, so the re-send is pinned to THAT
        // version: a save landing between the refusal and the confirmation is
        // refused again and asked about, never overwritten. Held, too, so a
        // refusal of the re-send for another reason (a destructive change the
        // caller confirms) retries over the same version.
        pin = pinOfConflict(err);
        this.pin(key, pin);
      }
    }
  }

  private hold(key: string, receipt: unknown): void {
    const version = receiptVersion(receipt);
    this.pin(key, version ? { ifMatch: version } : null);
  }

  private pin(key: string, pin: DraftPin | null): void {
    if (pin) this.held.set(key, pin);
    else this.held.delete(key);
  }
}

export interface DraftSaveGuard {
  /** A guarded `client.save` — same arguments, resolves what it ended in. */
  save: DraftVersionGuard['save'];
  /** Call where the buffer is installed from a load's draft read (rule 3 above). */
  recordRead: DraftVersionGuard['recordRead'];
  /** Call where the buffer is installed with no draft read behind it (rule 3 above). */
  forget: () => void;
  /** Call where the buffer is installed from a load's `/layers` read (rule 6 above). */
  recordPublished: DraftVersionGuard['recordPublished'];
  /** The Save's pinned publish (rules 7–8 above). */
  publish: DraftVersionGuard['publish'];
  /** The conflict dialog; render it once, anywhere in the caller's tree. */
  dialog: React.ReactElement;
}

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
