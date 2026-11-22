// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `pinnedHeaderActions`: an object's pinned header actions
 * applied to the actions one page header places. No pins answers the actions
 * as they are (the header draws as before); pins make the named actions the
 * header's buttons, in pin order, and send every other one to the overflow.
 */

import { describe, expect, it } from 'vitest';
import { pinnedHeaderActions } from '../ui-action';

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

describe('pinnedHeaderActions (objectstack#36366)', () => {
  it('no pins: the actions as they are, so the header draws as before', () => {
    expect(pinnedHeaderActions(RECORD, undefined, 'record')).toEqual(RECORD);
    expect(pinnedHeaderActions(LIST, null, 'list')).toEqual(LIST);
  });

  it('record: the pinned ones lead in pin order at record_header; the rest are record_more only', () => {
    const out = pinnedHeaderActions(RECORD, ['clone', 'mark_won'], 'record');
    expect(names(out)).toEqual(['clone', 'mark_won', 'edit', 'archive']);
    const [clone, markWon, edit, archive] = out;
    expect(clone.locations).toEqual(['record_more', 'record_header']);
    expect((clone.order as number) < (markWon.order as number)).toBe(true);
    expect(edit.locations).toEqual(['record_more']);
    expect(archive.locations).toEqual(['record_more']);
  });

  it('record: a pinned action authored into the overflow (`action:menu`) becomes a button', () => {
    const [archive] = pinnedHeaderActions(RECORD, ['archive'], 'record');
    expect(archive).toMatchObject({ name: 'archive', component: undefined });
    expect(archive.locations).toContain('record_header');
  });

  it('list: the pinned ones lead in pin order; the rest are `action:menu`, the bar overflow', () => {
    const out = pinnedHeaderActions(LIST, ['import_csv', 'new_lead'], 'list');
    expect(names(out)).toEqual(['import_csv', 'new_lead', 'mass_assign']);
    expect(out[0].component).toBeUndefined();
    expect(out[2].component).toBe('action:menu');
  });

  it('an empty arm pins nothing: every action goes to the overflow', () => {
    expect(pinnedHeaderActions(LIST, [], 'list').every((a) => a.component === 'action:menu')).toBe(true);
    expect(pinnedHeaderActions(RECORD, [], 'record').every((a) => !a.locations?.includes('record_header'))).toBe(true);
  });

  it('a pin naming no placed action, or a `$` built-in, draws nothing; a pin named twice counts once', () => {
    const out = pinnedHeaderActions(LIST, ['$export', 'ghost', 'mass_assign', 'mass_assign'], 'list');
    expect(names(out)).toEqual(['mass_assign', 'new_lead', 'import_csv']);
    expect(out.filter((a) => a.component !== 'action:menu').map((a) => a.name)).toEqual(['mass_assign']);
  });

  it('does not change the actions it is given', () => {
    const before = JSON.stringify(RECORD);
    pinnedHeaderActions(RECORD, ['clone'], 'record');
    expect(JSON.stringify(RECORD)).toBe(before);
  });
});
