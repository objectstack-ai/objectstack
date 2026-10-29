/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The reader's arrangement of the record page's related cards
 * (objectstack#27055, Targets 7 and 10).
 *
 * Related cards are the reader's to arrange: reorder (drag, or 上移 / 下移),
 * collapse to title + count, hide. What a reader chose is kept per user ×
 * object in the console's workspace-preference store, never metadata; this
 * module is the pure rule that lays the author's default order and the
 * reader's choice over each other, so the column, the tabbed tier's 关联 tab
 * and the tests read one answer.
 *
 * ## The stored value is a DIFF against the default order
 *
 * `{ order, collapsed, hidden, basedOn }`, relationship ids being
 * `object.field` (the child object and its FK field):
 *
 *  - `order` — the order of the reader's last drag; EMPTY while the reader
 *    never dragged, which is "follow the default" (a collapse or a hide alone
 *    does not freeze the order);
 *  - `collapsed` / `hidden` — the cards the reader collapsed / hid;
 *  - `basedOn` — the hash of the default order the reader's `order` was laid
 *    over ({@link relatedDefaultOrderHash}).
 *
 * ## The merge rules (the maintainer's, on the card, each pinned by a test)
 *
 *  1. A reader who never dragged sees the default order.
 *  2. Dragged cards keep the reader's relative order; a later change to the
 *     author's default never reorders them — only 「恢复默认顺序」 does.
 *  3. A relationship new since the reader last dragged is inserted after the
 *     nearest card that precedes it in the default order and exists in the
 *     reader's order (first in default → first), carries a 「新」 badge for
 *     48 h, and takes the default collapsed state.
 *  4. A relationship that no longer exists is dropped from `order` (and from
 *     `collapsed` / `hidden`) on the next write.
 *  5. When `basedOn` differs from the current default's hash, the column
 *     says so: 「默认顺序已更新 · 恢复默认」.
 *  6. Hidden cards leave the column; its last line 「已隐藏 N 张 · 显示」
 *     brings them back.
 *
 * Rule 3's 48 h needs a clock the four keys cannot carry, so the value has
 * one more member, `seen` — when this reader first saw each new relationship
 * (epoch ms). It is written once per new relationship, by the host, and
 * dropped with the relationship.
 *
 * ## The default order (#27069 fence)
 *
 * The default order is what the HOST passes in: today the derived order
 * (`deriveRelatedLists` — `relatedList: 'primary'` first, then registration /
 * declaration order). ⛔ The object's authored `relatedLists` order is not
 * read here or anywhere on this page yet: it waits for the spec key
 * (objectstack#27069). When that key lands, the host computes the default
 * order from it at its one read point (`RecordDetailView`, beside the
 * `deriveRelatedLists` call) and this module is unchanged.
 */

/** A relationship id: `CHILD_OBJECT.FK_FIELD`. */
export type RelatedCardId = string;

/** The reader's stored arrangement — see the module header. */
export interface RelatedArrangement {
  order: RelatedCardId[];
  collapsed: RelatedCardId[];
  hidden: RelatedCardId[];
  basedOn: string;
  /** When the reader first saw each relationship new since their last drag (epoch ms). */
  seen?: Record<RelatedCardId, number>;
}

/**
 * The arrangement of a reader who chose nothing: the default order, every
 * card open and shown. Equivalent to no stored value in every rule — the
 * host's fallback while the store holds no choice.
 */
export const EMPTY_RELATED_ARRANGEMENT: RelatedArrangement = Object.freeze({
  order: [],
  collapsed: [],
  hidden: [],
  basedOn: '',
}) as RelatedArrangement;

/** How long a new relationship carries its 「新」 badge. */
export const RELATED_CARD_NEW_BADGE_MS = 48 * 60 * 60 * 1000;

/** The id of the relationship a related list draws: `CHILD_OBJECT.FK_FIELD`. */
export function relatedCardId(objectName: string, relationshipField: string): RelatedCardId {
  return `${objectName}.${relationshipField}`;
}

/**
 * A stable hash of a default order (FNV-1a over the ids, `|`-joined, as 8 hex
 * digits). Equal orders hash equal; any reorder, addition or removal changes
 * it (in all but a hash collision, which only hides one hint).
 */
export function relatedDefaultOrderHash(defaultOrder: readonly RelatedCardId[]): string {
  let hash = 0x811c9dc5;
  const text = defaultOrder.join('|');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The arrangement as the column draws it. */
export interface ResolvedRelatedArrangement {
  /** The shown cards, in display order (hidden cards excluded). */
  order: RelatedCardId[];
  /** Every existing card in display order, hidden ones in their place. */
  fullOrder: RelatedCardId[];
  collapsed: ReadonlySet<RelatedCardId>;
  hidden: RelatedCardId[];
  /** Cards that carry the 「新」 badge (rule 3). */
  fresh: ReadonlySet<RelatedCardId>;
  /** Relationships new since the reader's last drag that have no `seen` stamp yet. */
  unseen: RelatedCardId[];
  /** The reader's order was laid over an older default (rule 5). */
  defaultChanged: boolean;
  /** The reader has dragged (their order is not the default's). */
  dragged: boolean;
}

/**
 * Lay the reader's stored arrangement over the default order (rules 1–6).
 *
 * `defaultCollapsed` is the default collapsed state of each card (a card the
 * page draws collapsed until the reader opens it); every card is open by
 * default when it is omitted.
 */
export function resolveRelatedArrangement(
  defaultOrder: readonly RelatedCardId[],
  stored: RelatedArrangement | undefined,
  now: number,
  defaultCollapsed: ReadonlySet<RelatedCardId> = new Set(),
): ResolvedRelatedArrangement {
  const exists = new Set(defaultOrder);
  const dragged = !!stored && stored.order.length > 0;
  let fullOrder: RelatedCardId[];
  const newSinceDrag: RelatedCardId[] = [];
  if (!dragged) {
    // Rule 1.
    fullOrder = [...defaultOrder];
  } else {
    // Rules 2 and 4: the reader's order, minus what no longer exists.
    fullOrder = stored!.order.filter((id, index, all) => exists.has(id) && all.indexOf(id) === index);
    const placed = new Set(fullOrder);
    // Rule 3: each new relationship after its nearest default predecessor
    // that is placed, in default order so consecutive new ones keep theirs.
    defaultOrder.forEach((id, index) => {
      if (placed.has(id)) return;
      newSinceDrag.push(id);
      let at = 0;
      for (let back = index - 1; back >= 0; back -= 1) {
        const before = fullOrder.indexOf(defaultOrder[back]);
        if (before >= 0) {
          at = before + 1;
          break;
        }
      }
      fullOrder.splice(at, 0, id);
      placed.add(id);
    });
  }
  const hiddenSet = new Set((stored?.hidden ?? []).filter((id) => exists.has(id)));
  const collapsed = new Set<RelatedCardId>();
  for (const id of fullOrder) {
    // A new relationship takes the default collapsed state (rule 3); every
    // other card the state the reader's last write recorded for it.
    const fromDefault = !stored || newSinceDrag.includes(id);
    if (fromDefault ? defaultCollapsed.has(id) : stored!.collapsed.includes(id)) collapsed.add(id);
  }
  // Rule 3's badge runs on the reader's clock, not on the order: a
  // relationship new since the last drag is fresh until stamped, and a stamped
  // one stays fresh for 48 h from its stamp — a later drag, which takes it
  // into the order, does not cut the 48 h short.
  const seen = stored?.seen ?? {};
  const fresh = new Set<RelatedCardId>();
  const unseen: RelatedCardId[] = [];
  for (const id of newSinceDrag) {
    if (typeof seen[id] !== 'number') {
      unseen.push(id);
      fresh.add(id);
    }
  }
  for (const [id, at] of Object.entries(seen)) {
    if (exists.has(id) && now - at < RELATED_CARD_NEW_BADGE_MS) fresh.add(id);
  }
  return {
    order: fullOrder.filter((id) => !hiddenSet.has(id)),
    fullOrder,
    collapsed,
    hidden: fullOrder.filter((id) => hiddenSet.has(id)),
    fresh,
    unseen,
    defaultChanged: dragged && stored!.basedOn !== relatedDefaultOrderHash(defaultOrder),
    dragged,
  };
}

/** What a reader did to the arrangement. */
export type RelatedArrangementEdit =
  | { kind: 'move'; id: RelatedCardId; to: number }
  | { kind: 'move-up'; id: RelatedCardId }
  | { kind: 'move-down'; id: RelatedCardId }
  | { kind: 'collapse'; id: RelatedCardId; collapsed: boolean }
  | { kind: 'hide'; id: RelatedCardId }
  | { kind: 'show-hidden' }
  | { kind: 'restore-default-order' }
  | { kind: 'mark-seen'; ids: RelatedCardId[]; at: number };

/**
 * The stored value after `edit`, written against the CURRENT default order.
 * Every write keeps only existing relationships (rule 4).
 *
 * `move` places `id` at index `to` of the SHOWN order (hidden cards keep
 * their place relative to the shown ones). A move writes the full order and
 * stamps `basedOn` with the current default's hash.
 */
export function editRelatedArrangement(
  defaultOrder: readonly RelatedCardId[],
  stored: RelatedArrangement | undefined,
  edit: RelatedArrangementEdit,
  now: number,
  defaultCollapsed: ReadonlySet<RelatedCardId> = new Set(),
): RelatedArrangement {
  const resolved = resolveRelatedArrangement(defaultOrder, stored, now, defaultCollapsed);
  const exists = new Set(defaultOrder);
  const hash = relatedDefaultOrderHash(defaultOrder);
  const keepSeen = (seen: Record<RelatedCardId, number> | undefined) => {
    const out: Record<RelatedCardId, number> = {};
    for (const [id, at] of Object.entries(seen ?? {})) if (exists.has(id)) out[id] = at;
    return out;
  };
  // Only a MOVE writes the full order; every other write keeps the reader's
  // last-drag order as it was (minus what no longer exists, rule 4), so a
  // relationship new since that drag stays new — placed by rule 3, badged —
  // until the reader drags again.
  const base: RelatedArrangement = {
    order: resolved.dragged ? stored!.order.filter((id, index, all) => exists.has(id) && all.indexOf(id) === index) : [],
    collapsed: resolved.fullOrder.filter((id) => resolved.collapsed.has(id)),
    hidden: [...resolved.hidden],
    basedOn: resolved.dragged ? stored!.basedOn : hash,
    seen: keepSeen(stored?.seen),
  };
  const finish = (next: RelatedArrangement): RelatedArrangement => {
    if (next.seen && Object.keys(next.seen).length === 0) delete next.seen;
    return next;
  };
  const moveTo = (id: RelatedCardId, shownIndex: number): RelatedArrangement => {
    const shown = resolved.order.filter((x) => x !== id);
    const clamped = Math.max(0, Math.min(shownIndex, shown.length));
    shown.splice(clamped, 0, id);
    // Re-insert the hidden cards where they stood relative to the shown ones.
    const full: RelatedCardId[] = [...shown];
    resolved.fullOrder.forEach((hiddenId, index) => {
      if (!resolved.hidden.includes(hiddenId)) return;
      const before = resolved.fullOrder.slice(0, index).reverse().find((x) => full.includes(x) && x !== hiddenId);
      full.splice(before ? full.indexOf(before) + 1 : 0, 0, hiddenId);
    });
    return finish({ ...base, order: full, basedOn: hash });
  };
  switch (edit.kind) {
    case 'move':
      if (!exists.has(edit.id)) return finish(base);
      return moveTo(edit.id, edit.to);
    case 'move-up':
    case 'move-down': {
      const at = resolved.order.indexOf(edit.id);
      if (at < 0) return finish(base);
      return moveTo(edit.id, edit.kind === 'move-up' ? at - 1 : at + 1);
    }
    case 'collapse': {
      const collapsed = base.collapsed.filter((id) => id !== edit.id);
      if (edit.collapsed && exists.has(edit.id)) collapsed.push(edit.id);
      return finish({ ...base, collapsed: resolved.fullOrder.filter((id) => collapsed.includes(id)) });
    }
    case 'hide':
      if (!exists.has(edit.id) || base.hidden.includes(edit.id)) return finish(base);
      return finish({ ...base, hidden: resolved.fullOrder.filter((id) => id === edit.id || base.hidden.includes(id)) });
    case 'show-hidden':
      return finish({ ...base, hidden: [] });
    case 'restore-default-order':
      return finish({ ...base, order: [], basedOn: hash, seen: {} });
    case 'mark-seen': {
      const seen = { ...(base.seen ?? {}) };
      for (const id of edit.ids) if (exists.has(id) && typeof seen[id] !== 'number') seen[id] = edit.at;
      return finish({ ...base, seen });
    }
    default:
      return finish(base);
  }
}

/**
 * Read a stored record into an arrangement, or `undefined` for one this
 * module does not read (the codec's `fromRecord`). Strict: every list is an
 * array of strings, `basedOn` a string, `seen` a string → finite-number map.
 */
export function relatedArrangementFromRecord(record: Record<string, unknown>): RelatedArrangement | undefined {
  const ids = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined;
  const order = ids(record.order);
  const collapsed = ids(record.collapsed);
  const hidden = ids(record.hidden);
  if (!order || !collapsed || !hidden || typeof record.basedOn !== 'string') return undefined;
  let seen: Record<string, number> | undefined;
  if (record.seen !== undefined) {
    if (!record.seen || typeof record.seen !== 'object' || Array.isArray(record.seen)) return undefined;
    seen = {};
    for (const [id, at] of Object.entries(record.seen as Record<string, unknown>)) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
      seen[id] = at;
    }
  }
  return { order, collapsed, hidden, basedOn: record.basedOn, ...(seen ? { seen } : {}) };
}

/** The stored record of an arrangement (the codec's `toRecord`). */
export function relatedArrangementToRecord(value: RelatedArrangement): Record<string, unknown> {
  return {
    order: value.order,
    collapsed: value.collapsed,
    hidden: value.hidden,
    basedOn: value.basedOn,
    ...(value.seen && Object.keys(value.seen).length > 0 ? { seen: value.seen } : {}),
  };
}
