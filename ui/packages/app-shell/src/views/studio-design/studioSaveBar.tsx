// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio top bar's Save and Cancel: one pair for every editor on the open
 * page, at the right of the top bar where Publish used to be (objectstack#36511,
 * the maintainer's placement ruling on that card).
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
 *    {@link LINT_DEBOUNCE_MS} after it): a Save pressed at once never sends a
 *    formula its check has not judged yet (objectui#4306).
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
import { LINT_DEBOUNCE_MS } from '../metadata-admin/CelPredicateField.js';

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
  register: (id: number, entry: React.MutableRefObject<StudioSaveEntry | null>) => () => void;
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
    return registry.register(id, ref);
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

/** The surface's side: the registered buffers, and the Save and Cancel over them. */
export function useStudioSaveCoordinator(locale: string): StudioSaveCoordinator {
  const entriesRef = React.useRef(new Map<number, React.MutableRefObject<StudioSaveEntry | null>>());
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const readDirty = React.useCallback(() => {
    for (const ref of entriesRef.current.values()) if (ref.current?.dirty) return true;
    return false;
  }, []);
  // A state initializer, so its identity is the surface's for life (AGENTS.md #10).
  const [registry] = React.useState<StudioSaveRegistry>(() => ({
    register: (id, ref) => {
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
  }, [dirtyEntries, locale, readDirty]);
  const cancel = React.useCallback(() => {
    if (savingRef.current) return;
    for (const entry of dirtyEntries()) entry.cancel();
  }, [dirtyEntries]);
  return { registry, dirty, saving, save, cancel };
}

/** What {@link publishSavedItem} did. */
export type PublishSavedOutcome =
  | { ok: true }
  /** Refused; `draftDiscarded` says the draft the save wrote was taken back. */
  | { ok: false; error: unknown; draftDiscarded: boolean };

/**
 * Make the draft a Save just wrote live: that one item's publish, at the
 * package the draft was written to (`?package=`), never the package's batch.
 *
 * Refused, the draft the save wrote is discarded when no other draft of the
 * item was pending before it (`hadDraft` false), so a refused Save leaves no
 * draft behind and the edits stay on the page, unsaved. A draft that was
 * pending before the save (a copilot's) is kept: it now carries the page's
 * edits too, and is reviewed under Changes. Either way the ledger is told.
 */
export async function publishSavedItem(
  client: Pick<MetadataClient, 'publish' | 'reset'>,
  item: { type: string; name: string; packageId: string | null },
  hadDraft: boolean,
): Promise<PublishSavedOutcome> {
  const scope = item.packageId ? { packageId: item.packageId } : {};
  try {
    await client.publish(item.type, item.name, scope);
  } catch (error) {
    let draftDiscarded = false;
    if (!hadDraft) {
      try {
        await client.reset(item.type, item.name, { state: 'draft', ...scope });
        draftDiscarded = true;
      } catch (discardError) {
        // The draft stays pending, listed under Changes, where it can be discarded.
        console.error('[studio] a refused publish left the saved draft pending:', discardError);
      }
    }
    emitMetadataRefresh();
    return { ok: false, error, draftDiscarded };
  }
  emitMetadataRefresh();
  return { ok: true };
}

/** The top bar's Cancel and Save, drawn while the page holds unsaved edits. */
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
