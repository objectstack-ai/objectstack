// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `arrangedHeaderActions`: an object's action layout arm
 * applied to the actions one header of its scope places. No arm answers the
 * actions as they are (the header draws as before); an arm makes its `pinned`
 * actions the header's buttons, in order, and sends every other one to the
 * overflow, the ones `more` names first, in that order, then the rest in
 * their own order.
 */

import { describe, expect, it } from 'vitest';
import { arrangedHeaderActions } from '../ui-action';

const RECORD = [
  { name: 'edit', locations: ['record_header'], order: 1 },
  { name: 'clone', locations: ['record_more'] },
  { name: 'mark_won', locations: ['record_header'], order: 5 },
  { name: 'archive', locations: ['record_header', 'record_more'], component: 'action:menu' },
];

const LIST = [
  { name: 'new_lead', locations: ['list_toolbar'] },
  { name: 'mass_assign', locations: ['list_toolbar'], order: 3 },
  { name: 'import_csv', locations: ['list_toolbar'], component: 'action:menu' },
];

const names = (actions: readonly { name?: unknown }[]) => actions.map((a) => a.name);

describe('arrangedHeaderActions (objectstack#36366)', () => {
  it('no arm: the actions as they are, so the header draws as before', () => {
    expect(arrangedHeaderActions(RECORD, undefined, 'record')).toEqual(RECORD);
    expect(arrangedHeaderActions(LIST, null, 'list')).toEqual(LIST);
    // A value that is no arm (the old per-page array, an arm without `pinned`) is none.
    expect(arrangedHeaderActions(RECORD, ['clone'], 'record')).toEqual(RECORD);
    expect(arrangedHeaderActions(RECORD, { more: ['clone'] }, 'record')).toEqual(RECORD);
  });

  it('record: the pinned ones lead in pin order at record_header; the rest are record_more only', () => {
    const out = arrangedHeaderActions(RECORD, { pinned: ['clone', 'mark_won'] }, 'record');
    expect(names(out)).toEqual(['clone', 'mark_won', 'edit', 'archive']);
    const [clone, markWon, edit, archive] = out;
    expect(clone.locations).toEqual(['record_more', 'record_header']);
    expect((clone.order as number) < (markWon.order as number)).toBe(true);
    expect(edit.locations).toEqual(['record_more']);
    expect(archive.locations).toEqual(['record_more']);
  });

  it('record: a pinned action authored into the overflow (`action:menu`) becomes a button', () => {
    const [archive] = arrangedHeaderActions(RECORD, { pinned: ['archive'] }, 'record');
    expect(archive).toMatchObject({ name: 'archive', component: undefined });
    expect(archive.locations).toContain('record_header');
  });

  it('list: the pinned ones lead in pin order; the rest are `action:menu`, the bar overflow', () => {
    const out = arrangedHeaderActions(LIST, { pinned: ['import_csv', 'new_lead'] }, 'list');
    expect(names(out)).toEqual(['import_csv', 'new_lead', 'mass_assign']);
    expect(out[0].component).toBeUndefined();
    expect(out[2].component).toBe('action:menu');
  });

  it('an empty `pinned` draws no button: every action goes to the overflow', () => {
    expect(arrangedHeaderActions(LIST, { pinned: [] }, 'list').every((a) => a.component === 'action:menu')).toBe(true);
    expect(arrangedHeaderActions(RECORD, { pinned: [] }, 'record').every((a) => !a.locations?.includes('record_header'))).toBe(true);
  });

  it('a name naming no placed action, or a `$` built-in, draws nothing; a name twice counts once', () => {
    const out = arrangedHeaderActions(LIST, { pinned: ['$export', 'ghost', 'mass_assign', 'mass_assign'] }, 'list');
    expect(names(out)).toEqual(['mass_assign', 'new_lead', 'import_csv']);
    expect(out.filter((a) => a.component !== 'action:menu').map((a) => a.name)).toEqual(['mass_assign']);
  });

  it('record: `more` orders the overflow, ahead of the actions it does not name, which keep their own order', () => {
    const out = arrangedHeaderActions(RECORD, { pinned: ['mark_won'], more: ['archive', 'clone'] }, 'record');
    expect(names(out)).toEqual(['mark_won', 'archive', 'clone', 'edit']);
    const [markWon, archive, clone, edit] = out;
    expect((markWon.order as number) < (archive.order as number)).toBe(true);
    expect((archive.order as number) < (clone.order as number)).toBe(true);
    expect((clone.order as number) < (edit.order as number)).toBe(true);
    expect([archive, clone, edit].every((a) => !a.locations?.includes('record_header'))).toBe(true);
  });

  it('list: `more` orders the bar overflow the same way', () => {
    const out = arrangedHeaderActions(LIST, { pinned: [], more: ['mass_assign', '$export', 'import_csv'] }, 'list');
    expect(names(out)).toEqual(['mass_assign', 'import_csv', 'new_lead']);
    expect(out.every((a) => a.component === 'action:menu')).toBe(true);
    expect((out[0].order as number) < (out[1].order as number)).toBe(true);
  });

  it('a name in both parts is a button: `pinned` wins', () => {
    const out = arrangedHeaderActions(LIST, { pinned: ['new_lead'], more: ['new_lead', 'mass_assign'] }, 'list');
    expect(names(out)).toEqual(['new_lead', 'mass_assign', 'import_csv']);
    expect(out[0].component).toBeUndefined();
  });

  it('does not change the actions it is given', () => {
    const before = JSON.stringify(RECORD);
    arrangedHeaderActions(RECORD, { pinned: ['clone'], more: ['edit'] }, 'record');
    expect(JSON.stringify(RECORD)).toBe(before);
  });
});
