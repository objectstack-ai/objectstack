// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (Target item 5) — the item header's draft line reads the
 * ledger the 变更 badge counts. The rules, one case each: the ledger decides
 * whether the open item is a pending draft; N is the badge's number; the
 * pillar's own reading counts only while the ledger is behind a Studio save;
 * and with no ledger in hand the header keeps the chip it always had.
 * End-to-end behaviour on a mounted pillar is pinned in
 * `StudioDesignSurface.itemDraftLine-12725.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { studioItemDraftStatus, type StudioPendingDrafts } from '../studioItemDraftStatus';
import { t, tFormat } from '../../metadata-admin/i18n';

const ITEM = { type: 'object', name: 'hcpl_borrowing' };

function ledger(over: Partial<StudioPendingDrafts> = {}): StudioPendingDrafts {
  return { count: 0, entries: [], behindSave: false, ...over };
}

const line = (count: number, locale = 'en') => ({
  label: tFormat('engine.studio.itemDraftPending', locale, { count }),
  title: tFormat('engine.studio.itemDraftPendingTitle', locale, { count }),
});

describe('the item header draft line (objectui#12725)', () => {
  it('shows while the ledger lists the item, with the badge\'s number', () => {
    const pending = ledger({
      count: 2,
      entries: [ITEM, { type: 'view', name: 'hcpl_borrowing.board' }],
    });
    expect(studioItemDraftStatus(pending, ITEM, false, 'en')).toEqual(line(2));
    expect(studioItemDraftStatus(pending, ITEM, false, 'zh-CN')).toEqual(line(2, 'zh-CN'));
  });

  it('folds a stored type spelling as every /meta reader does', () => {
    const pending = ledger({ count: 1, entries: [{ type: 'objects', name: 'hcpl_borrowing' }] });
    expect(studioItemDraftStatus(pending, ITEM, false, 'en')).toEqual(line(1));
  });

  it('is absent when the ledger does not list the item, though the badge counts others', () => {
    const pending = ledger({ count: 3, entries: [{ type: 'object', name: 'hcpl_book' }, { type: 'flow', name: 'hcpl_borrowing' }] });
    expect(studioItemDraftStatus(pending, ITEM, false, 'en')).toBeUndefined();
  });

  it('a draft the pillar read at load but the ledger no longer lists (a discard elsewhere) shows nothing', () => {
    expect(studioItemDraftStatus(ledger({ count: 0 }), ITEM, true, 'en')).toBeUndefined();
  });

  it('the pillar\'s own save shows the line before the ledger read it asked for answers', () => {
    // The badge says at least one from the render the save lands in (objectui#11787).
    expect(studioItemDraftStatus(ledger({ count: 1, behindSave: true }), ITEM, true, 'en')).toEqual(line(1));
    // Never a zero beside a draft.
    expect(studioItemDraftStatus(ledger({ count: 0, behindSave: true }), ITEM, true, 'en')).toEqual(line(1));
    // Behind someone's save, but this item has no draft of its own: nothing.
    expect(studioItemDraftStatus(ledger({ count: 1, behindSave: true }), ITEM, false, 'en')).toBeUndefined();
  });

  it('with no ledger in hand keeps the chip it always had, and no count it does not know', () => {
    const legacy = { label: t('engine.studio.unpublishedDraft', 'en') };
    expect(studioItemDraftStatus(null, ITEM, true, 'en')).toEqual(legacy);
    expect(studioItemDraftStatus(null, ITEM, false, 'en')).toBeUndefined();
    expect(studioItemDraftStatus(ledger({ count: null }), ITEM, true, 'en')).toEqual(legacy);
    expect(studioItemDraftStatus(ledger({ count: null }), ITEM, false, 'en')).toBeUndefined();
  });

  it('no open item, no line', () => {
    expect(studioItemDraftStatus(ledger({ count: 2, entries: [ITEM] }), null, true, 'en')).toBeUndefined();
  });
});
