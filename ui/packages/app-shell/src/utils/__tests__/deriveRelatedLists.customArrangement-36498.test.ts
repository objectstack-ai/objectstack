/**
 * objectstack#36498 (ADR-0146 D10) — the tab list the base's paired `.custom`
 * package declares for an installed object. The server writes it into the
 * served `relatedLists` and says two more things beside it, in the served
 * read's `_relatedListsArrangement` decoration, because only this derivation
 * knows which lists exist for the reader:
 *
 *  - `hidden`: the lists the arrangement hides (`{ list, hidden: true }`), a
 *    list another package brings included, which a served `relatedLists`
 *    never hides by leaving it out;
 *  - `unlisted: 'shown'`: the arrangement replaced the AUTOMATIC tab list, so
 *    a list no entry names still shows, after the listed ones;
 *  - `unlisted: 'hidden'`: it replaced a DECLARED one, and the served list is
 *    still a declared one when it is empty (every tab of it hidden).
 *
 * With no decoration this derivation answers exactly what it answered before
 * the decoration existed (the last block pins that against literal values).
 * Each row's control differs from it by the decoration alone.
 */
import { describe, it, expect } from 'vitest';
import { deriveRelatedLists } from '../deriveRelatedLists';

const BASE = 'com.vendor.crm';
const PAIR = 'com.vendor.crm.custom';

const lead = { name: 'lead', label: 'Lead', _packageId: BASE, fields: { name: { type: 'text' } } };
const childOf = (name: string, packageId: string, fields?: Record<string, unknown>) => ({
  name,
  label: name,
  _packageId: packageId,
  fields: fields ?? { lead_id: { type: 'lookup', reference: 'lead' } },
});
const task = childOf('task', BASE);
const note = childOf('note', BASE);
const event = childOf('event', BASE, {
  who_id: { type: 'lookup', reference: 'lead', label: 'Who' },
  related_to: { type: 'lookup', reference: 'lead', label: 'Related To' },
});
const audit = childOf('audit', 'com.acme.audit');
const registry = [lead, task, note, event, audit];

const arranged = (hidden: string[], unlisted: 'shown' | 'hidden') => ({
  _relatedListsArrangement: { packageId: PAIR, hidden, unlisted },
});
const ids = (parent: Record<string, unknown>, objects: unknown[] = registry, includeHidden = false) =>
  deriveRelatedLists(parent, objects as never, { includeHidden }).map((r) => `${r.childObject}.${r.referenceField}`);

describe('the environment hides a tab (`hidden`)', () => {
  const declared = { ...lead, relatedLists: ['note', 'task', 'event'] };

  it('a list the arrangement hides is not derived; the others keep their order', () => {
    expect(ids({ ...declared, relatedLists: ['note', 'event'], ...arranged(['task'], 'hidden') })).toEqual([
      'note.lead_id', 'event.who_id', 'event.related_to', 'audit.lead_id',
    ]);
  });

  it('control: without the decoration nothing is hidden by name', () => {
    expect(ids(declared)).toEqual(['note.lead_id', 'task.lead_id', 'event.who_id', 'event.related_to', 'audit.lead_id']);
  });

  it('a list ANOTHER package brings is hidden too, which leaving it out of `relatedLists` never does', () => {
    expect(ids({ ...declared, ...arranged(['audit'], 'hidden') })).toEqual([
      'note.lead_id', 'task.lead_id', 'event.who_id', 'event.related_to',
    ]);
  });

  it('a bare child name hides every list of that child; `object.field` hides the one relationship', () => {
    expect(ids({ ...declared, ...arranged(['event'], 'hidden') })).toEqual(['note.lead_id', 'task.lead_id', 'audit.lead_id']);
    expect(ids({ ...declared, ...arranged(['event.who_id'], 'hidden') })).toEqual([
      'note.lead_id', 'task.lead_id', 'event.related_to', 'audit.lead_id',
    ]);
  });

  it('it hides on an object that declares no `relatedLists` as well (the arrangement only hides)', () => {
    expect(ids({ ...lead, ...arranged(['task'], 'shown') })).toEqual([
      'note.lead_id', 'event.who_id', 'event.related_to', 'audit.lead_id',
    ]);
  });

  it('the authoring surface keeps the hidden list, flagged `isUnlisted`', () => {
    const lists = deriveRelatedLists({ ...declared, ...arranged(['audit', 'task'], 'hidden') }, registry as never, { includeHidden: true });
    expect(lists.filter((r) => r.isUnlisted).map((r) => r.childObject)).toEqual(['task', 'audit']);
  });

  it('a body table stays at its group and loses the tab it keeps: the arrangement hides tabs, groups place tables', () => {
    const line = childOf('line', BASE, { lead_id: { type: 'master_detail', reference: 'lead' } });
    const parent = { ...lead, fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'line' }] };
    const shown = deriveRelatedLists(parent, [lead, line] as never)[0];
    expect([shown.isPrimary, shown.keepsTab]).toEqual([true, true]);
    const hidden = deriveRelatedLists({ ...parent, ...arranged(['line'], 'shown') }, [lead, line] as never)[0];
    expect([hidden.isPrimary, hidden.keepsTab]).toEqual([true, undefined]);
  });
});

describe('a tab the environment\'s list does not name still shows (`unlisted`)', () => {
  it('`shown`: an unnamed list of the object\'s own package is kept after the listed ones', () => {
    expect(ids({ ...lead, relatedLists: ['event'], ...arranged([], 'shown') })).toEqual([
      'event.who_id', 'event.related_to', 'task.lead_id', 'note.lead_id', 'audit.lead_id',
    ]);
  });

  it('control — `hidden`: the served list\'s own rule (an own-package list shows only when named)', () => {
    expect(ids({ ...lead, relatedLists: ['event'], ...arranged([], 'hidden') })).toEqual([
      'event.who_id', 'event.related_to', 'audit.lead_id',
    ]);
  });

  it('`shown` with a hidden name: every unnamed list but the hidden one', () => {
    expect(ids({ ...lead, relatedLists: ['event'], ...arranged(['note'], 'shown') })).toEqual([
      'event.who_id', 'event.related_to', 'task.lead_id', 'audit.lead_id',
    ]);
  });

  it('`shown`: an unnamed group-made body table keeps the tab it had on the automatic page', () => {
    const line = childOf('line', BASE, { lead_id: { type: 'master_detail', reference: 'lead' } });
    const parent = { ...lead, fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'line' }], relatedLists: ['task'] };
    const kept = deriveRelatedLists({ ...parent, ...arranged([], 'shown') }, [lead, task, line] as never).find((r) => r.childObject === 'line')!;
    expect(kept.keepsTab).toBe(true);
    const control = deriveRelatedLists(parent, [lead, task, line] as never).find((r) => r.childObject === 'line')!;
    expect(control.keepsTab).toBeUndefined();
  });
});

describe('every tab of a declared list hidden: the served list is empty, and still a declared one', () => {
  // The owner listed `task` and `event` and left its own `note` out; the
  // environment hid both, so the server has no entry left to serve.
  const served = { ...lead, relatedLists: [], ...arranged(['task', 'event'], 'hidden') };

  it('the list the owner left out stays hidden; another package\'s still shows, as under any declared list', () => {
    expect(ids(served)).toEqual(['audit.lead_id']);
  });

  it('control: the same empty list with no decoration is the automatic one, where every list shows', () => {
    expect(ids({ ...lead, relatedLists: [] })).toEqual([
      'task.lead_id', 'note.lead_id', 'event.who_id', 'event.related_to', 'audit.lead_id',
    ]);
  });

  it('control — `shown`: an empty list over the AUTOMATIC one keeps every list but the hidden ones', () => {
    expect(ids({ ...lead, relatedLists: [], ...arranged(['task', 'event'], 'shown') })).toEqual(['note.lead_id', 'audit.lead_id']);
  });

  it('the authoring surface keeps the hidden and the left-out lists, flagged `isUnlisted`', () => {
    const lists = deriveRelatedLists(served, registry as never, { includeHidden: true });
    expect(lists.filter((r) => r.isUnlisted).map((r) => r.childObject)).toEqual(['task', 'note', 'event', 'event']);
    expect(lists.filter((r) => !r.isUnlisted).map((r) => r.childObject)).toEqual(['audit']);
  });
});

describe('PIN — no `.custom` arrangement served: the derivation is what it was', () => {
  const declared = { ...lead, relatedLists: ['note', { list: 'event.related_to', label: 'Meetings', columns: ['subject'] }] };
  // Literal values, as the derivation answered before the decoration existed.
  const DECLARED = [
    { childObject: 'note', childLabel: 'note', referenceField: 'lead_id', isOwned: false, isPrimary: false, isPlaceable: false },
    {
      childObject: 'event', childLabel: 'event', referenceField: 'related_to', isOwned: false, isPrimary: false, isPlaceable: false,
      title: 'Meetings', columns: ['subject'],
    },
    { childObject: 'audit', childLabel: 'audit', referenceField: 'lead_id', isOwned: false, isPrimary: false, isPlaceable: false },
  ];
  const AUTOMATIC = ['task.lead_id', 'note.lead_id', 'event.who_id', 'event.related_to', 'audit.lead_id'];

  it('a declared list: named lists in order, an own-package unnamed list dropped, another package\'s kept', () => {
    expect(deriveRelatedLists(declared, registry as never)).toEqual(DECLARED);
  });

  it('an undeclared list: every list, in the derived order', () => {
    expect(ids(lead)).toEqual(AUTOMATIC);
  });

  it.each([
    ['absent', {}],
    ['null', { _relatedListsArrangement: null }],
    ['not a record', { _relatedListsArrangement: ['task'] }],
    ['without a package', { _relatedListsArrangement: { hidden: ['note'], unlisted: 'shown' } }],
  ])('a decoration that is %s is no arrangement: both answers are unchanged', (_label, decoration) => {
    expect(deriveRelatedLists({ ...declared, ...decoration }, registry as never)).toEqual(DECLARED);
    expect(ids({ ...lead, ...decoration })).toEqual(AUTOMATIC);
  });
});
