// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data pillar's hooks buffer (objectstack#36511): the hooks that fire on
 * the open object, the one hook the author is editing, and its Save and
 * Cancel on the top bar.
 *
 * Hooks are a separate `hook` metadata type whose `object` targets one object,
 * a list, or `*`, so they are listed and saved one by one, not with the object.
 * The buffer lives at the pillar, not in the Hooks tab's panel: a tab switch
 * unmounts the panel, and the edit it held must still be the top bar's to save.
 *
 * Invariants:
 *  - Nothing is read until the Hooks tab has been opened for the object; the
 *    list read then stays with the object until another object opens.
 *  - An edit, and a new hook ("+ New"), stays on the page and sends nothing.
 *    The top bar's Save writes the hook's draft, then publishes that one hook
 *    (`publishSavedItem`), so it is live at once; Cancel puts the hook back as
 *    the server holds it, and drops a new one.
 *  - One hook is edited at a time: opening another hook, or "+ New", while the
 *    open one holds an unsaved edit asks first (`confirmDropUnsavedWork`).
 *  - A hook keeps the name it is stored under: a renamed buffer, and one whose
 *    expression check reports an error, hold the Save with a named clause.
 *  - Each save is pinned to the draft version the list read served
 *    (objectui#11773); a new hook's first write asserts no draft row.
 */

import * as React from 'react';
import { extractDraftBody, formatMetadataError } from '@object-ui/data-objectstack';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { readDraftForSave, useDraftSaveGuard, type DraftPin } from '../metadata-admin/DraftConflictDialog.js';
import type { HookTargetScope } from '../metadata-admin/inspectors/HookDefaultInspector.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { loadPackageSurfaces } from './packageSurfaces.js';
import { confirmDropUnsavedWork } from './StudioPillarKit.js';
import { publishSavedItem, useStudioSaveEntry, type StudioSaveResult } from './studioSaveBar.js';

export interface HookItem {
  name?: string;
  label?: string;
  object?: string | string[];
  async?: boolean;
  [key: string]: unknown;
}

/** The body out of a `getDraft()` envelope, decoration-free (objectui#8181). */
const draftBody = (resp: unknown): HookItem | null => extractDraftBody(resp) as HookItem | null;

/** Does this hook's `object` target match the object we're viewing? */
export function targetsObject(hook: HookItem, objectName: string): boolean {
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

/** The order the hooks buffer saves in, after the object and its extension: a hook reads the object's fields. */
const HOOKS_SAVE_ORDER = 3;

export interface ObjectHooksBuffer {
  /** The hooks that fire on the object, a new unsaved one last. */
  hooks: readonly HookItem[];
  /** Listed hooks whose pending draft the server refused to read (objectstack#29148). */
  refusedHooks: ReadonlyMap<string, unknown>;
  loading: boolean;
  error: string | null;
  selected: string | null;
  /** The open hook as edited, or `null`. */
  draft: HookItem | null;
  /** The open hook holds edits the server does not have (a new hook always does). */
  dirty: boolean;
  /** A Save of the open hook is in flight. */
  saving: boolean;
  /** The stored name, while the buffer's `name` differs from it. */
  renamedFrom: string | null;
  /** The open hook's expression errors, as its inspector last reported them. */
  blockingIssues: number;
  /** The package's objects, for the target picker (objectui#11820); `null` until read. */
  hookTargetScope: HookTargetScope | null;
  /** Open a hook; asks first over an unsaved edit of another. */
  select: (name: string | null) => void;
  /** Patch the open hook. */
  patch: (change: Partial<HookItem>) => void;
  /** Replace the open hook's body (the generic form's whole-value change). */
  replace: (next: HookItem) => void;
  /** Start a new hook on the object: listed and opened, sent by Save. */
  addHook: () => void;
  /** The open hook's inspector reports its expression errors. */
  reportCel: (count: number) => void;
  /** The draft conflict dialog; render it once. */
  dialog: React.ReactElement;
}

export function useObjectHooksBuffer({
  objectName,
  packageId,
  active,
  disabled,
  publishNonce = 0,
}: {
  objectName: string;
  packageId: string;
  /** The Hooks tab is open: the first time for this object, the list is read. */
  active: boolean;
  disabled?: boolean;
  /** Bumped by a package publish, which drops every draft and the versions its saves received. */
  publishNonce?: number;
}): ObjectHooksBuffer {
  const locale = useMetadataLocale();
  const client = useMetadataClient();
  const key = `${packageId}/${objectName}`;
  // Latched: once opened for this object, the buffer stays read while other tabs show.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (active && objectName && openedFor !== key) setOpenedFor(key);
  const live = openedFor === key;

  const [listed, setListed] = React.useState<HookItem[]>([]);
  // The new hook "+ New" started, until a Save writes it.
  const [created, setCreated] = React.useState<HookItem | null>(null);
  // The listed hooks with a pending draft at this package: a refused Save keeps such a draft.
  const [drafted, setDrafted] = React.useState<ReadonlySet<string>>(() => new Set());
  const [refusedHooks, setRefusedHooks] = React.useState<ReadonlyMap<string, unknown>>(() => new Map());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<HookItem | null>(null);
  // The hook whose body the buffer holds (`selected` once its install has run).
  const [draftFor, setDraftFor] = React.useState<string | null>(null);
  const [edited, setEdited] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  const reloadHooks = React.useCallback(() => setNonce((n) => n + 1), []);
  const { save: saveHookDraft, recordRead: recordHookRead, forget: forgetHookVersion, dialog } = useDraftSaveGuard(
    client,
    reloadHooks,
  );
  React.useEffect(() => {
    forgetHookVersion();
  }, [publishNonce, forgetHookVersion]);
  const publishNonceRef = React.useRef(publishNonce);
  React.useLayoutEffect(() => {
    publishNonceRef.current = publishNonce;
  });

  const hooks = React.useMemo(
    () => (created && !listed.some((h) => h.name === created.name) ? [...listed, created] : listed),
    [listed, created],
  );
  const isCreated = created !== null && draftFor === created.name;
  const dirty = edited || isCreated;

  // objectui#11820 — the objects of this package for the target picker, stamped
  // with the package and object it was read for.
  const [packageScope, setPackageScope] = React.useState<
    (HookTargetScope & { packageId: string; objectName: string }) | null
  >(null);
  React.useEffect(() => {
    if (!live) return;
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
  }, [client, packageId, objectName, live]);
  const hookTargetScope =
    packageScope && packageScope.packageId === packageId && packageScope.objectName === objectName
      ? packageScope
      : null;

  // objectui#4527 — the open hook's blocking expression errors, stamped with
  // the hook they describe, so a late report never holds another hook.
  const [celErrors, setCelErrors] = React.useState<{ hook: string; count: number }>({ hook: '', count: 0 });
  const selectedHookName = String(draft?.name ?? '');
  const reportCel = React.useCallback(
    (count: number) => {
      setCelErrors((prev) =>
        prev.hook === selectedHookName && prev.count === count ? prev : { hook: selectedHookName, count },
      );
    },
    [selectedHookName],
  );
  const blockingIssues = celErrors.hook === selectedHookName ? celErrors.count : 0;

  // Read by the list load and the install below: the hook the buffer holds and
  // whether it holds an unsent edit.
  const bufferRef = React.useRef({ hook: draftFor, dirty, body: draft });
  React.useLayoutEffect(() => {
    bufferRef.current = { hook: draftFor, dirty, body: draft };
  });

  // Another object: nothing of the last one's hooks is kept.
  React.useEffect(() => {
    setListed([]);
    setCreated(null);
    setSelected(null);
    setDrafted(new Set());
    setRefusedHooks(new Map());
    setError(null);
    setLoading(true);
  }, [key]);

  React.useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const publishAtStart = publishNonceRef.current;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // `list()` serves published hooks only; a pending draft is read too,
        // each at the address its save writes, and wins over its published row.
        const [pub, draftHeaders] = await Promise.all([
          client.list('hook', { packageId }) as Promise<HookItem[]>,
          client.listDrafts({ packageId, type: 'hook' }).catch(() => null),
        ]);
        const draftNames = (draftHeaders || []).map((d) => String(d.name ?? '')).filter(Boolean);
        const reads = await Promise.all(draftNames.map((n) => readDraftForSave(client, 'hook', n, packageId)));
        if (cancelled) return;
        const byName = new Map<string, HookItem>();
        // What the next save of each listed hook is pinned to: no pin where the
        // drafts ledger could not be read, since it says nothing.
        const pins = new Map<string, DraftPin | null>();
        const refused = new Map<string, unknown>();
        const pending = new Set<string>();
        for (const h of pub || []) {
          if (h?.name && targetsObject(h, objectName)) {
            byName.set(String(h.name), h);
            pins.set(String(h.name), draftHeaders ? { ifNoneMatch: '*' } : null);
          }
        }
        draftNames.forEach((n, i) => {
          const read = reads[i]!;
          // objectstack#29148 — a refused draft is not this hook's absence.
          if ('refused' in read) {
            if (byName.has(n)) {
              refused.set(n, read.refused);
              pins.set(n, null);
            }
            return;
          }
          const body = draftBody(read.answer);
          if (body && targetsObject(body, objectName)) byName.set(n, body);
          if (byName.has(n)) {
            pins.set(n, read.pin);
            if (read.answer !== null) pending.add(n);
          }
        });
        setListed([...byName.values()]);
        setRefusedHooks(refused);
        setDrafted(pending);
        // A hook whose buffer holds an unsent edit keeps the pin that edit was built on.
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
  }, [client, packageId, objectName, nonce, recordHookRead, live]);

  // Load the selected hook into the buffer: on a selection change and when the
  // list changes, except over an unsent edit of that same hook.
  React.useEffect(() => {
    if (selected !== null && bufferRef.current.hook === selected && bufferRef.current.dirty) return;
    // objectstack#29148 — no buffer over a draft the server refused to read.
    const hook = selected !== null && refusedHooks.has(selected) ? null : (hooks.find((h) => h.name === selected) ?? null);
    setDraft(hook ? { ...hook } : null);
    setDraftFor(hook ? selected : null);
    setEdited(false);
  }, [selected, hooks, refusedHooks]);

  const select = React.useCallback(
    (name: string | null) => {
      if (name === bufferRef.current.hook) {
        setSelected(name);
        return;
      }
      if (!confirmDropUnsavedWork(bufferRef.current.dirty, locale)) return;
      setCreated(null);
      setEdited(false);
      setSelected(name);
    },
    [locale],
  );

  const patch = React.useCallback((change: Partial<HookItem>) => {
    setDraft((d) => (d ? { ...d, ...change } : d));
    setEdited(true);
  }, []);
  const replace = React.useCallback((next: HookItem) => {
    setDraft(next);
    setEdited(true);
  }, []);

  const addHook = React.useCallback(() => {
    if (!confirmDropUnsavedWork(bufferRef.current.dirty, locale)) return;
    const name = nextHookName(objectName, listed.map((h) => String(h.name ?? '')));
    // A complete, valid skeleton: a hook needs an object, an event and a body.
    const fresh: HookItem = {
      name,
      label: t('engine.studio.hooks.newLabel', locale),
      object: objectName,
      events: ['beforeInsert'],
      body: { language: 'js', source: 'return;' },
      priority: 100,
      async: false,
    };
    setError(null);
    setEdited(false);
    setCreated(fresh);
    setSelected(name);
  }, [objectName, listed, locale]);

  const renamedFrom =
    draft !== null && draftFor !== null && String(draft.name ?? '') !== draftFor ? draftFor : null;

  // The top bar's Save for the open hook: its draft, then that hook's publish.
  const save = React.useCallback(async (): Promise<StudioSaveResult> => {
    const name = draftFor;
    const body = draft;
    if (name === null || !body) return { kind: 'declined' };
    const isNew = created !== null && created.name === name;
    const hadDraft = drafted.has(name);
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        // objectui#11773 — a create is the first-write pin: refused where the
        // name already holds a draft, instead of written over it.
        await client.save('hook', name, body, { mode: 'draft', packageId, ifNoneMatch: '*', surface: 'studio' });
      } else if (
        (await saveHookDraft('hook', name, body, { mode: 'draft', packageId, surface: 'studio' })) === 'reloaded'
      ) {
        // The author chose the saved version: the list re-read installs it.
        setEdited(false);
        return { kind: 'declined' };
      }
      const outcome = await publishSavedItem(client, { type: 'hook', name, packageId }, hadDraft);
      if (!outcome.ok) {
        if (outcome.draftDiscarded) {
          recordHookRead('hook', name, packageId, { ifNoneMatch: '*' });
        } else {
          // The draft stays pending (a copilot's, or one its discard could not take back).
          setDrafted((prev) => new Set(prev).add(name));
          if (isNew) {
            setCreated(null);
            setListed((list) => [...list.filter((h) => h.name !== name), body]);
          }
        }
        const reason = formatMetadataError(outcome.error);
        setError(reason);
        return { kind: 'refused', reason };
      }
      // Live: no draft is left, so the next save asserts none.
      recordHookRead('hook', name, packageId, { ifNoneMatch: '*' });
      setDrafted((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      // The list now holds what was saved; a hook no longer aimed at this object leaves it.
      setListed((list) => {
        const kept = list.filter((h) => h.name !== name);
        if (!targetsObject(body, objectName)) return kept;
        const at = list.findIndex((h) => h.name === name);
        return at < 0 ? [...kept, body] : list.map((h, i) => (i === at ? body : h));
      });
      if (isNew) setCreated(null);
      if (JSON.stringify(bufferRef.current.body) === JSON.stringify(body)) setEdited(false);
      return { kind: 'saved' };
    } catch (e) {
      const reason = formatMetadataError(e);
      setError(reason);
      return { kind: 'refused', reason };
    } finally {
      setSaving(false);
    }
  }, [client, draft, draftFor, created, drafted, packageId, objectName, saveHookDraft, recordHookRead]);

  const cancel = React.useCallback(() => {
    setError(null);
    setEdited(false);
    if (isCreated) {
      setCreated(null);
      setSelected(null);
      return;
    }
    const hook = listed.find((h) => h.name === draftFor) ?? null;
    setDraft(hook ? { ...hook } : null);
  }, [isCreated, listed, draftFor]);

  const label = String(draft?.label || draft?.name || draftFor || '');
  const held =
    renamedFrom !== null
      ? tFormat('engine.studio.held.hookRename', locale, { name: renamedFrom })
      : blockingIssues > 0
        ? tFormat('engine.studio.held.celInvalidHook', locale, { hook: label })
        : null;
  useStudioSaveEntry(
    live && draftFor !== null && !disabled
      ? { label, order: HOOKS_SAVE_ORDER, dirty, held, save, cancel }
      : null,
  );

  return {
    hooks: live ? hooks : [],
    refusedHooks,
    loading: !live || loading,
    error,
    selected,
    draft,
    dirty,
    saving,
    renamedFrom,
    blockingIssues,
    hookTargetScope,
    select,
    patch,
    replace,
    addHook,
    reportCel,
    dialog,
  };
}
