/**
 * objectstack#27069 — an object declares the business order of its related
 * lists (`relatedLists`), and `relatedList: 'primary'` places a list rather
 * than ordering it.
 *
 * The lead fixture reproduces the measured state the card names: two owned
 * children and three lookup children, so the derived order (owned → lookup,
 * declaration order) is one nobody chose, and the declared order is visibly
 * different from it.
 */
import { describe, it, expect } from 'vitest';
import { deriveRelatedLists, resolveRelatedListOrder } from '../deriveRelatedLists';

const lead = { name: 'lead', label: 'Lead', fields: { name: { type: 'text' } } };
const note = { name: 'note', label: 'Note', fields: { lead: { type: 'master_detail', reference: 'lead' } } };
const attachment = { name: 'attachment', label: 'Attachment', fields: { lead: { type: 'master_detail', reference: 'lead' } } };
const task = { name: 'task', label: 'Task', fields: { lead_id: { type: 'lookup', reference: 'lead' } } };
const event = {
  name: 'event',
  label: 'Event',
  fields: {
    who_id: { type: 'lookup', reference: 'lead', label: 'Who' },
    related_to: { type: 'lookup', reference: 'lead', label: 'Related To' },
  },
};
const campaignMember = { name: 'campaign_member', label: 'Campaign Member', fields: { lead_id: { type: 'lookup', reference: 'lead' } } };
const registry = [lead, note, attachment, task, event, campaignMember];

const order = (parent: Record<string, unknown>) =>
  deriveRelatedLists(parent, registry).map((r) => `${r.childObject}.${r.referenceField}`);

describe('relatedLists — the declared business order (objectstack#27069)', () => {
  it('without relatedLists the order is the derived one: owned, then lookup, in declaration order', () => {
    expect(order(lead)).toEqual([
      'note.lead',
      'attachment.lead',
      'task.lead_id',
      'event.who_id',
      'event.related_to',
      'campaign_member.lead_id',
    ]);
  });

  it('listed relationships come first in the declared order; the rest keep the derived order', () => {
    expect(order({ ...lead, relatedLists: ['task', 'campaign_member'] })).toEqual([
      'task.lead_id',
      'campaign_member.lead_id',
      'note.lead',
      'attachment.lead',
      'event.who_id',
      'event.related_to',
    ]);
  });

  it('object.field names one FK of a child with several; a bare child name takes all of them', () => {
    expect(order({ ...lead, relatedLists: ['event.related_to'] }).slice(0, 2)).toEqual([
      'event.related_to',
      'note.lead',
    ]);
    expect(order({ ...lead, relatedLists: ['event'] }).slice(0, 2)).toEqual([
      'event.who_id',
      'event.related_to',
    ]);
  });

  it('a list takes the position of the first entry naming it; an entry naming nothing places nothing', () => {
    expect(order({ ...lead, relatedLists: ['nope', 'event.related_to', 'event', 'task'] })).toEqual([
      'event.related_to',
      'event.who_id',
      'task.lead_id',
      'note.lead',
      'attachment.lead',
      'campaign_member.lead_id',
    ]);
  });

  it('relatedList: false still hides a listed relationship', () => {
    const hiddenTask = { ...task, fields: { lead_id: { type: 'lookup', reference: 'lead', relatedList: false } } };
    const out = deriveRelatedLists({ ...lead, relatedLists: ['task'] }, [lead, hiddenTask, note]);
    expect(out.map((r) => r.childObject)).toEqual(['note']);
  });

  it('primary no longer orders: an unlisted primary list keeps its derived position', () => {
    const primaryCampaign = {
      ...campaignMember,
      fields: { lead_id: { type: 'lookup', reference: 'lead', relatedList: 'primary' } },
    };
    const out = deriveRelatedLists({ ...lead, relatedLists: ['task'] }, [lead, note, task, primaryCampaign]);
    expect(out.map((r) => [r.childObject, r.isPrimary])).toEqual([
      ['task', false],
      ['note', false],
      ['campaign_member', true],
    ]);
  });

  it('resolveRelatedListOrder returns the input order when nothing is declared', () => {
    const lists = [
      { childObject: 'a', referenceField: 'x' },
      { childObject: 'b', referenceField: 'y' },
    ];
    expect(resolveRelatedListOrder(lists, undefined)).toEqual(lists);
    expect(resolveRelatedListOrder(lists, [])).toEqual(lists);
    expect(resolveRelatedListOrder(lists, ['b'])).toEqual([lists[1], lists[0]]);
  });
});

describe("relatedList: 'primary' as body placement (objectstack#27069)", () => {
  const quote = { name: 'quote', label: 'Quote', fields: { name: { type: 'text' } } };
  const lineOf = (fk: Record<string, unknown>) => ({
    name: 'quote_line_item',
    label: 'Quote Line Item',
    fields: { quote: { type: 'master_detail', reference: 'quote', ...fk } },
  });
  const primaryOf = (fk: Record<string, unknown>) =>
    deriveRelatedLists(quote, [quote, lineOf(fk)])[0].isPrimary;

  it('a master_detail FK that sets inlineEdit is primary by default, on every inlineEdit arm', () => {
    expect(primaryOf({ inlineEdit: true })).toBe(true);
    expect(primaryOf({ inlineEdit: 'grid' })).toBe(true);
    expect(primaryOf({ inlineEdit: 'form' })).toBe(true);
  });

  it('an explicit relatedList: true keeps an inline-edited child a side card', () => {
    expect(primaryOf({ inlineEdit: true, relatedList: true })).toBe(false);
  });

  it('no inlineEdit, or inlineEdit: false, is not primary by default', () => {
    expect(primaryOf({})).toBe(false);
    expect(primaryOf({ inlineEdit: false })).toBe(false);
  });

  it('a lookup FK with inlineEdit is not primary by default (owned children only)', () => {
    const line = { name: 'quote_line_item', label: 'Line', fields: { quote: { type: 'lookup', reference: 'quote', inlineEdit: true } } };
    expect(deriveRelatedLists(quote, [quote, line])[0].isPrimary).toBe(false);
  });
});
