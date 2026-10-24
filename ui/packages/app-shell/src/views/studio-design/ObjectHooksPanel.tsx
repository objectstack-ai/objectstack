/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Data pillar — Hooks view.
 *
 * Unlike validations/actions (inline arrays on the object draft), hooks are a
 * SEPARATE `hook` metadata type whose `object` field targets one object, a
 * list, or `*`. So this panel fetches them (client.list) and persists each one
 * on its own (client.save('hook', …, { mode: 'draft' })) — the object's Save
 * draft doesn't cover them.
 *
 * Master-detail, editable: a left list of the hooks that fire on this object,
 * and on the right the hook's inspector (the platform's generic metadata form,
 * SchemaForm, until the curated one registers). An edit autosaves to the
 * hook's draft the way the other Studio editors do (objectui#11787): the shared
 * autosave, 1.5s after the last edit, held while a CEL syntax error stands or
 * while the hook's name differs from the one it was created with, and the
 * panel's status line in place of the old Save hook button.
 *
 * A new hook targets the object it is created from (`addHook`). Its target
 * picker is told which objects belong to this package (objectui#11820), so it
 * lists them first and puts every other object — other packages' and the
 * platform's own — under a heading that warns about the reach.
 */

import React from 'react';
import { Webhook, Plus, Loader2 } from 'lucide-react';
import { useDisplayLocale } from '@object-ui/i18n';
import { SchemaForm } from '../metadata-admin/SchemaForm.js';
import { useRegisteredMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry.js';
import { HookTargetScopeContext, type HookTargetScope } from '../metadata-admin/inspectors/HookDefaultInspector.js';
import { loadPackageSurfaces } from './packageSurfaces.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
// objectui#11773 — the hook's draft save sends the version it was built on.
import { readDraftForSave, useDraftSaveGuard, type DraftPin } from '../metadata-admin/DraftConflictDialog.js';
// objectui#11787 — a hook autosaves through the pillars' own autosave.
import { useDraftAutoSave, type DraftSend } from './useDraftAutoSave.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
// `formatMetadataError` is the one metadata-save error reader (objectui#11302).
import { extractDraftBody, formatMetadataError } from '@object-ui/data-objectstack';

interface HookItem {
  name?: string;
  label?: string;
  object?: string | string[];
  async?: boolean;
  [key: string]: unknown;
}

/**
 * The body out of a `getDraft()` envelope, decoration-free (objectui#8181).
 *
 * This was a hand-rolled fourth copy of `extractDraftBody` that skipped the
 * read-decoration strip, so a served `_diagnostics` / `_draft` rode the hook
 * body into `save('hook', ...)` below. The unwrap is the shared one now; only
 * the `HookItem` narrowing is local.
 */
const draftBody = (resp: unknown): HookItem | null =>
  extractDraftBody(resp) as HookItem | null;

/** Does this hook's `object` target match the object we're viewing? */
function targetsObject(hook: HookItem, objectName: string): boolean {
  const target = hook.object;
  if (target === '*') return true;
  if (typeof target === 'string') return target === objectName;
  if (Array.isArray(target)) return target.includes(objectName) || target.includes('*');
  return false;
}

/** A fresh, unique, snake_case hook name scoped to the object. */
function nextHookName(objectName: string, existing: string[]): string {
  const base = (objectName || 'hook').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const taken = new Set(existing);
  let i = existing.length + 1;
  let name = `${base}_hook_${i}`;
  while (taken.has(name)) name = `${base}_hook_${++i}`;
  return name;
}

export function ObjectHooksPanel({
  objectName,
  packageId,
  disabled,
  hookSchema,
  publishNonce = 0,
  onDraftSaved,
}: {
  objectName: string;
  packageId: string;
  disabled?: boolean;
  /**
   * objectui#11773 — bumped by a package publish, which drops every draft and
   * with them the version this panel's last save received.
   */
  publishNonce?: number;
  /**
   * The live server JSONSchema for the `hook` type (`/meta/types`). Drives the
   * SchemaForm so the fields, enums and grouping come from the real hook
   * metadata contract rather than being synthesised from the value shape.
   */
  hookSchema?: Record<string, unknown>;
  /**
   * objectui#11787 — a hook draft landed (an edit, or "+ New"), so the
   * surface's pending-changes count refreshes, as every other draft save does.
   */
  onDraftSaved?: () => void;
}) {
  const locale = useMetadataLocale();
  const client = useMetadataClient();
  // Curated hook authoring surface (object picker + events + dedicated body
  // editor); falls back to the generic SchemaForm if unregistered, and swaps
  // the curated surface in if it is registered later (objectui#11939).
  const HookInspector = useRegisteredMetadataDefaultInspector('hook');
  const [hooks, setHooks] = React.useState<HookItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<HookItem | null>(null);
  // objectui#11787 — the hook whose body the buffer holds (`selected` when its
  // install has run), and when its last draft save landed.
  const [draftFor, setDraftFor] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<{ hook: string; at: Date } | null>(null);
  const displayLocale = useDisplayLocale();
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  // objectui#11773 — each hook's pin: what the list load read for it (its
  // draft's version, or "no draft row"), then each save's receipt. A save
  // writes the list in place (objectui#11787) and the re-read that follows
  // "+ New" reads back what was written, so the pin survives both; a
  // conflict's "reload" re-reads the list, and a publish forgets every pin.
  const reloadHooks = React.useCallback(() => setNonce((n) => n + 1), []);
  const {
    save: saveHookDraft,
    recordRead: recordHookRead,
    forget: forgetHookVersion,
    dialog: hookConflictDialog,
  } = useDraftSaveGuard(client, reloadHooks);
  React.useEffect(() => {
    forgetHookVersion();
  }, [publishNonce, forgetHookVersion]);
  // The publish a list load started under: a load still in flight when a
  // publish lands read the drafts that publish drained, so it records no pins.
  const publishNonceRef = React.useRef(publishNonce);
  React.useLayoutEffect(() => {
    publishNonceRef.current = publishNonce;
  });

  /* ─── objectui#11820 — the objects of this package, for the target picker ──
   *
   * The package's own list — published and draft, the merge the pillars' rails
   * use (`loadPackageSurfaces`) — plus the object this panel is open on, which
   * the Data pillar only offers from this package. Held in state, stamped with
   * the package it was read for, so the context value keeps its identity
   * between reads and a scope read for another package is never applied.
   * Until it answers, and if it fails, the picker shows its flat list. */
  const [packageScope, setPackageScope] = React.useState<
    (HookTargetScope & { packageId: string; objectName: string }) | null
  >(null);
  React.useEffect(() => {
    let cancelled = false;
    loadPackageSurfaces(client, 'object', packageId)
      .then((items) => {
        if (cancelled) return;
        const names = new Set(items.map((i) => i.name));
        names.add(objectName);
        setPackageScope({ packageId, objectName, packageObjects: names });
      })
      .catch(() => {
        if (!cancelled) setPackageScope(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, packageId, objectName]);
  const hookTargetScope =
    packageScope && packageScope.packageId === packageId && packageScope.objectName === objectName
      ? packageScope
      : null;

  /* ─── Blocking CEL verdicts → this panel's OWN save (objectui#4527) ────────
   *
   * Unlike the object's other panels, this one writes the hook itself
   * (`client.save('hook', …, { mode: 'draft' })`), so it owns the save that
   * has to refuse: the autosave below is held while one stands (objectui#11787). The count is STAMPED with the hook it describes and
   * mismatch is read as 0, so a verdict that lands after the author switched
   * hooks cannot gate the one now on screen — derivation, not a reset effect,
   * and the selected hook always has its editor available to fix in. */
  const [celErrors, setCelErrors] = React.useState<{ hook: string; count: number }>({
    hook: '',
    count: 0,
  });
  const selectedHookName = String(draft?.name ?? '');
  const reportCel = React.useCallback(
    (count: number) => {
      setCelErrors((prev) => {
        if (prev.hook !== selectedHookName) return { hook: selectedHookName, count };
        if (prev.count === count) return prev;
        return { hook: selectedHookName, count };
      });
    },
    [selectedHookName],
  );
  const blockingIssues = celErrors.hook === selectedHookName ? celErrors.count : 0;

  // The hook the buffer holds and whether it holds an unsent edit, read by the
  // list load (objectui#11773) and the install below (objectui#11787).
  const bufferRef = React.useRef({ hook: draftFor, dirty });
  React.useLayoutEffect(() => {
    bufferRef.current = { hook: draftFor, dirty };
  });

  React.useEffect(() => {
    let cancelled = false;
    const publishAtStart = publishNonceRef.current;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // `list()` only sees PUBLISHED hooks; a freshly-created (or edited)
        // hook is a draft, so also pull draft headers and hydrate each body
        // (headers carry no `object`, so we must load them to filter + edit).
        // Drafts win over the published row of the same name.
        const [pub, draftHeaders] = await Promise.all([
          client.list('hook', { packageId }) as Promise<HookItem[]>,
          client.listDrafts({ packageId, type: 'hook' }).catch(() => null),
        ]);
        const draftNames = (draftHeaders || []).map((d) => String(d.name ?? '')).filter(Boolean);
        // objectui#11773 — each draft is read at the address its save writes
        // (`?package=` this package), so the version it serves pins that save.
        const reads = await Promise.all(draftNames.map((n) => readDraftForSave(client, 'hook', n, packageId)));
        if (cancelled) return;
        const byName = new Map<string, HookItem>();
        // What the next save of each listed hook is pinned to. A hook this
        // package's drafts ledger does not list has no draft at the save's
        // address — when the ledger was read at all: an unreadable ledger says
        // nothing, and pins nothing.
        const pins = new Map<string, DraftPin | null>();
        for (const h of pub || []) {
          if (h?.name && targetsObject(h, objectName)) {
            byName.set(String(h.name), h);
            pins.set(String(h.name), draftHeaders ? { ifNoneMatch: '*' } : null);
          }
        }
        draftNames.forEach((n, i) => {
          const body = draftBody(reads[i]!.answer);
          if (body && targetsObject(body, objectName)) byName.set(n, body);
          if (byName.has(n)) pins.set(n, reads[i]!.pin);
        });
        setHooks([...byName.values()]);
        // A hook whose buffer holds an unsent edit keeps the pin that edit was
        // built on: the install below does not replace that buffer either.
        const open = bufferRef.current;
        for (const [n, pin] of pins) {
          if (publishNonceRef.current !== publishAtStart) break;
          if (!(open.dirty && open.hook === n)) recordHookRead('hook', n, packageId, pin);
        }
      } catch (e) {
        if (!cancelled) setError(formatMetadataError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, objectName, nonce, recordHookRead]);

  // Load the selected hook into an editable draft: on a selection change, and
  // when the list changes. objectui#11787 — except over an unsent edit of that
  // same hook: the list an autosave writes holds what that save sent, and an
  // edit the author took meanwhile is newer than it (`bufferRef`, above).
  React.useEffect(() => {
    if (selected !== null && bufferRef.current.hook === selected && bufferRef.current.dirty) return;
    const hook = hooks.find((h) => h.name === selected) ?? null;
    setDraft(hook ? { ...hook } : null);
    setDraftFor(hook ? selected : null);
    setDirty(false);
  }, [selected, hooks]);

  const save = React.useCallback(async (sent: DraftSend) => {
    if (!draft?.name) return;
    setSaving(true);
    setError(null);
    try {
      if ((await saveHookDraft('hook', String(draft.name), draft, { mode: 'draft', packageId, surface: 'studio' })) === 'reloaded') {
        // objectui#11773 — the author chose the saved version: the list re-read
        // installs it over this buffer, which holds nothing of theirs to keep.
        setDirty(false);
        return;
      }
      // No success toast: with autosave it would fire after every editing
      // pause; the status line is the affordance (objectui#11787).
      // objectui#11204 — clean only if nothing was edited while it was in flight.
      if (sent.unmoved()) setDirty(false);
      setSavedAt({ hook: String(selected ?? ''), at: new Date() });
      onDraftSaved?.();
      // The list now holds what the draft holds. Written in place rather than
      // read again: a re-read blanks the list to "Loading…" at every editing
      // pause, and it would answer with this very body (a draft wins over the
      // published row of its name, and a hook no longer aimed at this object
      // leaves its list).
      const sentBody = draft;
      setHooks((list) => {
        const kept = list.filter((h) => h.name !== sentBody.name);
        if (!targetsObject(sentBody, objectName)) return kept;
        const at = list.findIndex((h) => h.name === sentBody.name);
        return at < 0 ? [...kept, sentBody] : list.map((h, i) => (i === at ? sentBody : h));
      });
    } catch (e) {
      setError(formatMetadataError(e));
    } finally {
      setSaving(false);
    }
  }, [saveHookDraft, draft, packageId, selected, onDraftSaved, objectName]);

  // objectui#11787 — a hook autosaves to its draft like the pillars' editors:
  // the shared autosave, blocked where the Save hook button was disabled (a
  // blocking CEL verdict holds the edit, objectui#4527) and while the package
  // is read-only. The hook is the open item; the buffer is its own once the
  // install above has run for it.
  const hookTarget = `hook:${selected ?? ''}`;
  // objectui#11787 — a hook keeps the name it was created with ("+ New" sets
  // it). The draft is stored under its name, and the inspector commits the name
  // on every keystroke, so a rename the autosave sent would stage one more hook
  // per pause while typing (measured: two drafts, each under a partial name,
  // beside the original). The same rule the package door's permission matrix
  // keeps for its api name: a renamed buffer is held, and the line below says
  // how to get the edit saved.
  const renamedFrom =
    draft !== null && draftFor !== null && String(draft.name ?? '') !== draftFor ? draftFor : null;
  useDraftAutoSave({
    target: hookTarget,
    loadedFor: `hook:${draftFor ?? ''}`,
    dirty,
    blocked: !draft?.name || saving || !!disabled || blockingIssues > 0 || renamedFrom !== null,
    snapshot: draft,
    save,
  });

  const addHook = React.useCallback(async () => {
    const name = nextHookName(objectName, hooks.map((h) => String(h.name ?? '')));
    // A complete, *valid* skeleton so the immediate save passes: hooks require
    // an object, at least one event, and a valid body discriminator.
    const fresh: HookItem = {
      name,
      label: t('engine.studio.hooks.newLabel', locale),
      object: objectName,
      events: ['beforeInsert'],
      body: { language: 'js', source: 'return;' },
      priority: 100,
      async: false,
    };
    setSaving(true);
    setError(null);
    try {
      // objectui#11773 — a create is the first-write pin: refused where the
      // name already holds a draft, instead of written over it.
      await client.save('hook', name, fresh, { mode: 'draft', packageId, ifNoneMatch: '*', surface: 'studio' });
      // objectui#11787 — a new hook is a new draft: the count says so.
      onDraftSaved?.();
      setNonce((n) => n + 1);
      setSelected(name);
    } catch (e) {
      setError(formatMetadataError(e));
    } finally {
      setSaving(false);
    }
  }, [client, objectName, hooks, packageId, locale, onDraftSaved]);

  // objectui#12514 — an object no hook targets is one centered block whose
  // button runs the list header's own "New".
  if (!loading && hooks.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {hookConflictDialog}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive whitespace-pre-line">
            {error}
          </div>
        )}
        <StudioEmptyState
          testId="hooks-empty"
          icon={Webhook}
          sentence={t('engine.studio.hooks.none', locale)}
          action={
            disabled ? undefined : (
              <StudioEmptyStateAction
                data-testid="hooks-empty-new"
                label={t('engine.studio.hooks.newButton', locale)}
                onClick={addHook}
                disabled={saving}
              />
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {hookConflictDialog}
      {/* hook list */}
      <div className="flex w-72 shrink-0 flex-col rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Webhook className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{t('engine.studio.data.tab.hooks', locale)}</span>
          <span className="text-[11px] text-muted-foreground">({hooks.length})</span>
          {!disabled && (
            <button
              type="button"
              onClick={addHook}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
            >
              <Plus className="h-3 w-3" /> {t('engine.studio.new', locale)}
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">{t('engine.studio.loading', locale)}</p>
          ) : (
            hooks.map((h) => (
              <button
                key={String(h.name)}
                type="button"
                onClick={() => setSelected(h.name ?? null)}
                className={
                  'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-[12px] ' +
                  (selected === h.name ? 'bg-muted' : 'hover:bg-muted/50')
                }
              >
                <Webhook className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{h.label || h.name}</span>
                {h.async && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    {t('engine.studio.hooks.async', locale)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* detail — the platform's generic metadata form */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border">
        {error && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive whitespace-pre-line">
            {error}
          </div>
        )}
        {!draft ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground">
            {t('engine.studio.hooks.pick', locale)}
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{String(draft.label || draft.name)}</span>
              {/* objectui#11787 — the status line every Studio editor shows in
                  place of a Save button: saving while in flight, the
                  last-saved time once landed, and why an edit is held when a
                  CEL syntax error holds it. */}
              {disabled ? null : saving ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="hooks-autosaving">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('engine.studio.autoSaving', locale)}
                </span>
              ) : renamedFrom !== null ? null : blockingIssues > 0 && dirty ? (
                <span className="text-[11px] text-destructive" data-testid="hooks-autosave-held">
                  {t('perm.cel.saveBlocked', locale)}
                </span>
              ) : savedAt && savedAt.hook === selected && !dirty ? (
                <span className="text-[11px] text-muted-foreground" data-testid="hooks-saved-at">
                  {tFormat('engine.studio.data.lastSaved', locale, {
                    time: savedAt.at.toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' }),
                  })}
                </span>
              ) : null}
            </div>
            {renamedFrom !== null && !disabled && (
              <p
                role="status"
                data-testid="hooks-rename-held"
                className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"
              >
                {tFormat('engine.studio.hooks.renameHeld', locale, { name: renamedFrom })}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {HookInspector ? (
                <HookTargetScopeContext.Provider value={hookTargetScope}>
                  {/* eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataDefaultInspector returns a registered component (stable), not one created during render */}
                  <HookInspector
                    type="hook"
                    name={String(draft.name ?? '')}
                    draft={draft as Record<string, unknown>}
                    onPatch={(patch) => {
                      setDraft((d) => ({ ...(d as HookItem), ...patch }));
                      setDirty(true);
                    }}
                    readOnly={!!disabled}
                    locale={locale}
                    serverSchema={hookSchema}
                    onBlockingIssuesChange={reportCel}
                  />
                </HookTargetScopeContext.Provider>
              ) : (
                <div className="p-3">
                  <SchemaForm
                    schema={hookSchema}
                    value={draft as Record<string, unknown>}
                    onChange={(next) => {
                      setDraft(next as HookItem);
                      setDirty(true);
                    }}
                    readOnly={!!disabled}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
