// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio page's Save and Cancel: one pair for every editor on the open
 * page (objectstack#36511). They sat at the right of the top bar where Publish
 * used to be; objectstack#37455 moved them to the page's item header, at the
 * end of its actions (`studioTitleRow.tsx`), unchanged.
 *
 * An editor that saves explicitly holds its edits on the page and sends
 * nothing until Save is pressed. It registers one {@link StudioSaveEntry} per
 * buffer with {@link useStudioSaveEntry}; the surface runs the coordinator
 * ({@link useStudioSaveCoordinator}) and draws {@link StudioSaveControls}.
 *
 * Invariants:
 *  - The pair is drawn only while some registered buffer is dirty.
 *  - Save sends every dirty buffer of the page, in `order`, one after another,
 *    and each buffer's own `save` writes its item and makes it live (the
 *    item's draft, then that item's own publish). A buffer refused does not
 *    stop the others: the toast names each refused item with its reason and
 *    lists the items that were saved.
 *  - A buffer that holds an edit it cannot send yet (`held`) refuses the whole
 *    Save before anything is written, naming what it needs. The held state is
 *    read once the expression checks of the last keystroke have run (they run
 *    {@link LINT_DEBOUNCE_MS} after it) AND their verdicts have reached the
 *    buffers: a Save pressed at once never sends a formula its check has not
 *    judged yet (objectui#4306).
 *  - A verdict climbs to its buffer through effects, one render per hop (an
 *    action predicate's: the CEL field, the condition builder, the action
 *    inspector, the actions panel, then the Data pillar's `held`). Those
 *    renders run at default priority, so Save waits for a render of its own
 *    at transition priority ({@link useRendersSettled}): React commits it only
 *    once no default-priority render is left, the last hop included. A fixed
 *    margin past the debounce lost that race on a busy main thread and sent
 *    the unparsable text (objectstack#36619).
 *  - Cancel drops every dirty buffer's edits: each goes back to what the
 *    server holds.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { cn } from '@object-ui/components';
import type { MetadataClient } from '@object-ui/data-objectstack';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { LINT_DEBOUNCE_MS } from '../metadata-admin/celLintDebounce.js';
import {
  isDraftVersionConflict,
  isPublishDraftMoved,
  publishedPinOf,
  type BeforeReloadOutcome,
  type DraftPin,
  type DraftSaveGuard,
} from '../metadata-admin/DraftConflictDialog.js';

/** Past the editors' expression check of the last keystroke, and its report. */
const VERDICT_SETTLE_MS = LINT_DEBOUNCE_MS + 50;

/** The sonner id of a landed Save's toast: a second Save updates it in place (objectstack#28984). */
export const STUDIO_SAVE_TOAST_ID = 'studio-save';

/** What one buffer's Save did. */
export type StudioSaveResult =
  /** The item was written and is live. */
  | { kind: 'saved' }
  /** The server refused it; `reason` is the author sentence shown on the page too. */
  | { kind: 'refused'; reason: string }
  /** The author was asked and chose not to send it (a confirmation declined). */
  | { kind: 'declined' };

/** One editor buffer the top bar's Save and Cancel act on. */
export interface StudioSaveEntry {
  /** The item's display name, for the toast. */
  label: string;
  /** Lower saves first: an item is saved before the items that read it. */
  order: number;
  /** The buffer holds edits the server does not have. */
  dirty: boolean;
  /** The clause naming what an edit still needs before it can be sent, or `null`. */
  held: string | null;
  /** Write the buffer's item and make it live. Never rejects. */
  save: () => Promise<StudioSaveResult>;
  /** Drop the buffer's edits: back to what the server holds. */
  cancel: () => void;
}

interface StudioSaveRegistry {
  /** Add a buffer; the answer removes it. (Not `register`: that name is the component registry's.) */
  enlist: (id: number, entry: React.MutableRefObject<StudioSaveEntry | null>) => () => void;
  /** An entry's `dirty` or `held` changed: the top bar re-reads them. */
  changed: () => void;
}

const StudioSaveContext = React.createContext<StudioSaveRegistry | null>(null);

/** Provided by `StudioDesignSurface` around its pillars. */
export const StudioSaveProvider = StudioSaveContext.Provider;

let nextEntryId = 0;

/**
 * Register a buffer with the top bar's Save and Cancel for as long as the
 * calling component is mounted. `entry` may be rebuilt on every render; `null`
 * registers nothing (no item open). Outside a {@link StudioSaveProvider}
 * nothing is registered, and nothing sends the buffer.
 */
export function useStudioSaveEntry(entry: StudioSaveEntry | null): void {
  const registry = React.useContext(StudioSaveContext);
  const ref = React.useRef<StudioSaveEntry | null>(entry);
  React.useLayoutEffect(() => {
    ref.current = entry;
  });
  const [id] = React.useState(() => ++nextEntryId);
  React.useEffect(() => {
    if (!registry) return;
    return registry.enlist(id, ref);
  }, [registry, id]);
  const dirty = entry?.dirty ?? false;
  const held = entry?.held ?? null;
  React.useEffect(() => {
    registry?.changed();
  }, [registry, dirty, held]);
}

/** What the surface reads off its coordinator. */
export interface StudioSaveCoordinator {
  /** For {@link StudioSaveProvider}. */
  registry: StudioSaveRegistry;
  /** Some registered buffer has unsaved edits. */
  dirty: boolean;
  /** A Save is in flight. */
  saving: boolean;
  save: () => Promise<void>;
  cancel: () => void;
}

/**
 * objectstack#36619 — an answer that resolves once React has no render more
 * urgent than a transition left: the caller's component renders at transition
 * priority, and React reaches that render only after every default-priority
 * one, including those scheduled by the effects of the renders before it. So
 * an effect chain already under way (a CEL verdict climbing to the buffer that
 * holds it) has run to its end when the answer resolves. Unmounted first, it
 * resolves at once: nothing is left to wait for.
 */
function useRendersSettled(): () => Promise<void> {
  const [tick, setTick] = React.useState(0);
  const seq = React.useRef(0);
  const waiters = React.useRef<Array<{ tick: number; resolve: () => void }>>([]);
  React.useEffect(() => {
    const due = waiters.current.filter((w) => w.tick <= tick);
    if (due.length === 0) return;
    waiters.current = waiters.current.filter((w) => w.tick > tick);
    for (const w of due) w.resolve();
  }, [tick]);
  React.useEffect(
    () => () => {
      for (const w of waiters.current) w.resolve();
      waiters.current = [];
    },
    [],
  );
  return React.useCallback(
    () =>
      new Promise<void>((resolve) => {
        const next = ++seq.current;
        waiters.current.push({ tick: next, resolve });
        React.startTransition(() => setTick(next));
      }),
    [],
  );
}

/** The surface's side: the registered buffers, and the Save and Cancel over them. */
export function useStudioSaveCoordinator(locale: string): StudioSaveCoordinator {
  const entriesRef = React.useRef(new Map<number, React.MutableRefObject<StudioSaveEntry | null>>());
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const rendersSettled = useRendersSettled();
  const readDirty = React.useCallback(() => {
    for (const ref of entriesRef.current.values()) if (ref.current?.dirty) return true;
    return false;
  }, []);
  // A state initializer, so its identity is the surface's for life (AGENTS.md #10).
  const [registry] = React.useState<StudioSaveRegistry>(() => ({
    enlist: (id, ref) => {
      entriesRef.current.set(id, ref);
      setDirty(readDirty());
      return () => {
        entriesRef.current.delete(id);
        setDirty(readDirty());
      };
    },
    changed: () => setDirty(readDirty()),
  }));
  const dirtyEntries = React.useCallback(
    () =>
      [...entriesRef.current.values()]
        .map((ref) => ref.current)
        .filter((e): e is StudioSaveEntry => e !== null && e.dirty)
        .sort((a, b) => a.order - b.order),
    [],
  );
  const save = React.useCallback(async () => {
    if (savingRef.current) return;
    if (dirtyEntries().length === 0) return;
    savingRef.current = true;
    setSaving(true);
    await new Promise((settled) => setTimeout(settled, VERDICT_SETTLE_MS));
    // The checks have run; their verdicts may still be climbing to the buffers.
    await rendersSettled();
    const entries = dirtyEntries();
    const held = entries.find((e) => e.held !== null);
    if (held || entries.length === 0) {
      savingRef.current = false;
      setSaving(false);
      if (held) toast.error(tFormat('engine.studio.save.held', locale, { clause: held.held ?? '' }));
      return;
    }
    const saved: string[] = [];
    const refused: Array<{ label: string; reason: string }> = [];
    try {
      for (const entry of entries) {
        let result: StudioSaveResult;
        try {
          result = await entry.save();
        } catch (e) {
          result = { kind: 'refused', reason: e instanceof Error ? e.message : String(e) };
        }
        if (result.kind === 'saved') saved.push(entry.label);
        else if (result.kind === 'refused') refused.push({ label: entry.label, reason: result.reason });
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      setDirty(readDirty());
    }
    const sep = t('engine.studio.save.itemSeparator', locale);
    const names = (labels: string[]) => [...new Set(labels)].join(sep);
    if (refused.length > 0) {
      const lines = refused.map((r) => tFormat('engine.studio.save.refusedLine', locale, { item: r.label, reason: r.reason }));
      if (saved.length > 0) lines.push(tFormat('engine.studio.save.savedLine', locale, { items: names(saved) }));
      toast.error(tFormat('engine.studio.save.refused', locale, { items: names(refused.map((r) => r.label)) }), {
        description: lines.join('\n'),
      });
    } else if (saved.length > 0) {
      toast.success(tFormat('engine.studio.save.done', locale, { items: names(saved) }), { id: STUDIO_SAVE_TOAST_ID });
    }
  }, [dirtyEntries, locale, readDirty, rendersSettled]);
  const cancel = React.useCallback(() => {
    if (savingRef.current) return;
    for (const entry of dirtyEntries()) entry.cancel();
  }, [dirtyEntries]);
  return { registry, dirty, saving, save, cancel };
}

/** The item a Save wrote, at the address its draft save wrote it. */
export interface SavedItem {
  type: string;
  name: string;
  packageId: string | null;
  /**
   * objectstack#37440 — the version the Save's own draft write returned (its
   * receipt's `version`), which pins the publish to that draft. Absent, the
   * publish goes unpinned, as before.
   */
  draftVersion?: string;
}

/** What an unpinned {@link publishSavedItem} did. */
export type UnpinnedPublishOutcome =
  | { ok: true }
  /** Refused; `draftDiscarded` says the draft the save wrote was taken back. */
  | { ok: false; error: unknown; draftDiscarded: boolean };

/** What {@link publishSavedItem} did; only a pinned publish can answer `reloaded`. */
export type PublishSavedOutcome =
  | UnpinnedPublishOutcome
  /**
   * objectstack#36601 — the published row moved since the buffer was loaded,
   * and the author chose to reload it: nothing went live, the draft the save
   * wrote was taken back first (`draftDiscarded`, as for a refusal), and the
   * buffer is being re-read.
   */
  | { ok: false; reloaded: true; draftDiscarded: boolean };

/**
 * objectstack#36601 — the buffer's own guarded publish
 * (`DraftSaveGuard.publish`), pinned to the published version its load read.
 */
export type PinnedPublish = DraftSaveGuard['publish'];

/**
 * objectstack#36726 — a load's `/layers` read at the address its Save's
 * publish writes, for the published pin alone ({@link publishedPinOf}). Read
 * it BEFORE the reads the buffer is installed from, as the server reads the
 * version before the body: a publish landing in between leaves the pin older
 * than the buffer, and the Save is asked about instead of publishing over it.
 *
 * No layer at all at the address (the door's 404, which the client answers as
 * the empty view) is no published row there: `If-None-Match: *`, so a row
 * another writer publishes first is refused, never replaced. A read that
 * fails says nothing about the row and pins nothing; so does a served answer
 * without `overlayVersion` (a server from before it was served).
 */
export async function readPublishedPin(
  client: Pick<MetadataClient, 'layered'>,
  type: string,
  name: string,
  packageId: string | null | undefined,
): Promise<DraftPin | null> {
  let layered: unknown;
  try {
    layered = await client.layered(type, name, packageId ? { packageId } : {});
  } catch {
    return null;
  }
  return publishedPinOfLayers(layered);
}

/** {@link readPublishedPin}'s reading of an answer the caller already holds. */
export function publishedPinOfLayers(layered: unknown): DraftPin | null {
  const pin = publishedPinOf(layered);
  if (pin) return pin;
  const l = (layered ?? {}) as { code?: unknown; overlay?: unknown; effective?: unknown; draft?: unknown };
  const absent = l.code == null && l.overlay == null && l.effective == null && l.draft == null;
  return absent ? { ifNoneMatch: '*' } : null;
}

/**
 * objectstack#36726 — the publish of an item a create has just written, pinned
 * `If-None-Match: *`: no live row was there when the create checked, so a row
 * another writer published under the name since is refused `409` instead of
 * replaced. For a create with no loaded buffer to reload (a new flow), the
 * refusal is the create's own: no dialog is asked. objectstack#37440 — the
 * create's own draft pin (`options.draftVersion`, its receipt) rides beside
 * it; a refusal by either pin is the create's, and the discard
 * {@link publishSavedItem} pins to the same receipt removes the create's
 * draft only while it is still the create's own.
 */
export const publishCreated: PinnedPublish = async (client, type, name, options = {}) => {
  await client.publish(type, name, { ...options, ifNoneMatch: '*' });
  return 'published';
};

/**
 * Make the draft a Save just wrote live: that one item's publish, at the
 * package the draft was written to (`?package=`), never the package's batch.
 *
 * Refused, the draft the save wrote is discarded when no other draft of the
 * item was pending before it (`hadDraft` false), so a refused Save leaves no
 * draft behind and the edits stay on the page, unsaved. A draft that was
 * pending before the save (a copilot's) is kept: it now carries the page's
 * edits too, and is reviewed under Changes. Either way the ledger is told.
 *
 * objectstack#36601 — `pinned`, the buffer's guarded publish, sends the
 * published version the buffer was loaded at, so a Save over a row another
 * editor published since is refused and asked about (reload or overwrite)
 * instead of replacing it. Omitted, the publish is unpinned, as before.
 * objectstack#36726 — every Studio editor that saves this way passes it; a
 * create passes {@link publishCreated} where no buffer is loaded behind it.
 *
 * objectstack#37440 — `item.draftVersion`, the version the Save's OWN draft
 * write returned (its receipt's `version`; `heldDraftVersion` right after a
 * guarded save), pins the publish to that draft: a draft another writer
 * changed in between is refused `409 METADATA_CONFLICT` and nothing is
 * published on their behalf. That draft now holds the other writer's change,
 * so it is ⛔ never discarded: the outcome is a refusal with the draft kept.
 * Every discard of the Save's own draft is pinned to the same version
 * (`If-Match`), so the server removes only that draft, never one that moved.
 * Absent (a receipt without a version), both go unpinned, as before.
 */
export async function publishSavedItem(
  client: Pick<MetadataClient, 'publish' | 'reset' | 'getDraft'>,
  item: SavedItem,
  hadDraft: boolean,
): Promise<UnpinnedPublishOutcome>;
export async function publishSavedItem(
  client: Pick<MetadataClient, 'publish' | 'reset' | 'getDraft'>,
  item: SavedItem,
  hadDraft: boolean,
  pinned: PinnedPublish,
): Promise<PublishSavedOutcome>;
export async function publishSavedItem(
  client: Pick<MetadataClient, 'publish' | 'reset' | 'getDraft'>,
  item: SavedItem,
  hadDraft: boolean,
  pinned?: PinnedPublish,
): Promise<PublishSavedOutcome> {
  const scope = item.packageId ? { packageId: item.packageId } : {};
  const { draftVersion } = item;
  // objectstack#37440 — the publish names the draft the Save wrote; a discard removes only that draft.
  const publishScope = draftVersion ? { ...scope, draftVersion } : scope;
  const discardScope = { state: 'draft' as const, ...scope, ...(draftVersion ? { ifMatch: draftVersion } : {}) };
  // The refusal is the draft pin's: the guard said so (rule 10), or no other
  // pin was sent that a `409 METADATA_CONFLICT` could be.
  const draftMoved = (error: unknown): boolean =>
    isPublishDraftMoved(error) || (!pinned && !!draftVersion && isDraftVersionConflict(error));
  let draftDiscarded = false;
  const discardSavedDraft = async (): Promise<void> => {
    if (hadDraft) return;
    try {
      await client.reset(item.type, item.name, discardScope);
      draftDiscarded = true;
    } catch (discardError) {
      // The draft stays pending, listed under Changes, where it can be discarded.
      console.error('[studio] a refused publish left the saved draft pending:', discardError);
    }
  };
  // objectstack#36601 (contract review S2) — the reload's discard is NOT
  // best-effort: a draft that could not be taken back would be re-read as the
  // buffer and pinned to the fresh published version, so the next Save would
  // publish the losing copy without a prompt. Its failure throws instead: the
  // guard does not reload, keeps the published pin the conflict was raised
  // on, and the Save reads as refused, edits on the page.
  // objectstack#36726 — a draft pending before the Save is kept, never
  // discarded: the guard is told so, and the reload that re-reads it stays
  // pinned to the published version the conflict was raised on.
  const discardBeforeReload = async (): Promise<BeforeReloadOutcome> => {
    if (hadDraft) return 'kept';
    await client.reset(item.type, item.name, discardScope);
    draftDiscarded = true;
    return 'discarded';
  };
  try {
    if (pinned) {
      // A reload takes the saved draft back BEFORE the buffer is re-read, so
      // the re-read installs the live row, never the draft that lost.
      const outcome = await pinned(client, item.type, item.name, publishScope, discardBeforeReload);
      if (outcome === 'reloaded') {
        emitMetadataRefresh();
        return { ok: false, reloaded: true, draftDiscarded };
      }
    } else {
      await client.publish(item.type, item.name, publishScope);
    }
  } catch (error) {
    // objectstack#37440 — another writer's change is in the draft now: kept.
    if (!draftMoved(error)) await discardSavedDraft();
    emitMetadataRefresh();
    return { ok: false, error, draftDiscarded };
  }
  emitMetadataRefresh();
  return { ok: true };
}

/** The page's Cancel and Save, drawn while it holds unsaved edits (in its item header, objectstack#37455). */
export function StudioSaveControls({
  coordinator,
  locale,
}: {
  coordinator: Pick<StudioSaveCoordinator, 'dirty' | 'saving' | 'save' | 'cancel'>;
  locale: string;
}): React.ReactElement | null {
  const { dirty, saving, save, cancel } = coordinator;
  if (!dirty && !saving) return null;
  return (
    <>
      <button
        type="button"
        data-testid="studio-cancel"
        onClick={cancel}
        disabled={saving}
        title={t('engine.studio.save.cancelTitle', locale)}
        className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
      >
        {t('engine.studio.save.cancel', locale)}
      </button>
      <button
        type="button"
        data-testid="studio-save"
        onClick={() => void save()}
        disabled={saving}
        title={t('engine.studio.save.title', locale)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-primary px-3 text-[13px] font-medium text-primary-foreground',
          'disabled:opacity-70',
        )}
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {saving ? t('engine.studio.save.saving', locale) : t('engine.studio.save.save', locale)}
      </button>
    </>
  );
}
