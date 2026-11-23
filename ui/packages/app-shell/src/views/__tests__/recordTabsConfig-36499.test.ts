// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record page's tab configuration as a model (objectstack#36499): which
 * tabs the editor offers, the draft it opens on, and the object's
 * `relatedLists` a save writes — an object's own list hides a tab by leaving
 * it out, keeps what the editor does not arrange, and the administrator's
 * order is the default a reader's own arrangement lays over.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_RELATED_ARRANGEMENT,
  buildDefaultPageColumns,
  buildDefaultPageSchema,
  resolveRelatedArrangement,
  type RelatedArrangement,
} from '@object-ui/plugin-detail';
import { deriveRelatedLists } from '../../utils/deriveRelatedLists';
import {
  editRecordTabsDraft,
  initialRecordTabsDraft,
  previewRecordTabsObject,
  recordTabsCatalog,
  recordTabsEntries,
  sameRecordTabsDraft,
  type RecordTabsDraft,
} from '../recordTabsConfig';

const PKG = 'app.crm';
const lookup = (reference: string, extra: Record<string, unknown> = {}) => ({ type: 'lookup', reference, ...extra });

function catalogOf(account: Record<string, unknown>) {
  const objects = [
    account,
    { name: 'contact', label: 'Contact', _packageId: PKG, fields: { account: lookup('account') } },
    { name: 'opportunity', label: 'Opportunity', _packageId: PKG, fields: { account: lookup('account'), partner: lookup('account') } },
    { name: 'note', label: 'Note', _packageId: PKG, fields: { account: lookup('account', { relatedList: false }) } },
    { name: 'ext_ticket', label: 'Ticket', _packageId: 'other.pkg', fields: { account: lookup('account') } },
  ];
  return { objects, catalog: recordTabsCatalog(account, objects) };
}

const account = (extra: Record<string, unknown> = {}): Record<string, unknown> & { relatedLists?: unknown[] } => ({
  name: 'account',
  label: 'Account',
  _packageId: PKG,
  enable: { files: true },
  fields: { name: { type: 'text' } },
  ...extra,
});

describe('what the editor offers (objectstack#36499)', () => {
  it('every list that can be a tab, by its relationship id; another package\'s fixed; a hidden FK not at all', () => {
    const { catalog } = catalogOf(account({ relatedLists: ['contact'] }));
    expect(catalog.candidates.map((c) => c.id)).toEqual([
      'contact.account',
      'opportunity.account',
      'opportunity.partner',
      'ext_ticket.account',
    ]);
    expect(catalog.candidates.find((c) => c.id === 'ext_ticket.account')?.fromPackage).toBe('other.pkg');
    expect(catalog.files).toBe(true);
  });

  it('opens on what the page shows: an undeclared object shows every list, nothing hidden', () => {
    const def = account();
    const { objects, catalog } = catalogOf(def);
    const draft = initialRecordTabsDraft(def, objects, catalog);
    // Another package's list is placed by that package: not in the draft.
    expect(draft.order).toEqual(['contact.account', 'opportunity.account', 'opportunity.partner']);
    expect(draft.hidden).toEqual([]);
    expect(draft.attachmentsHidden).toBe(false);
  });

  it('a declared list: its order, the lists it leaves out hidden, its labels, attachments hidden when unnamed', () => {
    const def = account({ relatedLists: ['opportunity.partner', { list: 'contact', label: 'People' }] });
    const { objects, catalog } = catalogOf(def);
    const draft = initialRecordTabsDraft(def, objects, catalog);
    expect(draft.order).toEqual(['opportunity.partner', 'contact.account']);
    expect(draft.hidden).toEqual(['opportunity.account']);
    expect(draft.labels).toEqual({ 'contact.account': 'People' });
    expect(draft.attachmentsHidden).toBe(true);
  });
});

describe('editing the draft', () => {
  const start: RecordTabsDraft = { order: ['a.x', 'b.x', 'c.x'], hidden: [], attachmentsHidden: false, labels: {} };
  it('moves, hides, restores and renames', () => {
    let d = editRecordTabsDraft(start, { kind: 'move', id: 'c.x', to: 0 });
    expect(d.order).toEqual(['c.x', 'a.x', 'b.x']);
    d = editRecordTabsDraft(d, { kind: 'hide', id: 'a.x' });
    expect(d).toMatchObject({ order: ['c.x', 'b.x'], hidden: ['a.x'] });
    d = editRecordTabsDraft(d, { kind: 'restore', id: 'a.x' });
    expect(d).toMatchObject({ order: ['c.x', 'b.x', 'a.x'], hidden: [] });
    d = editRecordTabsDraft(d, { kind: 'rename', id: 'b.x', label: '  Bees ' });
    expect(d.labels).toEqual({ 'b.x': 'Bees' });
    d = editRecordTabsDraft(d, { kind: 'rename', id: 'b.x', label: '' });
    expect(d.labels).toEqual({});
  });

  it('a draft moved and moved back is the same draft (nothing to save)', () => {
    const there = editRecordTabsDraft(start, { kind: 'move', id: 'a.x', to: 2 });
    expect(sameRecordTabsDraft(start, there)).toBe(false);
    expect(sameRecordTabsDraft(start, editRecordTabsDraft(there, { kind: 'move', id: 'a.x', to: 0 }))).toBe(true);
  });
});

describe('what a save writes', () => {
  it('from the automatic list: every shown tab in the new order, the attachments tab named so it still shows', () => {
    const def = account();
    const { objects, catalog } = catalogOf(def);
    const draft = editRecordTabsDraft(initialRecordTabsDraft(def, objects, catalog), { kind: 'move', id: 'contact.account', to: 2 });
    expect(recordTabsEntries(draft, undefined, catalog)).toEqual([
      'opportunity.account',
      'opportunity.partner',
      'contact',
      'sys_attachment',
    ]);
  });

  it('a hidden tab is left out; a rename is the entry\'s label; the stored entry\'s columns are kept', () => {
    const def = account({ relatedLists: [{ list: 'contact', columns: ['name'] }, 'opportunity'] });
    const { objects, catalog } = catalogOf(def);
    let draft = initialRecordTabsDraft(def, objects, catalog);
    draft = editRecordTabsDraft(draft, { kind: 'hide', id: 'opportunity.partner' });
    draft = editRecordTabsDraft(draft, { kind: 'rename', id: 'contact.account', label: 'People' });
    expect(recordTabsEntries(draft, def.relatedLists, catalog)).toEqual([
      { list: 'contact', label: 'People', columns: ['name'] },
      'opportunity.account',
    ]);
  });

  it('keeps what the editor does not arrange after the entry it followed: 审批 / 动态, and an entry naming a list not offered', () => {
    const def = account({ relatedLists: ['contact', 'note', 'sys_approval_request', 'opportunity', 'sys_activity', 'sys_attachment'] });
    const { objects, catalog } = catalogOf(def);
    const draft = editRecordTabsDraft(initialRecordTabsDraft(def, objects, catalog), { kind: 'move', id: 'contact.account', to: 2 });
    expect(recordTabsEntries(draft, def.relatedLists, catalog)).toEqual([
      'opportunity.account',
      'opportunity.partner',
      'contact',
      'note',
      'sys_approval_request',
      'sys_activity',
      'sys_attachment',
    ]);
  });

  it('every tab hidden still writes a declared list (an empty one reads as "none declared")', () => {
    const def = account({ enable: {}, relatedLists: ['contact'] });
    const { objects, catalog } = catalogOf(def);
    const draft = editRecordTabsDraft(initialRecordTabsDraft(def, objects, catalog), { kind: 'hide', id: 'contact.account' });
    const entries = recordTabsEntries(draft, def.relatedLists, catalog);
    expect(entries).toEqual(['sys_approval_request', 'sys_activity']);
    const preview = previewRecordTabsObject(def, draft, catalog);
    const shown = deriveRelatedLists(preview as never, objects as never[]).map((l) => `${l.childObject}.${l.referenceField}`);
    expect(shown).toEqual(['ext_ticket.account']);
  });

  it('the preview is what the page draws: the hidden tab gone, the order the draft\'s', () => {
    const def = account();
    const { objects, catalog } = catalogOf(def);
    let draft = initialRecordTabsDraft(def, objects, catalog);
    draft = editRecordTabsDraft(draft, { kind: 'hide', id: 'opportunity.account' });
    draft = editRecordTabsDraft(draft, { kind: 'move', id: 'opportunity.partner', to: 0 });
    const preview = previewRecordTabsObject(def, draft, catalog);
    const shown = deriveRelatedLists(preview as never, objects as never[]).map((l) => `${l.childObject}.${l.referenceField}`);
    expect(shown).toEqual(['opportunity.partner', 'contact.account', 'ext_ticket.account']);
  });
});

describe("the administrator's order is the default a reader's own arrangement lays over (item 6)", () => {
  /** The related tab ids the laid-out page draws by default for `def`, in order. */
  const defaultTabOrder = (def: Record<string, unknown>, objects: Record<string, unknown>[]) => {
    const related = deriveRelatedLists(def as never, objects as never[]).map((l) => ({
      title: l.childLabel,
      objectName: l.childObject,
      relationshipField: l.referenceField,
    }));
    const columns = buildDefaultPageColumns(buildDefaultPageSchema(def as never, { related } as never));
    return (columns?.related ?? [])
      .map((n: any) => ({ ...n, ...(n?.properties ?? {}) }))
      .filter((p: any) => p.type === 'record:related_list')
      .map((p: any) => `${p.objectName}.${p.relationshipField}`);
  };

  it('a reader who dragged keeps their order; 「恢复默认顺序」 gives the administrator\'s', () => {
    const before = account();
    const { objects, catalog } = catalogOf(before);
    const defaultBefore = defaultTabOrder(before, objects);
    expect(defaultBefore).toEqual(['contact.account', 'opportunity.account', 'opportunity.partner', 'ext_ticket.account']);
    // The reader dragged the partner tab first (their stored diff: the order of their drag).
    const reader: RelatedArrangement = {
      order: ['opportunity.partner', 'contact.account', 'opportunity.account', 'ext_ticket.account'],
      hidden: [],
      basedOn: 'x',
    };
    // The administrator moves 联系人 last and saves.
    const draft = editRecordTabsDraft(initialRecordTabsDraft(before, objects, catalog), { kind: 'move', id: 'contact.account', to: 2 });
    const after = { ...before, relatedLists: recordTabsEntries(draft, undefined, catalog) };
    const defaultAfter = defaultTabOrder(after, objects);
    // Another package's list keeps its place at the end (objectstack#35901).
    expect(defaultAfter).toEqual(['opportunity.account', 'opportunity.partner', 'contact.account', 'ext_ticket.account']);
    // The reader still sees their own order.
    expect(resolveRelatedArrangement(defaultAfter, reader, 0).order).toEqual([
      'opportunity.partner',
      'contact.account',
      'opportunity.account',
      'ext_ticket.account',
    ]);
    expect(resolveRelatedArrangement(defaultAfter, reader, 0).rearranged).toBe(true);
    // 「恢复默认顺序」 writes the empty arrangement (relatedArrangement.ts, its own pins):
    // the administrator's order. A reader who never dragged sees it at once too.
    expect(resolveRelatedArrangement(defaultAfter, EMPTY_RELATED_ARRANGEMENT, 0).order).toEqual(defaultAfter);
    expect(resolveRelatedArrangement(defaultAfter, undefined, 0).order).toEqual(defaultAfter);
  });
});
