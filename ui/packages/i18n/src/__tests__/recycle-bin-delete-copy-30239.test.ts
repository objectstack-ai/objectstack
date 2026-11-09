/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30239 (ADR-0148) — the delete copy once deletes can be undone.
 *
 * - A business object's delete goes to the recycle bin, so its questions
 *   (`objectActions.deleteConfirmQuestion`, `detail.deleteConfirmQuestion`,
 *   the `console.objectView.bulkDeleteQuestion` family) are the platform
 *   question WITHOUT its permanence sentence, in every pack — read from the
 *   pack, so a translation can reword it in one place.
 * - Every code the restore door answers has its own sentence
 *   (`recycleBin.refusal.*`): present in all ten packs, distinct from each
 *   other and from the generic `objectActions.restoreFailed`, interpolating
 *   exactly what the `en` sentence does. `en` and `zh-Hans` are pinned word
 *   for word, so the sentence a user reads is the one reviewed.
 */

import { describe, it, expect } from 'vitest';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];
const REFUSALS = [
  'uniqueValueTaken',
  'parentPurged',
  'packageUninstalled',
  'parentInRecycleBin',
  'notFound',
  'permissionDenied',
  'notAvailable',
] as const;

function at(pack: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], pack);
}
const placeholders = (value: string) => (value.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();

/** The sentence after the batch question's question mark (ASCII, full-width or Arabic). */
function permanenceSentence(lang: LocaleCode): string {
  const bulk = at(builtInLocales[lang], 'console.objectView.bulkDeleteConfirm') as string;
  const cut = Math.max(bulk.lastIndexOf('?'), bulk.lastIndexOf('？'), bulk.lastIndexOf('؟'));
  return bulk.slice(cut + 1).trim();
}

describe('recycle-bin delete copy (objectstack#30239)', () => {
  it('reads every pack', () => {
    expect(LANGS).toHaveLength(PLATFORM_LOCALE_TAGS.length);
  });

  it.each(LANGS)('%s: each business-object question is the platform question minus its permanence sentence', (lang) => {
    const pack = builtInLocales[lang];
    const sentence = permanenceSentence(lang);
    expect(sentence.length, `${lang} permanence sentence`).toBeGreaterThan(3);
    const pairs: Array<[string, string]> = [
      ['objectActions.deleteConfirmQuestion', 'objectActions.deleteConfirm'],
      ['detail.deleteConfirmQuestion', 'detail.deleteConfirmation'],
      ['console.objectView.bulkDeleteQuestion', 'console.objectView.bulkDeleteConfirm'],
    ];
    const objectView = at(pack, 'console.objectView') as Record<string, unknown>;
    for (const key of Object.keys(objectView)) {
      const m = /^bulkDeleteConfirm(_\w+)$/.exec(key);
      if (m) pairs.push([`console.objectView.bulkDeleteQuestion${m[1]}`, `console.objectView.${key}`]);
    }
    for (const [question, platform] of pairs) {
      const q = at(pack, question) as string;
      const p = at(pack, platform) as string;
      expect(typeof q, `${lang}.${question}`).toBe('string');
      expect(q.includes(sentence), `${lang}.${question} = ${q}`).toBe(false);
      expect(p.endsWith(sentence), `${lang}.${platform} control`).toBe(true);
      expect(p.slice(0, -sentence.length).trim(), `${lang}.${question}`).toBe(q);
    }
  });

  it.each(LANGS)('%s: seven distinct refusal sentences, none the generic failure, placeholders as en', (lang) => {
    const pack = builtInLocales[lang];
    const generic = at(pack, 'objectActions.restoreFailed') as string;
    expect(typeof generic).toBe('string');
    const seen = new Set<string>();
    for (const key of REFUSALS) {
      const value = at(pack, `recycleBin.refusal.${key}`) as string;
      const en = at(builtInLocales.en, `recycleBin.refusal.${key}`) as string;
      expect(typeof value, `${lang}.recycleBin.refusal.${key}`).toBe('string');
      expect(value.trim().length).toBeGreaterThan(5);
      expect(value).not.toBe(generic);
      expect(placeholders(value), `${lang}.recycleBin.refusal.${key}`).toEqual(placeholders(en));
      seen.add(value);
    }
    expect(seen.size).toBe(REFUSALS.length);
  });

  it.each(LANGS)('%s: the restore toasts interpolate the label (and the name)', (lang) => {
    const pack = builtInLocales[lang];
    expect(placeholders(at(pack, 'objectActions.restoredNamed') as string)).toEqual(['{{label}}', '{{name}}']);
    expect(placeholders(at(pack, 'objectActions.restoreSuccess') as string)).toEqual(['{{label}}']);
    expect(placeholders(at(pack, 'objectActions.restoreFailed') as string)).toEqual(['{{label}}']);
  });

  it('en and zh-Hans read the reviewed sentences', () => {
    const read = (lang: LocaleCode) =>
      Object.fromEntries(REFUSALS.map((k) => [k, at(builtInLocales[lang], `recycleBin.refusal.${k}`)]));
    expect(read('en')).toEqual({
      uniqueValueTaken: "Can't restore: another record now has the same {{field}} value. Change that record first, then restore.",
      parentPurged: "Can't restore: the {{parent}} record it belonged to has been permanently deleted.",
      packageUninstalled: "Can't restore: the package that provided {{object}} has been uninstalled.",
      parentInRecycleBin: "Can't restore yet: the {{parent}} record it belongs to is also in the recycle bin. Restore that record first.",
      notFound: 'This record is no longer in the recycle bin. It may have been purged.',
      permissionDenied: "You don't have permission to restore this record.",
      notAvailable: 'The recycle bin is not available on this deployment.',
    });
    expect(read('zh-Hans')).toEqual({
      uniqueValueTaken: '无法恢复：另一条记录已在使用相同的「{{field}}」值。请先修改那条记录，再恢复。',
      parentPurged: '无法恢复：它所属的{{parent}}记录已被永久删除。',
      packageUninstalled: '无法恢复：提供「{{object}}」的软件包已被卸载。',
      parentInRecycleBin: '暂时无法恢复：它所属的{{parent}}记录也在回收站中。请先恢复那条记录。',
      notFound: '这条记录已不在回收站中，可能已被清除。',
      permissionDenied: '您没有恢复这条记录的权限。',
      notAvailable: '此部署未启用回收站。',
    });
  });
});
