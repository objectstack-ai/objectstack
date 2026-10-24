/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A line-items grid's file cell states its text in the session language
 * (objectui#12924).
 *
 * `displayText` printed a cell holding several files as the English literal
 * `N files`, and a file whose value carries no name as `File`, on every
 * locale. Both now read the packs: the count through `detail.fileCount`, the
 * count family the file cell renderer states a file count with, so each pack's
 * plural slots apply; the name through `fields.file.fileFallback`, the name
 * `FileField` and the file cell renderer give a nameless file. No key was
 * added.
 *
 * Two of the faces that read `displayText` are pinned: the list-mode cell (a
 * per-row form collection) and the read-only table, whose file cells read it
 * already. Every oracle is read from the pack, with `Intl.PluralRules` naming
 * the slot, so a pin cannot pass on a hand-copied word.
 *
 * The provider-less English is the `.no-provider` companion of this file.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, ru, zh } from '@object-ui/i18n/locales';
import { GridField } from './GridField';

afterEach(() => cleanup());

const columns = [{ name: 'docs', label: 'Docs', type: 'file' as const, multiple: true }];

const file = (n: number) => ({ id: `f_${n}`, name: `att-${n}.pdf`, url: `/api/v1/storage/files/f_${n}` });
/** A file value that carries no name of its own. */
const NAMELESS = { url: '/api/v1/storage/files/f_9' };

/** Row 1 holds two files, row 2 one nameless file, row 3 five files. */
const rows = [{ docs: [file(1), file(2)] }, { docs: NAMELESS }, { docs: [1, 2, 3, 4, 5].map(file) }];

/** The two members of a pack these pins read. */
type Pack = { detail: Record<string, string>; fields: { file: { fileFallback: string } } };
const EN = en as unknown as Pack;
const RU = ru as unknown as Pack;
const ZH = zh as unknown as Pack;

/** The pack's count sentence for `count`, in the slot the language selects for it. */
function countIn(pack: Pack, language: string, count: number): string {
  const slot = new Intl.PluralRules(language).select(count);
  const sentence = pack.detail[`fileCount_${slot}`];
  expect(sentence, `the ${language} pack spells fileCount_${slot}`).toBeTruthy();
  return sentence.replace('{{count}}', String(count));
}

/** What the three rows above must read in `language`. */
const expectedIn = (pack: Pack, language: string) => [
  countIn(pack, language, 2),
  pack.fields.file.fileFallback,
  countIn(pack, language, 5),
];

function inLanguage(language: string, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{node}</I18nProvider>,
  );
}

/** Each row's file cell text, in row order: the first cell is the row number, the second the file column. */
const fileCells = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[1]?.textContent ?? '');

const listGrid = (language: string, value: Array<Record<string, unknown>> = rows) =>
  inLanguage(
    language,
    <GridField value={value} onChange={() => {}} field={{ columns } as never} displayMode="list" onAdd={() => {}} />,
  );

const readonlyGrid = (language: string, value: Array<Record<string, unknown>> = rows) =>
  inLanguage(language, <GridField value={value} onChange={() => {}} field={{ columns } as never} readonly />);

describe("GridField's file cell text reads the packs (objectui#12924)", () => {
  it('zh: the list-mode cell counts files and names a nameless file in Chinese', async () => {
    const { container } = listGrid('zh');
    // `waitFor`: the zh catalogue loads after the first render.
    await waitFor(() => expect(fileCells(container)).toEqual(expectedIn(ZH, 'zh')));
    expect(container.querySelector('tbody')?.textContent).not.toMatch(/files?|File/);
  });

  it('zh: the read-only table reads the same words', async () => {
    const { container } = readonlyGrid('zh');
    await waitFor(() => expect(fileCells(container)).toEqual(expectedIn(ZH, 'zh')));
  });

  it('ru: each count takes the slot Russian selects for it (`few` for 2, `many` for 5)', async () => {
    expect([2, 5].map((n) => new Intl.PluralRules('ru').select(n))).toEqual(['few', 'many']);
    const { container } = readonlyGrid('ru');
    const expected = expectedIn(RU, 'ru');
    await waitFor(() => expect(fileCells(container)).toEqual(expected));
    // Two different sentences: one string for every count would be no plural at all.
    expect(expected[0].replace('2', '#')).not.toBe(expected[2].replace('5', '#'));
  });

  it('CONTROL en: the English pack reads `2 files` and `File`, as the literals did', async () => {
    const { container } = listGrid('en');
    await waitFor(() => expect(fileCells(container)).toEqual(expectedIn(EN, 'en')));
    expect(fileCells(container)).toEqual(['2 files', 'File', '5 files']);
  });

  it('CONTROL: a file that carries a name is shown by that name, not by a pack word', async () => {
    const { container } = readonlyGrid('zh', [{ docs: [file(7)] }]);
    await waitFor(() => expect(fileCells(container)).toEqual(['att-7.pdf']));
  });
});
