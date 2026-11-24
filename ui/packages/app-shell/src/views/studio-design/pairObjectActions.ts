// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30088 (ADR-0146 D3) — the actions a read-only base's pair adds
 * to one of the base's objects, for the Data pillar's Actions view.
 *
 * On a writable package an action is edited on the object draft
 * (`draft.actions`, saved with the object). A read-only base's object
 * is never written, so an action added to it is its own `action` item in the
 * base's pair (`<base>.custom`), bound to the object by `objectName`: the item
 * the metadata door already takes (`PUT /meta/action/NAME?package=PAIR&mode=draft`),
 * then publishes on its own (`POST /meta/action/NAME/publish?package=PAIR`).
 *
 * This hook is that item's list and buffer. It lives at the Data pillar, not
 * in the Actions view, so an unsaved edit outlives a tab switch:
 *
 *  - **Read** at the pair the surface lists (or the one the ensure door
 *    answered): its published actions and its pending drafts, each draft read
 *    at the address its save writes, so the version it serves pins that save
 *    (objectui#11773). Only the items whose `objectName` is this object are
 *    kept. A draft wins over the published row of its name.
 *  - **Create**, **Edit** and **Remove** stay on the page and send nothing
 *    (objectstack#36511). The top bar's Save asks the ensure door for the pair
 *    (once per base, again only after a refusal) and there deletes each
 *    removed row's draft and published item, then writes each added or edited
 *    row's draft and publishes that one action, so it is live at once. A new
 *    item's write is pinned `ifNoneMatch: '*'`. ⛔ The pair a write names is
 *    the door's answer, never a `<base>.custom` spelled here. Cancel drops it
 *    all and reads the pair again.
 *  - The Save is held while a row's name differs from the one it is stored
 *    under (an item is stored under its name; `renamedFrom`), or while its
 *    editor reports an expression error (`reportBlocking`).
 *
 * objectstack#35054 (route D) — a row's BUFFER is the action as its author
 * stored it. The pair's list and its served drafts are translated for the
 * console's locale (`action` is a translatable type: its `label`, its
 * confirmation and success text), and a Save sends the buffer whole, so
 * a buffer seeded from them stored the translations as the action's source
 * text. The served reads decide which rows are listed and the draft pins; each
 * row's body comes from the layered read at the same pair, through the one
 * reading the Studio editors share (`authoredBuffer`): the stored pending
 * draft, else the published action. A row whose stored copy is not served
 * (`unserved`) stays listed and is not edited: ⛔ never buffered from the
 * served copy.
 */

import * as React from 'react';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { authoredBuffer, extractDraftBody, formatMetadataError, type AuthoredLayers } from '@object-ui/data-objectstack';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { t as tStudio, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { readDraftForSave, useDraftSaveGuard, type DraftPin } from '../metadata-admin/DraftConflictDialog.js';
import { publishSavedItem, useStudioSaveEntry, type StudioSaveResult } from './studioSaveBar.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
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
  /**
   * objectstack#35054 — the layered read served no stored copy of this row
   * (a pending draft it did not serve, or nothing at all): `body` is the
   * served copy, for display only, and the row takes no edit.
   */
  unserved?: true;
}

export interface PairObjectActions {
  /** The pair's actions on this object, the listing's order, a removed one left out. Empty without a door. */
  rows: readonly PairActionRow[];
  /** The pair the rows are read and written at, once known. */
  pairId: string | null;
  /** A read or write of the pair failed: the server's sentence. */
  error: string | null;
  /** A Save of the pair's actions is in flight. */
  saving: boolean;
  /** Some row holds an edit, an addition or a removal the server does not have. */
  dirty: boolean;
  /** The row's stored name, while its buffer's `name` differs from it (the edit is held). */
  renamedFrom(name: string): string | null;
  /** Add a new action to the page; Save writes it into the pair. Resolves whether it was added. */
  create(action: Record<string, unknown>): Promise<boolean>;
  /** Patch a row's buffer; Save sends it. */
  patch(name: string, patch: Record<string, unknown>): void;
  /** Take a row off the page; Save deletes its draft and published item at the pair. */
  remove(name: string): Promise<void>;
  /** The open action editor's expression errors for a row, by its name. */
  reportBlocking(name: string, count: number): void;
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

/** The order the pair's actions save in, after the object and its extension. */
const PAIR_ACTIONS_SAVE_ORDER = 2;

/**
 * The pair's actions on `objectName`. `door` null (a writable package, an
 * object the pair adds, a base whose list has not answered) reads nothing and
 * offers nothing; the Actions view then edits `draft.actions` as before.
 * Nothing is read until `opened` (the Actions tab is shown) for this object;
 * the read then stays with the object, so an edit outlives a tab switch.
 */
export function usePairObjectActions(
  door: PairActionsDoor | null,
  objectName: string,
  opened: boolean,
): PairObjectActions {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const localeRef = React.useRef(locale);
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (opened && door !== null && objectName && openedFor !== objectName) setOpenedFor(objectName);
  const active = door !== null && openedFor === objectName;
  const listedPair = door?.pairId ?? null;
  const publishNonce = door?.publishNonce ?? 0;
  // The door's answer once a write asked it: it names every later write, and
  // the reads follow it until the surface lists the same pair.
  const [ensured, setEnsured] = React.useState<string | null>(null);
  const pairId = listedPair ?? ensured;
  const [rows, setRows] = React.useState<{ for: string; pair: string | null; list: PairActionRow[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // The page's unsaved work: rows edited, rows added and not written, rows taken off.
  const [edited, setEdited] = React.useState<ReadonlySet<string>>(() => new Set());
  const [created, setCreated] = React.useState<ReadonlySet<string>>(() => new Set());
  const [removed, setRemoved] = React.useState<ReadonlySet<string>>(() => new Set());
  const [blocking, setBlocking] = React.useState<Readonly<Record<string, number>>>({});
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  const { save: saveGuarded, recordRead, forget, dialog } = useDraftSaveGuard(client, reload);
  React.useEffect(() => {
    forget();
  }, [publishNonce, forget]);

  // Read per render by the callbacks below, never an effect's dependency
  // (ui/AGENTS.md #10): the door object is rebuilt by every render of the pillar.
  const doorRef = React.useRef(door);
  const pendingRef = React.useRef({ edited, created });
  React.useLayoutEffect(() => {
    doorRef.current = door;
    pendingRef.current = { edited, created };
    localeRef.current = locale;
  });

  // Another object: nothing of the last one's unsaved work is kept.
  React.useEffect(() => {
    setEdited(new Set());
    setCreated(new Set());
    setRemoved(new Set());
    setBlocking({});
    setError(null);
  }, [objectName]);

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
        // The served draft body of each listed draft row: it only says a draft is pending.
        const servedDrafts = new Map<string, Record<string, unknown>>();
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
          servedDrafts.set(name, served!);
          pins.set(name, read.pin);
        });
        // objectstack#35054 — each listed row's buffer is its stored body,
        // read at the pair the served reads were (module header).
        const listed = [...byName.keys()];
        const layers = await Promise.all(
          listed.map((name) => client.layered<Record<string, unknown>>('action', name, { packageId: readAt })),
        );
        if (cancelled) return;
        listed.forEach((name, i) => {
          const row = byName.get(name)!;
          const authored = authoredBuffer('action', layers[i] as AuthoredLayers, servedDrafts.get(name) ?? null);
          const body = authored.kind === 'buffer' ? ownBody(authored.body) : null;
          byName.set(
            name,
            body && Object.keys(body).length > 0 ? { ...row, body } : { ...row, unserved: true },
          );
        });
        const open = pendingRef.current;
        setRows((prev) => {
          const list = [...byName.values()];
          // A buffer holding unsaved work is newer than what the read served.
          const mine = prev?.for === objectName ? prev.list : [];
          const merged = list.map((r) => {
            const kept = open.edited.has(r.name) ? mine.find((m) => m.name === r.name) : undefined;
            return kept ? { ...r, body: kept.body } : r;
          });
          const added = mine.filter((m) => open.created.has(m.name) && !byName.has(m.name));
          return { for: objectName, pair: readAt, list: [...merged, ...added] };
        });
        for (const [name, pin] of pins) {
          if (!open.edited.has(name)) recordRead('action', name, readAt, pin);
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

  const all = active && rows !== null && rows.for === objectName && (rows.pair === pairId || rows.pair === null) ? rows.list : NO_ROWS;
  const list = React.useMemo(() => (removed.size === 0 ? all : all.filter((r) => !removed.has(r.name))), [all, removed]);
  const allRef = React.useRef(all);
  React.useLayoutEffect(() => {
    allRef.current = all;
  });

  const renamedFrom = React.useCallback(
    (name: string): string | null => {
      const row = list.find((r) => r.name === name);
      return row && typeof row.body.name === 'string' && row.body.name !== name ? name : null;
    },
    [list],
  );

  const patch = React.useCallback((name: string, change: Record<string, unknown>) => {
    if (doorRef.current?.walled) return;
    // A row with no stored copy served takes no edit (objectstack#35054).
    if (allRef.current.find((r) => r.name === name)?.unserved) {
      setError(tStudio('engine.studio.refusal.draftUnreadable', localeRef.current));
      return;
    }
    setRows((prev) =>
      prev === null
        ? prev
        : { ...prev, list: prev.list.map((r) => (r.name === name ? { ...r, body: { ...r.body, ...change } } : r)) },
    );
    setEdited((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);

  const create = React.useCallback(
    async (action: Record<string, unknown>): Promise<boolean> => {
      const name = String(action.name ?? '');
      if (!name || doorRef.current?.walled) return false;
      setError(null);
      setRows((prev) => {
        const row: PairActionRow = { name, body: action, published: false, draft: false };
        const base = prev !== null && prev.for === objectName ? prev : { for: objectName, pair: pairId, list: [] };
        return { ...base, list: [...base.list.filter((r) => r.name !== name), row] };
      });
      setCreated((prev) => new Set(prev).add(name));
      return true;
    },
    [objectName, pairId],
  );

  const remove = React.useCallback(async (name: string) => {
    if (doorRef.current?.walled) return;
    if (pendingRef.current.created.has(name)) {
      // Never written: it simply leaves the page.
      setRows((prev) => (prev === null ? prev : { ...prev, list: prev.list.filter((r) => r.name !== name) }));
      setCreated((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      return;
    }
    setRemoved((prev) => new Set(prev).add(name));
  }, []);

  const reportBlocking = React.useCallback((name: string, count: number) => {
    setBlocking((prev) => (prev[name] === count ? prev : { ...prev, [name]: count }));
  }, []);

  const dirty = edited.size > 0 || created.size > 0 || removed.size > 0;

  // objectstack#36511 — the top bar's Save: each removed row's draft and
  // published item deleted at the pair, then each added or edited row's draft
  // written there and that one action published, so it is live at once.
  const save = React.useCallback(async (): Promise<StudioSaveResult> => {
    setSaving(true);
    setError(null);
    const refusals: string[] = [];
    try {
      let pair: string;
      try {
        pair = await pairForWrite();
      } catch (e) {
        const reason = formatMetadataError(e);
        setError(reason);
        return { kind: 'refused', reason };
      }
      for (const name of removed) {
        const row = allRef.current.find((r) => r.name === name);
        try {
          if (row?.draft) await client.reset('action', name, { state: 'draft', packageId: pair });
          if (row?.published) await client.reset('action', name, { packageId: pair });
          setRows((prev) => (prev === null ? prev : { ...prev, list: prev.list.filter((r) => r.name !== name) }));
          setRemoved((prev) => {
            const next = new Set(prev);
            next.delete(name);
            return next;
          });
          emitMetadataRefresh();
        } catch (e) {
          refusals.push(`${name}: ${formatMetadataError(e)}`);
        }
      }
      for (const name of [...created, ...edited]) {
        if (removed.has(name)) continue;
        const row = allRef.current.find((r) => r.name === name);
        if (!row) continue;
        const isNew = created.has(name);
        try {
          if (isNew) {
            // objectui#11773 — a create is the first-write pin.
            await client.save('action', name, row.body, { mode: 'draft', packageId: pair, ifNoneMatch: '*', surface: 'studio' });
          } else if (
            (await saveGuarded('action', name, row.body, { mode: 'draft', packageId: pair, surface: 'studio' })) === 'reloaded'
          ) {
            setEdited(new Set());
            continue;
          }
          const outcome = await publishSavedItem(client, { type: 'action', name, packageId: pair }, row.draft);
          if (!outcome.ok) {
            if (outcome.draftDiscarded) recordRead('action', name, pair, { ifNoneMatch: '*' });
            else setRows((prev) => (prev === null ? prev : { ...prev, list: prev.list.map((r) => (r.name === name ? { ...r, draft: true } : r)) }));
            refusals.push(`${String(row.body.label ?? name)}: ${formatMetadataError(outcome.error)}`);
            continue;
          }
          recordRead('action', name, pair, { ifNoneMatch: '*' });
          setRows((prev) =>
            prev === null
              ? prev
              : { ...prev, pair, list: prev.list.map((r) => (r.name === name ? { ...r, draft: false, published: true } : r)) },
          );
          const sentBody = row.body;
          const unmoved = JSON.stringify(allRef.current.find((r) => r.name === name)?.body) === JSON.stringify(sentBody);
          if (isNew) {
            setCreated((prev) => {
              const next = new Set(prev);
              next.delete(name);
              return next;
            });
          }
          if (unmoved && !isNew) {
            setEdited((prev) => {
              const next = new Set(prev);
              next.delete(name);
              return next;
            });
          } else if (!unmoved) setEdited((prev) => new Set(prev).add(name));
        } catch (e) {
          refusals.push(`${String(row.body.label ?? name)}: ${formatMetadataError(e)}`);
        }
      }
      // The pair may be new: the surface lists it from here on.
      reload();
    } finally {
      setSaving(false);
    }
    if (refusals.length > 0) {
      const reason = refusals.join('\n');
      setError(reason);
      return { kind: 'refused', reason };
    }
    return { kind: 'saved' };
  }, [client, created, edited, removed, pairForWrite, saveGuarded, recordRead, reload]);

  const cancel = React.useCallback(() => {
    setError(null);
    setCreated(new Set());
    setEdited(new Set());
    setRemoved(new Set());
    setRows((prev) => (prev === null ? prev : { ...prev, list: prev.list.filter((r) => !pendingRef.current.created.has(r.name)) }));
    // The edited rows are read again as the pair holds them.
    reload();
  }, [reload]);

  const firstRenamed = list.find((r) => typeof r.body.name === 'string' && r.body.name !== r.name && edited.has(r.name));
  const firstBlocked = list.find((r) => (blocking[r.name] ?? 0) > 0 && (edited.has(r.name) || created.has(r.name)));
  const held = firstRenamed
    ? tFormat('engine.studio.held.pairActionRename', locale, { name: firstRenamed.name })
    : firstBlocked
      ? tFormat('engine.studio.held.celInvalidAction', locale, { action: String(firstBlocked.body.label ?? firstBlocked.name) })
      : null;
  const labels = [...created, ...edited, ...removed].map((n) => {
    const row = all.find((r) => r.name === n);
    return String(row?.body.label ?? n);
  });
  useStudioSaveEntry(
    active && !door?.walled
      ? {
          label: [...new Set(labels)].join(tStudio('engine.studio.save.itemSeparator', locale)),
          order: PAIR_ACTIONS_SAVE_ORDER,
          dirty,
          held,
          save,
          cancel,
        }
      : null,
  );

  return {
    rows: list,
    pairId: active ? (rows?.pair ?? pairId) : null,
    error: active ? error : null,
    saving,
    dirty,
    renamedFrom,
    create,
    patch,
    remove,
    reportBlocking,
    dialog,
  };
}
