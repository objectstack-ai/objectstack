// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The draft-version guard's pure half: the conflict predicates, the pins a
 * load reads, the guarded read and the {@link DraftVersionGuard} itself. The
 * behaviour is specified in `./DraftConflictDialog.tsx`'s header, which
 * re-exports every name here.
 *
 * ⛔ No component and no designer string table here. The running app's save
 * paths that load with a list or record page (a list's view save, the record
 * page's tabs and arrangement saves, the header-pin save) import these;
 * reading them through
 * `DraftConflictDialog.tsx` statically pulled the designer's English
 * catalogue (`@object-ui/i18n/namespaces/studio`, through `./i18n.ts`) into
 * those pages' first load (objectstack#37444). The dialog and
 * `useDraftSaveGuard`, which render and translate, stay there.
 */

import type * as React from 'react';
import type { MetadataClient, MetadataClientSaveOptions } from '@object-ui/data-objectstack';
import { GetMetaItemLayeredResponseSchema, GetMetaItemResponseSchema, MetadataConflictErrorSchema } from '@objectstack/spec/api';
import { errorCodeIs } from '@object-ui/types';

/**
 * objectstack#36726 — what a publish conflict's `beforeReload` left at the
 * item: `'discarded'`, the draft the Save wrote was taken back, so the reload
 * re-reads the live row; `'kept'`, a draft pending before the Save stays (it
 * carries the page's edits), so the reload re-reads that draft (rule 9).
 */
export type BeforeReloadOutcome = 'discarded' | 'kept';

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
  /**
   * objectstack#36726 — rule 9: per item, the published pin a conflict was
   * raised on, held over a reload that re-read a pending draft until the
   * author re-confirms; `fresh` is what the reload's load recorded meanwhile
   * (absent until it has), taken once the item is confirmed.
   */
  private readonly unconfirmed = new Map<string, { pin: DraftPin; fresh?: DraftPin | null }>();
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
    const key = itemKey(type, name, packageId);
    return this.unconfirmed.get(key)?.pin ?? this.published.get(key) ?? null;
  }

  /** The buffer was installed with no draft read behind it: nothing describes it. */
  forget = (): void => {
    this.held.clear();
    this.published.clear();
    this.unconfirmed.clear();
  };

  /**
   * objectstack#36726 — rule 9 ends for the item: its publish takes the pin
   * the last load recorded, if one has since the reload.
   */
  private confirm(key: string): void {
    const entry = this.unconfirmed.get(key);
    if (!entry) return;
    this.unconfirmed.delete(key);
    if (entry.fresh) this.published.set(key, entry.fresh);
    else if (entry.fresh === null) this.published.delete(key);
  }

  /**
   * objectstack#36601 — the buffer was installed from a load whose `/layers`
   * read, at the address the buffer's publish writes, served `pin`
   * ({@link publishedPinOf}). `null` pins nothing.
   */
  recordPublished = (type: string, name: string, packageId: string | null | undefined, pin: DraftPin | null): void => {
    const key = itemKey(type, name, packageId);
    // objectstack#36726 — a reload that re-read a pending draft is not the
    // author's answer to the conflict: the pin it was raised on stays (rule 9).
    const entry = this.unconfirmed.get(key);
    if (entry) {
      entry.fresh = pin;
      return;
    }
    if (pin) this.published.set(key, pin);
    else this.published.delete(key);
  };

  /**
   * objectstack#36601 — the Save's publish of the draft it just wrote, pinned
   * to the published version this buffer holds (rules 6–9 above). Resolves
   * `'published'`, or `'reloaded'` when the author chose to reload after a
   * conflict (`beforeReload` has run, then the caller's reload); throws the
   * client's error otherwise, and the guard's "not saved" error when the
   * author kept editing. `beforeReload` answers what it left at the item
   * ({@link BeforeReloadOutcome}); one that answers nothing is `'discarded'`.
   */
  publish = async (
    client: Pick<MetadataClient, 'publish'>,
    type: string,
    name: string,
    options: { packageId?: string; member?: string } = {},
    beforeReload?: () => Promise<BeforeReloadOutcome | void>,
  ): Promise<'published' | 'reloaded'> => {
    const key = itemKey(type, name, options.packageId);
    let pin = this.unconfirmed.get(key)?.pin ?? this.published.get(key) ?? null;
    for (;;) {
      try {
        const receipt = await client.publish(type, name, { ...options, ...(pin ?? {}) });
        // The publish the author's buffer was built for landed: rule 9 is over for it.
        this.unconfirmed.delete(key);
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
          const left = await beforeReload?.();
          this.held.clear();
          this.published.clear();
          this.epoch += 1;
          // objectstack#36726 — the reload re-reads the pending draft it kept,
          // which carries the page's edits: never pinned to the fresh read's
          // version, so its next Save is refused and asked again (rule 9).
          if (left === 'kept' && pin) this.unconfirmed.set(key, { pin });
          this.deps.reload();
          return 'reloaded';
        }
        if (choice !== 'overwrite') {
          const kept = this.deps.notSaved(conflict);
          KEPT_EDITING.add(kept);
          throw kept;
        }
        // As for a draft: the re-send is pinned to the version the refusal
        // names, so a publish landing in between is asked about again. The
        // author has seen the live row move and chose this buffer over it:
        // that is the re-confirmation rule 9 waits for.
        this.unconfirmed.delete(key);
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
    const key = itemKey(type, name, packageId);
    this.pin(key, pin);
    // objectstack#36726 — no draft is pending at the address: the buffer is
    // the live row, which the load's published read describes (rule 9 ends).
    if (pin && 'ifNoneMatch' in pin) this.confirm(key);
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

/** {@link DraftSaveGuard.heldDraftVersion} over a guard: the token of the `If-Match` it holds. */
export function heldDraftVersionOf(guard: Pick<DraftVersionGuard, 'heldFor'>): DraftSaveGuard['heldDraftVersion'] {
  return (type, name, packageId) => {
    const pin = guard.heldFor(type, name, packageId);
    return pin && 'ifMatch' in pin ? pin.ifMatch : undefined;
  };
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
  /**
   * objectstack#36350 — the version of the draft this buffer last wrote or read
   * at the item (the `If-Match` it holds: a save's receipt version, or the
   * load's draft read), for a publish pinned to that draft (`draftVersion`).
   * `undefined` when it holds no token (no draft, or a server that serves no
   * version): such a publish goes unpinned.
   */
  heldDraftVersion: (type: string, name: string, packageId?: string | null) => string | undefined;
  /** The conflict dialog; render it once, anywhere in the caller's tree. */
  dialog: React.ReactElement;
}
