// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The debounced draft autosave every Studio editor shares (objectui#5813).
 *
 * Moved out of `StudioDesignSurface.tsx` unchanged by objectui#11787 so that the
 * package door's permission matrix (`metadata-admin/PermissionMatrixEditor.tsx`)
 * and the Data pillar's hooks panel (`ObjectHooksPanel.tsx`) run the same
 * autosave as the pillars, not a second debounce. A module of its own because
 * the matrix cannot import the surface: the surface imports the matrix, and
 * the matrix is also loaded on the environment-admin route, where the surface
 * is not.
 */

import * as React from 'react';

// objectui#5813 — debounced draft auto-save, shared by the pillars' editors.
// Drafts never touch the live app, so persisting them automatically is
// zero-risk; the Save draft buttons it replaces were a standing tax on the
// topbars AND a real loss point (forgot-to-save). Semantics:
//  - re-arms 1.5s after the LAST edit (the snapshot key changes per edit);
//  - `blocked` mirrors each site's old disabled-guard — in particular a
//    CEL-blocking inspector must gate the TIMER, not just a button, or the
//    timer publishes the malformed definition a second later (objectui#4306);
//  - a FAILED save does not retry until the user edits again (the snapshot
//    it attempted is remembered), so an invalid draft can't toast-loop.
//  - objectui#11189 — the returned `flush` fires the pending save now instead
//    of at the timer, under the same conditions, and says whether a save went
//    out. A flushed snapshot counts as attempted, so the timer never sends it
//    a second time.
//  - objectui#11204 — a save that lands clears its dirty flag only if nothing
//    was edited while it was in flight. The hook hands every save it sends a
//    `DraftSend` claim on the snapshot it sent, and the caller's
//    `set*Dirty(false)` after its await runs only while `sent.unmoved()`. An
//    edit taken meanwhile keeps the buffer dirty, and the autosave, unblocked
//    by the save's end, sends it next. A save the caller sends itself takes
//    its claim from `sending(body)`.
//  - objectui#11232 — a dirty period belongs to the item that was open when it
//    began. The caller names the item its `save` addresses as `target`, a
//    primitive identity (type and name; never a memoised object, AGENTS.md
//    #10). On a switch the caller's `save` addresses the newly opened item at
//    once, while the buffer holds the previous item's document until the new
//    load installs its own; so a period that began on another item is never
//    sent, by the timer or by `flush`, and it ends only when the caller's dirty
//    flag falls.
//    The previous item's pending edit is dropped: what the Data pillar's switch
//    has always done, and what every pillar did whenever the new load landed
//    inside the debounce. A claim also reads moved once the target has
//    changed, so a save that lands after a switch never clears the dirty flag
//    of the item opened since.
//  - objectui#11272 — the buffer belongs to the item it was loaded for. The
//    caller names that item as `loadedFor`, in `target`'s spelling, and sets
//    it where its load installs a buffer and nowhere else. Until the open
//    item's own document is in, `loadedFor` is not `target`: then the timer
//    and `flush` send nothing, `sending` gives no claim (every save the caller
//    sends itself asks it first, and sends nothing without one), and `loaded`
//    is false, which the caller reads to show and offer nothing of the buffer
//    under the open item. An edit a period begins while the buffer is another
//    item's is never sent. It ends with the dirty flag, which every caller's
//    buffer install clears: the page inspector's and the Data pillar's as
//    they install (the Data pillar also at its load's start), a leaf with no
//    editable draft as its `{}` goes in, and Automations when the load
//    settles. The Interfaces nav installs only over a clean buffer, or on its
//    mount (it is keyed by package).

/**
 * objectui#11204 — one draft save's claim on the buffer it sent. `unmoved()`
 * is true while the buffer, as last committed, is still the snapshot that
 * save sent, compared the way the autosave compares snapshots (serialised).
 * It compares content, not an edit count: an edit undone while the save was
 * in flight leaves the buffer as the server now holds it, and so clean.
 * objectui#11232 — and only while the hook's `target` is still the item the
 * save was sent for: after a switch the buffer is the next item's to clear.
 */
export interface DraftSend {
  unmoved: () => boolean;
}

function draftSnapshotKey(snapshot: unknown): string {
  try {
    return JSON.stringify(snapshot ?? null);
  } catch {
    // Unserializable draft (never the case for metadata bodies): a constant
    // key means one auto-save per dirty period instead of per edit, and a
    // save that lands always reads unmoved: degraded, as before.
    return '"__unserializable__"';
  }
}

export function useDraftAutoSave(opts: {
  /** objectui#11232 — the item `save` addresses, as a primitive identity. */
  target: string;
  /** objectui#11272 — the item whose document the buffer holds: the target
   * the caller's load installed it for, in the same spelling. */
  loadedFor: string;
  dirty: boolean;
  blocked: boolean;
  snapshot: unknown;
  save: (sent: DraftSend) => void | Promise<void>;
}): {
  flush: () => boolean;
  /** A claim for a save the caller sends itself; `null` refuses it (objectui#11272). */
  sending: (snapshot: unknown) => DraftSend | null;
  /** objectui#11272 — the buffer is the open item's own document. */
  loaded: boolean;
} {
  const { target, loadedFor, dirty, blocked, snapshot, save } = opts;
  // Pure (the react compiler forbids impure render calls).
  const snapKey = React.useMemo(() => draftSnapshotKey(snapshot), [snapshot]);
  const lastAttemptRef = React.useRef<string | null>(null);
  const saveRef = React.useRef(save);
  // What the timer below would send, as last committed, for `flush` and for a
  // landing save's claim to read. A layout effect, so it is current as soon as
  // a render commits: a save that lands right after an edit reads the edit.
  // `since` is the target the dirty period began on (objectui#11232): taken
  // as the flag rises, kept while it stays up.
  const pendingRef = React.useRef({ dirty, blocked, snapKey, target, loadedFor, since: target });
  React.useLayoutEffect(() => {
    const prev = pendingRef.current;
    saveRef.current = save;
    pendingRef.current = { dirty, blocked, snapKey, target, loadedFor, since: dirty && prev.dirty ? prev.since : target };
  });
  // A state initializer, not a memo: React keeps its identity by contract, so
  // a caller may list it, or a member of it, as an effect dependency
  // (AGENTS.md #10).
  const [api] = React.useState(() => {
    const claim = (key: string, sentFor: string): DraftSend => ({
      unmoved: () => pendingRef.current.target === sentFor && pendingRef.current.snapKey === key,
    });
    // objectui#11232 — the pending edit is the open item's own: its dirty
    // period began on the item `save` now addresses. objectui#11272 — and the
    // buffer it edits is that item's document: its load installed it for it.
    const owned = (): boolean => {
      const { since, target: now, loadedFor: holds } = pendingRef.current;
      return since === now && holds === now;
    };
    const send = (key: string): void => {
      lastAttemptRef.current = key;
      void saveRef.current(claim(key, pendingRef.current.target));
    };
    return {
      send,
      owned,
      flush: (): boolean => {
        const pending = pendingRef.current;
        if (!pending.dirty || pending.blocked || !owned() || lastAttemptRef.current === pending.snapKey) return false;
        send(pending.snapKey);
        return true;
      },
      sending: (sent: unknown): DraftSend | null =>
        owned() ? claim(draftSnapshotKey(sent), pendingRef.current.target) : null,
    };
  });
  React.useEffect(() => {
    if (!dirty || blocked) return;
    if (lastAttemptRef.current === snapKey) return;
    const timer = setTimeout(() => {
      if (lastAttemptRef.current === snapKey) return;
      // Read as last committed: a switch since the edit left it with its item.
      if (!api.owned()) return;
      api.send(snapKey);
    }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, blocked, snapKey, api]);
  return { flush: api.flush, sending: api.sending, loaded: loadedFor === target };
}
