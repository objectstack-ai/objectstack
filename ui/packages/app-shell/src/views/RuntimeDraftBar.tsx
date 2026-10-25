// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RuntimeDraftBar — ADR-0034 step 3 (#1515): the draft/publish chrome for the
 * runtime config panels (ViewConfigPanel / ReportConfigPanel). Dashboard
 * authoring moved entirely to Studio's Interfaces pillar, so there is no
 * longer a runtime dashboard config panel.
 *
 * It mirrors studio's `ResourceEditPage` affordances: on open it reads the
 * pending draft (`?state=draft`), shows an "unpublished changes" indicator when
 * one exists, resumes it into the editor (`onResume`), and exposes **Publish**
 * and **Discard draft**. It renders nothing until there is a pending draft.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@object-ui/components';
import { Loader2, Send, Undo2 } from 'lucide-react';
import {
  publishRuntimeMetadata,
  discardRuntimeDraft,
  readRuntimeDraft,
  type RuntimeArtifactType,
} from './runtime-metadata-persistence.js';
import { useMetadataLocale, t, tFormat } from './metadata-admin/i18n.js';
import { useObjectTranslation } from '@object-ui/i18n';
import { formatMetadataError } from '@object-ui/data-objectstack';
import { toast } from 'sonner';

export interface RuntimeDraftBarProps {
  /** Artifact type — the `:type` in `/meta/:type/:name`. */
  type: RuntimeArtifactType;
  /** Artifact name — the `:name`. Chrome stays inert until this is known. */
  name?: string;
  /** Studio metadata client (flag-ON path). */
  metadataClient: any;
  /**
   * The DataSource whose view caches this bar's Publish / Discard stales
   * (objectui#4373). Publish is the write that matters: it promotes an
   * invisible draft into a PUBLISHED row, which is the world
   * `listViewOverrides` enumerates and caches for 5 minutes. Optional — a
   * `report` / `page` bar needs nothing here, and the seam ignores it for
   * non-`view` types.
   */
  dataSource?: any;
  /** The object a `view` artifact belongs to — the object half of the keys. */
  objectName?: string;
  /**
   * Disable Publish while the panel has unsaved local edits, mirroring
   * studio's "save first, then publish" rule.
   */
  dirty?: boolean;
  /**
   * Seed an existing draft back into the editor when the panel opens, so a
   * half-finished edit is restored. Called at most once per `name` per mount.
   */
  onResume?: (body: Record<string, unknown>) => void;
  /** Called after a successful publish / discard so the host can refresh. */
  onAfterChange?: () => void;
  /**
   * Monotonic counter the host bumps right after it saves a draft. The bar
   * reads the pending draft only on open, so without this a save in an
   * already-open panel wouldn't surface the indicator until reopen. Bumping
   * this marks the indicator immediately (a save just created a draft) — no
   * dependence on the fire-and-forget write's timing.
   */
  savedSignal?: number;
}

/**
 * The leads of the bar's refusal toasts (objectui#11583), from the console's
 * language packs. The engine table this file reads its labels from has no
 * failure keys, and it covers two languages, not the console's ten. A hook of
 * its own so its `t` is the packs' and the bar's `t` stays the table's.
 */
function useRefusalTitles(): { publishFailed: string; discardFailed: string } {
  const { t } = useObjectTranslation();
  return {
    publishFailed: t('console.runtimeDraft.publishFailed'),
    discardFailed: t('console.runtimeDraft.discardFailed'),
  };
}

export function RuntimeDraftBar({
  type,
  name,
  metadataClient,
  dataSource,
  objectName,
  dirty,
  onResume,
  onAfterChange,
  savedSignal,
}: RuntimeDraftBarProps) {
  const locale = useMetadataLocale();
  const refusalTitles = useRefusalTitles();
  const [hasDraft, setHasDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  // Track the `name` we've already resumed so reopening the same item doesn't
  // clobber in-flight edits with the stored draft on every effect run.
  const resumedRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!name || !metadataClient) {
      setHasDraft(false);
      return;
    }
    let body: Record<string, unknown> | null;
    try {
      body = await readRuntimeDraft<Record<string, unknown>>(type, name, {
        metadataClient,
      });
    } catch {
      // A failed draft read must not break the editor — treat as "no draft".
      setHasDraft(false);
      return;
    }
    setHasDraft(!!body);
    // Resume is best-effort: a failure to seed the editor must NOT hide the
    // "unpublished changes" indicator (the draft still exists on the server).
    if (body && onResume && resumedRef.current !== name) {
      resumedRef.current = name;
      try {
        onResume(body);
      } catch (err) {
        console.error('[RuntimeDraftBar] Resume draft failed:', err);
      }
    }
  }, [type, name, metadataClient, onResume]);

  // Read the pending draft on open / when the edited item changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A host save just wrote a draft → surface the indicator immediately,
  // without waiting for a reopen or racing the fire-and-forget write.
  // Skip the initial mount (savedSignal === 0 / undefined).
  const lastSavedSignal = useRef(savedSignal);
  useEffect(() => {
    if (savedSignal === lastSavedSignal.current) return;
    lastSavedSignal.current = savedSignal;
    if (savedSignal) setHasDraft(true);
  }, [savedSignal]);

  const handlePublish = useCallback(async () => {
    if (!name) return;
    setBusy(true);
    try {
      await publishRuntimeMetadata(type, name, { metadataClient, dataSource, objectName });
      setHasDraft(false);
      onAfterChange?.();
    } catch (err) {
      console.error('[RuntimeDraftBar] Publish failed:', err);
      // objectui#11583: a refused publish is said, with the door's message.
      // The draft is still pending, so the indicator stays.
      toast.error(refusalTitles.publishFailed, {
        description: formatMetadataError(err),
        classNames: { description: 'whitespace-pre-line' },
      });
    } finally {
      setBusy(false);
    }
  }, [type, name, metadataClient, dataSource, objectName, onAfterChange, refusalTitles.publishFailed]);

  const handleDiscard = useCallback(async () => {
    if (!name) return;
    if (
      typeof confirm === 'function' &&
      // objectui#12690 — the shared confirm takes one `{item}`; this bar holds
      // no label, so it names the machine `type/name` as it always has.
      !confirm(tFormat('engine.edit.discardDraftConfirm', locale, { item: `${type}/${name}` }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await discardRuntimeDraft(type, name, { metadataClient, dataSource, objectName });
      setHasDraft(false);
      onAfterChange?.();
    } catch (err) {
      console.error('[RuntimeDraftBar] Discard draft failed:', err);
      // objectui#11583: a refused discard is said, with the door's message.
      // The draft is still pending, so the indicator stays.
      toast.error(refusalTitles.discardFailed, {
        description: formatMetadataError(err),
        classNames: { description: 'whitespace-pre-line' },
      });
    } finally {
      setBusy(false);
    }
  }, [type, name, metadataClient, dataSource, objectName, onAfterChange, locale, refusalTitles.discardFailed]);

  // flag OFF, or nothing pending → render nothing (zero DOM, zero layout shift).
  // Nothing pending → render nothing (no indicator, no buttons).
  if (!hasDraft) return null;

  return (
    <div
      className="mr-auto flex items-center gap-2"
      data-testid="runtime-draft-bar"
    >
      <span
        className="text-xs text-amber-700 dark:text-amber-400"
        title={t('engine.edit.draftPending', locale)}
        data-testid="runtime-draft-indicator"
      >
        ● {t('engine.edit.draftPending', locale)}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDiscard}
        disabled={busy}
        className="h-7 w-7 p-0 text-muted-foreground"
        title={t('engine.edit.discardDraft', locale)}
        aria-label={t('engine.edit.discardDraft', locale)}
        data-testid="runtime-draft-discard"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        onClick={handlePublish}
        disabled={busy || dirty}
        className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 text-emerald-50"
        title={
          dirty
            ? t('engine.edit.publishBlockedDirty', locale)
            : t('engine.edit.publish', locale)
        }
        data-testid="runtime-draft-publish"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <>
            <Send className="h-3.5 w-3.5 mr-1" />
            {t('engine.edit.publish', locale)}
          </>
        )}
      </Button>
    </div>
  );
}
