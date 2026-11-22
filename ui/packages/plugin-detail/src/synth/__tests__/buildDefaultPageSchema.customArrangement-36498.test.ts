/**
 * objectstack#36498 (ADR-0146 D10) — the tab list the base's paired `.custom`
 * package declares, laid over an object that declared none. Every tab the
 * automatic list showed still shows, so the one thing the synthesized page
 * reads from the served read's `_relatedListsArrangement` decoration is
 * `unlisted: 'shown'`: an unlisted attachments tab is still drawn, at the end
 * of the tabs. Which related lists exist is the host's (`deriveRelatedLists`).
 * Laid over a DECLARED list (`unlisted: 'hidden'`), the served list is still a
 * declared one when it is empty (every tab of it hidden): no attachments tab.
 *
 * With no decoration the tab row is what it was: each row's control differs
 * from it by the decoration alone, and the last block pins the declared and
 * the undeclared row against literal values.
 */
import { describe, it, expect } from 'vitest';
import { buildDefaultTabs, type ObjectDefLike } from '../buildDefaultPageSchema';

/** A page component's props live in the node's `properties` bag (ADR-0089 D3a); no flat fallback. */
const props = (node: any): Record<string, any> => node?.properties ?? {};
const tabItems = (node: any): any[] => props(node).items ?? [];

const def = (relatedLists: unknown[] | undefined, decoration: Record<string, unknown> = {}): ObjectDefLike => ({
  name: 'lead',
  label: 'Lead',
  fields: { name: { type: 'text', label: 'Name' } },
  enable: { files: true },
  ...(relatedLists ? { relatedLists } : {}),
  ...decoration,
} as ObjectDefLike);

const arranged = (unlisted: 'shown' | 'hidden') => ({
  _relatedListsArrangement: { packageId: 'com.vendor.crm.custom', hidden: [], unlisted },
});

const related = [
  { objectName: 'task', relationshipField: 'lead_id' },
  { objectName: 'note', relationshipField: 'lead_id' },
];
const values = (d: ObjectDefLike) =>
  tabItems(buildDefaultTabs(d, { related, approvals: { count: 1 } })).map((t: any) => t.value);

describe('the `.custom` tab list over the automatic one (`unlisted: shown`)', () => {
  it('an unlisted attachments tab is still drawn, after the unlisted related tabs', () => {
    expect(values(def(['note'], arranged('shown')))).toEqual([
      'details', 'related:note.lead_id', 'related:task.lead_id', 'attachments', 'approvals', 'timeline',
    ]);
  });

  it('control — no decoration: leaving `sys_attachment` out removes the attachments tab, as before', () => {
    expect(values(def(['note']))).toEqual([
      'details', 'related:note.lead_id', 'related:task.lead_id', 'approvals', 'timeline',
    ]);
  });

  it('control — `unlisted: hidden` (the arrangement replaced a declared list): the served list\'s own rule', () => {
    expect(values(def(['note'], arranged('hidden')))).toEqual([
      'details', 'related:note.lead_id', 'related:task.lead_id', 'approvals', 'timeline',
    ]);
  });

  it('a listed attachments tab sits at its entry either way', () => {
    const listed = ['sys_attachment', 'note'];
    const expected = ['details', 'attachments', 'related:note.lead_id', 'related:task.lead_id', 'approvals', 'timeline'];
    expect(values(def(listed, arranged('shown')))).toEqual(expected);
    expect(values(def(listed))).toEqual(expected);
  });

  it('the unlisted tabs sit before a trailing listed approvals / stream run', () => {
    expect(values(def(['note', 'sys_activity'], arranged('shown')))).toEqual([
      'details', 'related:note.lead_id', 'related:task.lead_id', 'attachments', 'timeline', 'approvals',
    ]);
  });
});

describe('every tab of a declared list hidden: an empty served list beside `unlisted: hidden`', () => {
  // The host passes the lists that still show: here one another package brings.
  const host = [{ objectName: 'audit', relationshipField: 'lead_id' }];
  const row = (d: ObjectDefLike) =>
    tabItems(buildDefaultTabs(d, { related: host, approvals: { count: 1 } })).map((t: any) => t.value);

  it('the row follows the declared rules: no attachments tab, approvals and the stream close it', () => {
    expect(row(def([], arranged('hidden')))).toEqual(['details', 'related:audit.lead_id', 'approvals', 'timeline']);
  });

  it('control: the same empty list with no decoration is the automatic row, attachments drawn', () => {
    expect(row(def([]))).toEqual(['details', 'related:audit.lead_id', 'attachments', 'approvals', 'timeline']);
  });
});

describe('PIN — no `.custom` arrangement served: the tab row is what it was', () => {
  const AUTOMATIC = ['details', 'related:task.lead_id', 'related:note.lead_id', 'attachments', 'approvals', 'timeline'];
  const DECLARED = ['details', 'related:note.lead_id', 'related:task.lead_id', 'approvals', 'timeline'];

  it.each([
    ['absent', {}],
    ['null', { _relatedListsArrangement: null }],
    ['without a package', { _relatedListsArrangement: { hidden: [], unlisted: 'shown' } }],
  ])('a decoration that is %s: the undeclared and the declared row are unchanged', (_label, decoration) => {
    expect(values(def(undefined, decoration))).toEqual(AUTOMATIC);
    expect(values(def([], decoration))).toEqual(AUTOMATIC);
    expect(values(def(['note'], decoration))).toEqual(DECLARED);
  });
});
