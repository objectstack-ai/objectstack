// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30088 (ADR-0146 D3) — the actions a read-only base's pair adds
 * to one of the base's objects, for the Data pillar's Actions view.
 *
 * On a writable package an action is edited on the object draft
 * (`draft.actions`, saved by the object's autosave). A read-only base's object
 * is never written, so an action added to it is its own `action` item in the
 * base's pair (`<base>.custom`), bound to the object by `objectName`: the item
 * the metadata door already takes (`PUT /meta/action/NAME?package=PAIR&mode=draft`)
 * and the pair's `publish-drafts` publishes with the rest of its drafts.
 *
 * This hook is that item's list and buffer:
 *
 *  - **Read** at the pair the surface lists (or the one the ensure door
 *    answered): its published actions and its pending drafts, each draft read
 *    at the address its save writes, so the version it serves pins that save
 *    (objectui#11773). Only the items whose `objectName` is this object are
 *    kept. A draft wins over the published row of its name.
 *  - **Create** asks the ensure door for the pair (once per base, again only
 *    after a refusal) and writes the new item there as a draft, pinned
 *    `ifNoneMatch: '*'`. ⛔ The pair a write names is the door's answer, never
 *    a `<base>.custom` spelled here.
 *  - **Edit** patches the row, which is the buffer; the shared autosave
 *    (`useDraftAutoSave`) sends it 1.5 s after the last edit, held while a CEL
 *    syntax error stands (`blockingOf`) or while the name differs from the one
 *    the item is stored under (an item is stored under its name, so a rename
 *    sent per keystroke would stage one more action per pause, as the hooks
 *    panel measured; `renamedFrom`).
 *  - **Remove** deletes the pair's draft, then its published row, at the pair:
 *    the Automations pillar's Delete flow. The base's actions are never
 *    written.
 */

import * as React from 'react';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { extractDraftBody, formatMetadataError } from '@object-ui/data-objectstack';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { readDraftForSave, useDraftSaveGuard, type DraftPin } from '../metadata-admin/DraftConflictDialog.js';
import { useDraftAutoSave, type DraftSend } from './useDraftAutoSave.js';
import type { RailCustomizations } from './StudioRailCustomizations.js';
import type { StudioSavedDraft } from './StudioPillarKit.js';

/** What the Actions view needs of a read-only base's pair, from the Data pillar. */
export interface PairActionsDoor {
  /** The base's pair for READS: listed, or the ensure door's answer; `null` while it has none. */
  pairId: string | null;
  /** The ensure door: resolves the pair id every write names; rejects with its refusal. */
  ensure: () => Promise<string>;
  /** The ensure door refuses this caller: nothing is offered to add, and the pair's actions open read-only. */
  walled: boolean;
  /** The base's rail marks (its served customization read): an added action carries its mark. */
  marks: RailCustomizations | null;
  /** Bumped by a package publish, which drops every draft and the versions its saves received. */
  publishNonce: number;
  /** A draft landed or went: the surface's pending changes read again. */
  onDraftSaved?: (saved?: StudioSavedDraft) => void;
}

/** One action of the pair on this object. */
export interface PairActionRow {
  /** The name the item is stored under: its key, whatever the buffer's `name` says. */
  name: string;
  /** The buffer: the draft's body, else the published row's, as edited since. */
  body: Record<string, unknown>;
  published: boolean;
  draft: boolean;
}

export interface PairObjectActions {
  /** The pair's actions on this object, the listing's order. Empty without a door. */
  rows: readonly PairActionRow[];
  /** The pair the rows are read and written at, once known. */
  pairId: string | null;
  /** A read or write of the pair failed: the server's sentence. */
  error: string | null;
  /** A write is in flight. */
  saving: boolean;
  /** The row whose buffer holds an unsent edit, or `null`. */
  dirty: string | null;
  /** When the last draft save of a row landed. */
  savedAt: { name: string; at: Date } | null;
  /** The row's stored name, while its buffer's `name` differs from it (the edit is held). */
  renamedFrom(name: string): string | null;
  /** Write a new action into the pair as a draft. Resolves whether it landed. */
  create(action: Record<string, unknown>): Promise<boolean>;
  /** Patch a row's buffer; the autosave sends it. */
  patch(name: string, patch: Record<string, unknown>): void;
  /** Delete the row's draft and published item at the pair. */
  remove(name: string): Promise<void>;
  /** The draft conflict dialog; render it once. */
  dialog: React.ReactElement;
}

const NO_ROWS: readonly PairActionRow[] = [];

/**
 * The item's own document: `raw` without its top-level `_` keys. A served row
 * (and a served draft) carries the read's decorations, `_packageId` among
 * them; they are the read's, never sent back in a save.
 */
function ownBody(raw: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((stripReadDecorations(raw) ?? {}) as Record<string, unknown>)) {
    if (!key.startsWith('_')) body[key] = value;
  }
  return body;
}

/**
 * The pair's actions on `objectName`. `door` null (a writable package, an
 * object the pair adds, a base whose list has not answered) reads nothing and
 * offers nothing; the Actions view then edits `draft.actions` as before.
 * `blockingOf` is the open editor's CEL verdict for a row, by its name.
 */
export function usePairObjectActions(
  door: PairActionsDoor | null,
  objectName: string,
  blockingOf: (name: string) => number,
): PairObjectActions {
  const client = useMetadataClient();
  const active = door !== null;
  const listedPair = door?.pairId ?? null;
  const publishNonce = door?.publishNonce ?? 0;
  // The door's answer once a write asked it: it names every later write, and
  // the reads follow it until the surface lists the same pair.
  const [ensured, setEnsured] = React.useState<string | null>(null);
  const pairId = listedPair ?? ensured;
  const [rows, setRows] = React.useState<{ for: string; pair: string; list: PairActionRow[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<{ name: string; at: Date } | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  const { save: saveGuarded, recordRead, forget, dialog } = useDraftSaveGuard(client, reload);
  React.useEffect(() => {
    forget();
  }, [publishNonce, forget]);

  // Read per render by the callbacks below, never an effect's dependency
  // (ui/AGENTS.md #10): the door object is rebuilt by every render of the pillar.
  const doorRef = React.useRef(door);
  const dirtyRef = React.useRef(dirty);
  React.useLayoutEffect(() => {
    doorRef.current = door;
    dirtyRef.current = dirty;
  });

  // The ensure door's answer for this base: asked by the first write, once,
  // and again only after a refusal.
  const askedRef = React.useRef<Promise<string> | null>(null);
  const pairForWrite = React.useCallback((): Promise<string> => {
    if (askedRef.current) return askedRef.current;
    const d = doorRef.current;
    if (!d) return Promise.reject(new Error('No customization package for this object.'));
    const asked = d.ensure();
    askedRef.current = asked;
    asked.then(
      (id) => setEnsured(id),
      () => {
        if (askedRef.current === asked) askedRef.current = null;
      },
    );
    return asked;
  }, []);

  React.useEffect(() => {
    if (!active || pairId === null || !objectName) return;
    let cancelled = false;
    const readAt = pairId;
    (async () => {
      try {
        const [pub, draftHeaders] = await Promise.all([
          client.list('action', { packageId: readAt }) as Promise<Array<Record<string, unknown>>>,
          client.listDrafts({ packageId: readAt, type: 'action' }).catch(() => null),
        ]);
        const draftNames = (draftHeaders || []).map((d) => String(d.name ?? '')).filter(Boolean);
        const reads = await Promise.all(draftNames.map((n) => readDraftForSave(client, 'action', n, readAt)));
        if (cancelled) return;
        const byName = new Map<string, PairActionRow>();
        const pins = new Map<string, DraftPin | null>();
        for (const raw of pub || []) {
          const body = ownBody(raw);
          const name = typeof body.name === 'string' ? body.name : '';
          if (!name || body.objectName !== objectName) continue;
          byName.set(name, { name, body, published: true, draft: false });
          // A ledger that was read and lists no draft of it: the next save creates one.
          pins.set(name, draftHeaders ? { ifNoneMatch: '*' } : null);
        }
        draftNames.forEach((name, i) => {
          const read = reads[i]!;
          // A draft the server refused to read is no absence: its published
          // row stays listed and pins nothing (objectstack#29148).
          if ('refused' in read) {
            if (byName.has(name)) pins.set(name, null);
            return;
          }
          const served = extractDraftBody(read.answer);
          const body = served ? ownBody(served) : null;
          if (!body || body.objectName !== objectName) return;
          byName.set(name, { name, body, published: byName.has(name), draft: true });
          pins.set(name, read.pin);
        });
        const open = dirtyRef.current;
        setRows((prev) => {
          const list = [...byName.values()];
          // A buffer holding an unsent edit is newer than what the read served.
          const kept = open !== null && prev?.for === objectName ? prev.list.find((r) => r.name === open) : undefined;
          return {
            for: objectName,
            pair: readAt,
            list: kept ? list.map((r) => (r.name === kept.name ? { ...r, body: kept.body } : r)) : list,
          };
        });
        for (const [name, pin] of pins) {
          if (name !== open) recordRead('action', name, readAt, pin);
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(formatMetadataError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, active, pairId, objectName, publishNonce, nonce, recordRead]);

  const list = active && rows !== null && rows.for === objectName && rows.pair === pairId ? rows.list : NO_ROWS;
  const listRef = React.useRef(list);
  React.useLayoutEffect(() => {
    listRef.current = list;
  });

  const renamedFrom = React.useCallback(
    (name: string): string | null => {
      const row = list.find((r) => r.name === name);
      return row && typeof row.body.name === 'string' && row.body.name !== name ? name : null;
    },
    [list],
  );

  const patch = React.useCallback(
    (name: string, change: Record<string, unknown>) => {
      if (doorRef.current?.walled) return;
      setRows((prev) =>
        prev === null
          ? prev
          : { ...prev, list: prev.list.map((r) => (r.name === name ? { ...r, body: { ...r.body, ...change } } : r)) },
      );
      setDirty(name);
    },
    [],
  );

  const create = React.useCallback(
    async (action: Record<string, unknown>): Promise<boolean> => {
      const name = String(action.name ?? '');
      if (!name) return false;
      setSaving(true);
      setError(null);
      try {
        const pair = await pairForWrite();
        // objectui#11773 — a create is the first-write pin: refused where the
        // name already holds a draft, instead of written over it.
        await client.save('action', name, action, { mode: 'draft', packageId: pair, ifNoneMatch: '*', surface: 'studio' });
        setRows((prev) => {
          const row: PairActionRow = { name, body: action, published: false, draft: true };
          const base = prev !== null && prev.for === objectName && prev.pair === pair ? prev.list : listRef.current;
          return { for: objectName, pair, list: [...base.filter((r) => r.name !== name), row] };
        });
        setSavedAt({ name, at: new Date() });
        doorRef.current?.onDraftSaved?.({ type: 'action', name });
        // The pair may be new: the surface lists it from here on.
        reload();
        return true;
      } catch (e) {
        setError(formatMetadataError(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [client, objectName, pairForWrite, reload],
  );

  const send = React.useCallback(
    async (sent: DraftSend) => {
      const name = dirtyRef.current;
      const row = name === null ? undefined : listRef.current.find((r) => r.name === name);
      if (!row) return;
      setSaving(true);
      setError(null);
      try {
        const pair = await pairForWrite();
        const outcome = await saveGuarded('action', row.name, row.body, { mode: 'draft', packageId: pair, surface: 'studio' });
        if (outcome === 'reloaded') {
          setDirty(null);
          return;
        }
        if (sent.unmoved()) setDirty(null);
        setRows((prev) =>
          prev === null ? prev : { ...prev, list: prev.list.map((r) => (r.name === row.name ? { ...r, draft: true } : r)) },
        );
        setSavedAt({ name: row.name, at: new Date() });
        doorRef.current?.onDraftSaved?.({ type: 'action', name: row.name });
      } catch (e) {
        setError(formatMetadataError(e));
      } finally {
        setSaving(false);
      }
    },
    [pairForWrite, saveGuarded],
  );

  const dirtyRow = dirty === null ? undefined : list.find((r) => r.name === dirty);
  useDraftAutoSave({
    target: `action:${dirty ?? ''}`,
    loadedFor: `action:${dirtyRow ? dirtyRow.name : ''}`,
    dirty: dirtyRow !== undefined,
    blocked:
      dirtyRow === undefined ||
      saving ||
      !!door?.walled ||
      blockingOf(dirtyRow.name) > 0 ||
      (typeof dirtyRow.body.name === 'string' && dirtyRow.body.name !== dirtyRow.name),
    snapshot: dirtyRow?.body ?? null,
    save: send,
  });

  const remove = React.useCallback(
    async (name: string) => {
      const row = listRef.current.find((r) => r.name === name);
      if (!row || doorRef.current?.walled) return;
      const pair = rows?.pair ?? null;
      if (pair === null) return;
      setSaving(true);
      setError(null);
      try {
        if (row.draft) await client.reset('action', name, { state: 'draft', packageId: pair });
        if (row.published) await client.reset('action', name, { packageId: pair });
      } catch (e) {
        setError(formatMetadataError(e));
        return;
      } finally {
        setSaving(false);
      }
      if (dirtyRef.current === name) setDirty(null);
      setRows((prev) => (prev === null ? prev : { ...prev, list: prev.list.filter((r) => r.name !== name) }));
      doorRef.current?.onDraftSaved?.({ type: 'action', name });
    },
    [client, rows],
  );

  return {
    rows: list,
    pairId: active ? (rows?.pair ?? pairId) : null,
    error: active ? error : null,
    saving,
    dirty: dirtyRow ? dirtyRow.name : null,
    savedAt,
    renamedFrom,
    create,
    patch,
    remove,
    dialog,
  };
}
