/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `matchesPaletteQuery`, the rule the ⌘K palette matches its navigation
 * entries and built-in commands by (objectui#11812): a word prefix, or a
 * contiguous substring of at least three characters, of the entry's label or
 * machine name. Never letters scattered across the entry.
 *
 * The labels below are the showcase app's, the ones the QA pass on the card
 * read: cmdk's default subsequence scorer gave every one of the "scattered"
 * pairs a score above zero.
 */

import { describe, it, expect } from 'vitest';
import { matchesPaletteQuery } from './paletteMatch';

describe('objectui#11812 — palette entries match on word prefixes and substrings, not scattered letters', () => {
  it.each([
    ['zzzz', 'Field Zoo', 'showcase_field_zoo'],
    ['zzzz', 'New Project (Wizard)', 'showcase_new_project_wizard'],
    ['ingest', 'In-Progress Tasks', 'showcase_task'],
    ['ingest', 'Cascading Select', 'showcase_cascade'],
    ['ingest', 'Page Authoring', 'showcase_start_here'],
    ['ingest', 'Styling (ADR-0065)', 'showcase_styling_gallery'],
    ['wayne', 'Styling (ADR-0065)', 'showcase_styling_gallery'],
  ])('%s does not match %s (%s)', (query, label, name) => {
    expect(matchesPaletteQuery(query, [label, name])).toBe(false);
  });

  it('a word prefix of the label or of the machine name matches, at any length', () => {
    expect(matchesPaletteQuery('field', ['Field Zoo', 'showcase_field_zoo'])).toBe(true);
    expect(matchesPaletteQuery('Z', ['Field Zoo'])).toBe(true);
    expect(matchesPaletteQuery('zo', ['Field Zoo'])).toBe(true);
    expect(matchesPaletteQuery('casc', ['Cascading Select', 'showcase_cascade'])).toBe(true);
    // A word of the machine name: `_` separates words.
    expect(matchesPaletteQuery('gal', ['Styling (ADR-0065)', 'showcase_styling_gallery'])).toBe(true);
    // A word after a bracket or a hyphen.
    expect(matchesPaletteQuery('wiz', ['New Project (Wizard)'])).toBe(true);
    expect(matchesPaletteQuery('progress', ['In-Progress Tasks'])).toBe(true);
  });

  it('a substring inside a word matches from three characters on, not before', () => {
    expect(matchesPaletteQuery('view', ['Task Overview', 'showcase_task_overview'])).toBe(true);
    expect(matchesPaletteQuery('ingest', ['Replay Queue', 'ops_reingest_queue'])).toBe(true);
    expect(matchesPaletteQuery('eld', ['Field Zoo'])).toBe(true);
    expect(matchesPaletteQuery('ld', ['Field Zoo'])).toBe(false);
    expect(matchesPaletteQuery('z', ['New Project (Wizard)'])).toBe(false);
  });

  it('a phrase matches contiguously, a hyphen and a space read alike, case is ignored', () => {
    expect(matchesPaletteQuery('field zoo', ['Field Zoo'])).toBe(true);
    expect(matchesPaletteQuery('in progress', ['In-Progress Tasks'])).toBe(true);
    expect(matchesPaletteQuery('IN-PROG', ['In-Progress Tasks'])).toBe(true);
    expect(matchesPaletteQuery('zoo field', ['Field Zoo'])).toBe(false);
  });

  it('in Han and kana every character starts a word, so a short substring matches anywhere', () => {
    const label = 'Command Center (大屏)';
    expect(matchesPaletteQuery('大屏', [label, 'showcase_command_center'])).toBe(true);
    expect(matchesPaletteQuery('屏', [label])).toBe(true);
    expect(matchesPaletteQuery('户', ['重点客户'])).toBe(true);
    expect(matchesPaletteQuery('ザー', ['ユーザー管理'])).toBe(true);
    expect(matchesPaletteQuery('华宁', [label, 'showcase_command_center'])).toBe(false);
  });

  it('a blank query matches every entry; a missing term matches nothing', () => {
    expect(matchesPaletteQuery('', ['Field Zoo'])).toBe(true);
    expect(matchesPaletteQuery('   ', ['Field Zoo'])).toBe(true);
    expect(matchesPaletteQuery('field', [undefined, null])).toBe(false);
    expect(matchesPaletteQuery('', [])).toBe(true);
  });

  it('surrounding whitespace in the query is ignored', () => {
    expect(matchesPaletteQuery(' zoo ', ['Field Zoo'])).toBe(true);
  });
});
