/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27823 — a record delete is permanent (the platform
 * has no recycle bin), so every one-record delete question says so, and the
 * success toast can name the record.
 *
 * The batch question (`console.objectView.bulkDeleteConfirm`) already carried
 * the pack's "this cannot be undone" sentence. The pin is that both one-record
 * questions — the list's and the record page's `objectActions.deleteConfirm`,
 * and plugin-detail's `detail.deleteConfirmation` — END WITH THAT SAME
 * SENTENCE in every one of the ten packs, read from the pack rather than
 * written out here, so a translation can reword it in one place without this
 * file moving, and a pack that drops it goes red.
 */

import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

function at(pack: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], pack);
}

/** The sentence after the batch question's question mark (ASCII, full-width or Arabic). */
function permanenceSentence(lang: LocaleCode): string {
  const bulk = at(builtInLocales[lang], 'console.objectView.bulkDeleteConfirm') as string;
  const cut = Math.max(bulk.lastIndexOf('?'), bulk.lastIndexOf('？'), bulk.lastIndexOf('؟'));
  return bulk.slice(cut + 1).trim();
}

describe('record delete says it is permanent and the toast can name the record (objectstack#27823)', () => {
  it('reads ten packs, and the en permanence sentence is the house wording', () => {
    expect(LANGS).toHaveLength(10);
    // Positive control for the extraction: it lands on a real sentence, not ''.
    expect(permanenceSentence('en')).toBe('This cannot be undone.');
  });

  it.each(LANGS)('%s: both one-record delete questions end with the batch question’s permanence sentence', (lang) => {
    const sentence = permanenceSentence(lang);
    expect(sentence.length, `${lang} permanence sentence`).toBeGreaterThan(3);
    for (const key of ['objectActions.deleteConfirm', 'detail.deleteConfirmation']) {
      const value = at(builtInLocales[lang], key) as string;
      expect(value.endsWith(sentence), `${lang}.${key} = ${value}`).toBe(true);
      // The question is still asked before it: the sentence was appended, not swapped in.
      expect(value.length, `${lang}.${key}`).toBeGreaterThan(sentence.length + 3);
    }
  });

  it.each(LANGS)('%s: the named delete toast interpolates exactly the label and the name', (lang) => {
    const value = at(builtInLocales[lang], 'objectActions.deletedNamed') as string;
    expect(typeof value).toBe('string');
    expect((value.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort()).toEqual(['{{label}}', '{{name}}']);
  });
});
