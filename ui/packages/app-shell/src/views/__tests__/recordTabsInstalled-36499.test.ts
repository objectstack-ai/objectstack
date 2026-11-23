// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 「Configure tabs」 on an installed object (objectstack#36499, card items 4
 * and 7): the draft opens on what the page draws (another package's list and
 * the built-in tabs in their places), every tab moves, a related one hides;
 * a save writes the paired `.custom` extension's `relatedLists` in the spec's
 * shape (the shown tabs in order, a built-in bare, every hidden related tab
 * written hidden) with the STORED names and columns; the preview draws the
 * draft; each tab names where it comes from.
 */

import { describe, expect, it } from 'vitest';
import { RECORD_PAGE_BUILTIN_TABS } from '@objectstack/spec/data';
import { deriveRelatedLists } from '../../utils/deriveRelatedLists';
import { editRecordTabsDraft, recordTabsCatalog } from '../recordTabsConfig';
import {
  initialInstalledTabsDraft,
  installedTabsEntries,
  previewInstalledTabsObject,
  recordTabSource,
} from '../recordTabsInstalled';

const BASE = 'app.hotcrm';
const PAIR = 'app.hotcrm.custom';
const toLead = { type: 'lookup', reference: 'lead' };

const lead = {
  name: 'lead',
  _packageId: BASE,
  enable: { files: true },
  // Served: the owner's declared list, its title translated for the reader.
  relatedLists: [{ list: 'contact', label: 'Kontakte', columns: ['name'] }, 'task'],
};
const OBJECTS = [
  lead,
  { name: 'contact', _packageId: BASE, fields: { lead: toLead } },
  { name: 'task', _packageId: BASE, fields: { lead: toLead } },
  { name: 'meeting', _packageId: BASE, fields: { lead__c: toLead } },
  { name: 'campaign_member', _packageId: 'com.marketing', fields: { lead: toLead } },
  { name: 'survey', _packageId: PAIR, fields: { lead: toLead } },
];
const OWNER_STORED = [{ list: 'contact', label: 'Contacts', columns: ['name'] }, 'task'];

const catalog = recordTabsCatalog(lead, OBJECTS);

describe('the draft an installed object opens on (objectstack#36499)', () => {
  it("what the page draws: the owner's tabs, another package's and the environment's after them, then 审批 and 动态; unlisted attachments hidden", () => {
    const draft = initialInstalledTabsDraft(lead, OBJECTS, catalog);
    expect(draft.order).toEqual([
      'contact.lead',
      'task.lead',
      'campaign_member.lead',
      'survey.lead',
      'sys_approval_request',
      'sys_activity',
    ]);
    expect(draft.hidden).toEqual(['meeting.lead__c', 'sys_attachment']);
    expect(draft.labels).toEqual({ 'contact.lead': 'Kontakte' });
  });

  it("the environment's arrangement as served: its order, its hidden names hidden, a built-in at its place", () => {
    const arranged = {
      ...lead,
      relatedLists: ['sys_activity', 'campaign_member', { list: 'contact', label: 'People' }, 'sys_attachment'],
      _relatedListsArrangement: { packageId: PAIR, hidden: ['task'], unlisted: 'hidden' },
    };
    const draft = initialInstalledTabsDraft(arranged, OBJECTS, recordTabsCatalog(arranged, OBJECTS));
    expect(draft.order).toEqual([
      'sys_activity',
      'campaign_member.lead',
      'contact.lead',
      'sys_attachment',
      'survey.lead',
      'sys_approval_request',
    ]);
    expect(draft.hidden).toEqual(['task.lead', 'meeting.lead__c']);
  });
});

describe('what a save writes into the pair', () => {
  const initial = initialInstalledTabsDraft(lead, OBJECTS, catalog);

  it('every shown tab in order (a built-in bare), every hidden related tab written hidden; stored title and columns, not the served translation', () => {
    let draft = editRecordTabsDraft(initial, { kind: 'move', id: 'sys_activity', to: 0 });
    draft = editRecordTabsDraft(draft, { kind: 'hide', id: 'task.lead' });
    draft = editRecordTabsDraft(draft, { kind: 'hide', id: 'campaign_member.lead' });
    expect(installedTabsEntries(draft, catalog, { extension: undefined, owner: OWNER_STORED }, initial)).toEqual([
      'sys_activity',
      { list: 'contact', label: 'Contacts', columns: ['name'] },
      'survey',
      'sys_approval_request',
      { list: 'meeting', hidden: true },
      { list: 'task', hidden: true },
      { list: 'campaign_member', hidden: true },
    ]);
  });

  it("a rename is written; the pair's own stored entry wins over the owner's; restoring the attachments tab names it", () => {
    let draft = editRecordTabsDraft(initial, { kind: 'rename', id: 'contact.lead', label: 'People' });
    draft = editRecordTabsDraft(draft, { kind: 'restore', id: 'sys_attachment' });
    const entries = installedTabsEntries(
      draft,
      catalog,
      { extension: [{ list: 'task', label: 'To-dos', columns: ['subject'] }], owner: OWNER_STORED },
      initial,
    );
    expect(entries.slice(0, 3)).toEqual([
      { list: 'contact', label: 'People', columns: ['name'] },
      { list: 'task', label: 'To-dos', columns: ['subject'] },
      'campaign_member',
    ]);
    expect(entries).toContain('sys_attachment');
  });

  it('a stored entry naming no list the editor offers is kept as it was', () => {
    const entries = installedTabsEntries(initial, catalog, { extension: ['ghost', { list: 'phantom', hidden: true }], owner: OWNER_STORED }, initial);
    expect(entries).toContain('ghost');
    expect(entries.at(-1)).toEqual({ list: 'phantom', hidden: true });
  });

  it('the preview draws the draft: the shown related tabs in its order, the hidden ones gone', () => {
    let draft = editRecordTabsDraft(initial, { kind: 'hide', id: 'task.lead' });
    draft = editRecordTabsDraft(draft, { kind: 'move', id: 'survey.lead', to: 0 });
    const preview = previewInstalledTabsObject(lead, draft, catalog);
    const shown = deriveRelatedLists(preview as never, OBJECTS as never[]).map((l) => `${l.childObject}.${l.referenceField}`);
    expect(shown).toEqual(['survey.lead', 'contact.lead', 'campaign_member.lead']);
    expect((preview.relatedLists as unknown[]).filter((e) => (RECORD_PAGE_BUILTIN_TABS as readonly unknown[]).includes(e))).toEqual([
      'sys_approval_request',
      'sys_activity',
    ]);
  });
});

describe('where each tab comes from (card item 7)', () => {
  it('the original package, another package, or this environment (no package, the .custom package, a __c field)', () => {
    const source = (childObject: string, referenceField = 'lead') => recordTabSource({ childObject, referenceField }, lead, [
      ...OBJECTS,
      { name: 'note_env', _packageId: 'sys_metadata', fields: { lead: toLead } },
    ]);
    expect(source('contact')).toEqual({ kind: 'base' });
    expect(source('campaign_member')).toEqual({ kind: 'package', packageId: 'com.marketing' });
    expect(source('survey')).toEqual({ kind: 'environment' });
    expect(source('note_env')).toEqual({ kind: 'environment' });
    expect(source('meeting', 'lead__c')).toEqual({ kind: 'environment' });
  });
});
