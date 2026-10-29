/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Targets 7 and 10 — the merge rules of the reader's
 * related-card arrangement, one `describe` per rule as the maintainer stated
 * them on the card (2026-10-28, on 「如果让用户自己定义排序，那和默认顺序冲突怎么办？
 * 开发了新的子表之后怎么办」 and 「有需要隐藏某个子表的场景吗？怎么处理」).
 */

import { describe, expect, it } from 'vitest';
import {
  RELATED_CARD_NEW_BADGE_MS,
  editRelatedArrangement,
  relatedArrangementFromRecord,
  relatedArrangementToRecord,
  relatedCardId,
  relatedDefaultOrderHash,
  resolveRelatedArrangement,
  type RelatedArrangement,
} from '../relatedArrangement';

const NOW = Date.UTC(2026, 9, 28, 12);
const A = 'task.lead_id';
const B = 'note.parent_id';
const C = 'call.lead_id';
const D = 'campaign_member.lead_id';
const DEFAULT = [A, B, C];

/** The reader dragged C to the top of the default A B C. */
const dragged = (): RelatedArrangement =>
  editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: C, to: 0 }, NOW);

describe('ids are object.field', () => {
  it('names the child object and its FK field', () => {
    expect(relatedCardId('task', 'lead_id')).toBe(A);
  });
});

describe('rule 1 — a reader who never dragged sees the default order', () => {
  it('no stored value', () => {
    expect(resolveRelatedArrangement(DEFAULT, undefined, NOW).order).toEqual(DEFAULT);
  });

  it('a collapse or a hide alone does not freeze the order', () => {
    const collapsedOnly = editRelatedArrangement(DEFAULT, undefined, { kind: 'collapse', id: B, collapsed: true }, NOW);
    expect(collapsedOnly.order).toEqual([]);
    // The author then reorders the default: the collapse-only reader follows it.
    expect(resolveRelatedArrangement([C, A, B], collapsedOnly, NOW).order).toEqual([C, A, B]);
    expect(resolveRelatedArrangement([C, A, B], collapsedOnly, NOW).collapsed.has(B)).toBe(true);
  });
});

describe("rule 2 — dragged cards keep the reader's order; a later default change never reorders them", () => {
  it('the drag is the order', () => {
    expect(resolveRelatedArrangement(DEFAULT, dragged(), NOW).order).toEqual([C, A, B]);
  });

  it('the author reorders the default — the reader keeps theirs', () => {
    expect(resolveRelatedArrangement([B, A, C], dragged(), NOW).order).toEqual([C, A, B]);
  });

  it('「恢复默认顺序」 restores the default', () => {
    const restored = editRelatedArrangement([B, A, C], dragged(), { kind: 'restore-default-order' }, NOW);
    expect(restored.order).toEqual([]);
    expect(resolveRelatedArrangement([B, A, C], restored, NOW).order).toEqual([B, A, C]);
  });

  it('上移 / 下移 move one place in the shown order', () => {
    const up = editRelatedArrangement(DEFAULT, undefined, { kind: 'move-up', id: B }, NOW);
    expect(resolveRelatedArrangement(DEFAULT, up, NOW).order).toEqual([B, A, C]);
    const down = editRelatedArrangement(DEFAULT, up, { kind: 'move-down', id: B }, NOW);
    expect(resolveRelatedArrangement(DEFAULT, down, NOW).order).toEqual([A, B, C]);
    // At the edge a move is a no-op on the order.
    const top = editRelatedArrangement(DEFAULT, undefined, { kind: 'move-up', id: A }, NOW);
    expect(resolveRelatedArrangement(DEFAULT, top, NOW).order).toEqual(DEFAULT);
  });
});

describe('rule 3 — a new relationship: after its nearest placed default predecessor, 「新」 for 48 h, default collapsed state', () => {
  it('inserted after the nearest card preceding it in the default order', () => {
    // Default grows to A B D C; the reader dragged C first. D's nearest
    // predecessor in the default that the reader's order holds is B.
    const resolved = resolveRelatedArrangement([A, B, D, C], dragged(), NOW);
    expect(resolved.order).toEqual([C, A, B, D]);
  });

  it('first in the default → first', () => {
    expect(resolveRelatedArrangement([D, A, B, C], dragged(), NOW).order).toEqual([D, C, A, B]);
  });

  it('carries the badge until it has been seen for 48 h', () => {
    const fresh = resolveRelatedArrangement([A, B, C, D], dragged(), NOW);
    expect(fresh.fresh.has(D)).toBe(true);
    expect(fresh.unseen).toEqual([D]);
    const stamped = editRelatedArrangement([A, B, C, D], dragged(), { kind: 'mark-seen', ids: [D], at: NOW }, NOW);
    expect(resolveRelatedArrangement([A, B, C, D], stamped, NOW + RELATED_CARD_NEW_BADGE_MS - 1).fresh.has(D)).toBe(true);
    expect(resolveRelatedArrangement([A, B, C, D], stamped, NOW + RELATED_CARD_NEW_BADGE_MS).fresh.has(D)).toBe(false);
    // Stamping does not reorder anything.
    expect(stamped.order).toEqual(dragged().order);
  });

  it('a reader who never dragged gets no badge — every card is the default', () => {
    expect(resolveRelatedArrangement([A, B, C, D], undefined, NOW).fresh.size).toBe(0);
  });

  it('takes the default collapsed state', () => {
    const resolved = resolveRelatedArrangement([A, B, C, D], dragged(), NOW, new Set([D]));
    expect(resolved.collapsed.has(D)).toBe(true);
    expect(resolveRelatedArrangement([A, B, C, D], dragged(), NOW).collapsed.has(D)).toBe(false);
  });
});

describe('rule 4 — a relationship that no longer exists is dropped on the next write', () => {
  it('drops it from order, collapsed and hidden', () => {
    let stored = dragged();
    stored = editRelatedArrangement(DEFAULT, stored, { kind: 'collapse', id: B, collapsed: true }, NOW);
    stored = editRelatedArrangement(DEFAULT, stored, { kind: 'hide', id: A }, NOW);
    // B is gone from the default; the next write drops it everywhere.
    const next = editRelatedArrangement([A, C], stored, { kind: 'collapse', id: C, collapsed: true }, NOW);
    expect(next.order).toEqual([C, A]);
    expect(next.collapsed).toEqual([C]);
    expect(next.hidden).toEqual([A]);
  });

  it('reading alone already leaves it out of the column', () => {
    expect(resolveRelatedArrangement([A, C], dragged(), NOW).order).toEqual([C, A]);
  });
});

describe("rule 5 — basedOn names the default the reader's order was laid over", () => {
  it('a changed default raises the hint; restoring clears it', () => {
    expect(resolveRelatedArrangement(DEFAULT, dragged(), NOW).defaultChanged).toBe(false);
    expect(resolveRelatedArrangement([B, A, C], dragged(), NOW).defaultChanged).toBe(true);
    const restored = editRelatedArrangement([B, A, C], dragged(), { kind: 'restore-default-order' }, NOW);
    expect(resolveRelatedArrangement([B, A, C], restored, NOW).defaultChanged).toBe(false);
  });

  it('the hash is stable and order-sensitive', () => {
    expect(relatedDefaultOrderHash(DEFAULT)).toBe(relatedDefaultOrderHash([...DEFAULT]));
    expect(relatedDefaultOrderHash(DEFAULT)).not.toBe(relatedDefaultOrderHash([B, A, C]));
    expect(relatedDefaultOrderHash(DEFAULT)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('rule 6 — hidden cards leave the column and come back together', () => {
  it('hide, then 「显示」', () => {
    const hidden = editRelatedArrangement(DEFAULT, undefined, { kind: 'hide', id: B }, NOW);
    const resolved = resolveRelatedArrangement(DEFAULT, hidden, NOW);
    expect(resolved.order).toEqual([A, C]);
    expect(resolved.hidden).toEqual([B]);
    const shown = editRelatedArrangement(DEFAULT, hidden, { kind: 'show-hidden' }, NOW);
    expect(resolveRelatedArrangement(DEFAULT, shown, NOW).order).toEqual(DEFAULT);
  });

  it('a hidden card keeps its place when others move around it', () => {
    let stored = editRelatedArrangement(DEFAULT, undefined, { kind: 'hide', id: B }, NOW);
    stored = editRelatedArrangement(DEFAULT, stored, { kind: 'move', id: C, to: 0 }, NOW);
    expect(stored.order).toEqual([C, A, B]);
    expect(resolveRelatedArrangement(DEFAULT, stored, NOW).order).toEqual([C, A]);
  });
});

describe('the stored record', () => {
  it('round-trips, and refuses a malformed record', () => {
    const value = editRelatedArrangement([A, B, C, D], dragged(), { kind: 'mark-seen', ids: [D], at: NOW }, NOW);
    expect(relatedArrangementFromRecord(relatedArrangementToRecord(value))).toEqual(value);
    expect(relatedArrangementFromRecord({ order: [1], collapsed: [], hidden: [], basedOn: 'x' })).toBeUndefined();
    expect(relatedArrangementFromRecord({ order: [], collapsed: [], hidden: [] })).toBeUndefined();
    expect(relatedArrangementFromRecord({ order: [], collapsed: [], hidden: [], basedOn: 'x', seen: { a: 'now' } })).toBeUndefined();
  });

  it('carries no `seen` key when nothing was seen', () => {
    expect('seen' in relatedArrangementToRecord(dragged())).toBe(false);
  });
});
