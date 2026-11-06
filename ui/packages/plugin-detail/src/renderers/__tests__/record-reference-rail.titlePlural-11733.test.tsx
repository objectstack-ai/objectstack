/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:reference_rail` names an untitled entry with the related object's
 * PLURAL label (objectui#11733).
 *
 * Each rail entry is a card listing the related object's records under a count
 * badge, and the entries with no records are folded into one "+ N empty
 * (…)" line that names them. Both names fell back to the singular bundle key,
 * `objects.{name}.label`; they now read `objectPluralLabel`, which tries
 * `objects.{name}.pluralLabel` first and falls back to that same singular key,
 * then to the humanized object name, as before.
 *
 * Like `record:related_list`, the rail holds the related object's NAME only,
 * so both its rungs are bundle keys and the fixtures carry the plural in the
 * bundle, in `en` as in `zh-CN`, differing from the label in each. The control
 * is an entry whose bundle translates only the label.
 *
 * Direction, written before the run: with both sites put back to
 * `objectLabel`, the plural cells RED (`Task` / `任务`, `Opportunity` / `商机`);
 * the control GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';

import { RecordReferenceRailRenderer } from '../record-reference-rail';

/** Fires every observed entry as visible at once, so each card fetches. */
class ImmediateIO {
  constructor(private cb: (records: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
}

type Lang = 'en' | 'zh-CN';

const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: {
    showcase: {
      objects: {
        showcase_task: { label: 'Task', pluralLabel: 'Tasks' },
        showcase_opportunity: { label: 'Opportunity', pluralLabel: 'Opportunities' },
      },
    },
  },
  'zh-CN': {
    showcase: {
      objects: {
        showcase_task: { label: '任务', pluralLabel: '任务清单' },
        showcase_opportunity: { label: '商机', pluralLabel: '商机列表' },
        showcase_note: { label: '笔记' },
      },
    },
  },
};

/** Tasks and notes have a record each; opportunities have none. */
const makeDataSource = () => ({
  find: vi.fn(async (objectName: string) =>
    objectName === 'showcase_opportunity'
      ? { data: [], total: 0 }
      : { data: [{ id: `${objectName}-1`, name: 'One' }], total: 1 },
  ),
});

/** No `title` on any entry: every name is the fallback under test. */
const RAIL = {
  entries: [
    { objectName: 'showcase_task', relationshipField: 'project' },
    { objectName: 'showcase_note', relationshipField: 'project' },
    { objectName: 'showcase_opportunity', relationshipField: 'project' },
  ],
};

function mountIn(lang: Lang) {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  return render(
    <I18nProvider instance={i18n}>
      <MemoryRouter>
        <RecordContextProvider objectName="showcase_project" recordId="P-1" dataSource={makeDataSource() as never}>
          <RecordReferenceRailRenderer schema={RAIL as never} />
        </RecordContextProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The "+ N empty (…)" line, whose `title` lists the empty entries' names. */
const emptyLineNames = async () =>
  (await screen.findByText(/^\+ ?1/)).closest('button')?.getAttribute('title');

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIO as unknown as typeof IntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('record:reference_rail names untitled entries with the plural (objectui#11733)', () => {
  it('en: the card is "Tasks", the empty line names "Opportunities"', async () => {
    mountIn('en');
    expect(await screen.findByText('Tasks')).toBeInTheDocument();
    expect(await emptyLineNames()).toBe('Opportunities');
    expect(screen.queryByText('Task')).toBeNull();
  });

  it('zh-CN: the translated plurals', async () => {
    mountIn('zh-CN');
    expect(await screen.findByText('任务清单')).toBeInTheDocument();
    expect(await emptyLineNames()).toBe('商机列表');
    expect(screen.queryByText('任务')).toBeNull();
  });

  it('CONTROL: an entry whose bundle translates only the label keeps the label', async () => {
    mountIn('zh-CN');
    expect(await screen.findByText('笔记')).toBeInTheDocument();
  });
});

/**
 * objectstack#30486 — an untitled card is named by the related object's
 * SERVED name.
 *
 * The rail already reads each related object's schema (for its fields and
 * declared name field); that read also carries the `label` and `pluralLabel`
 * the server translated for the session, a `.custom` rename included. Both
 * names, the card title and the empty line, read them by the served-object-label
 * rule (`servedObjectPluralLabel`, `@object-ui/core`), and the bundle answers
 * only for an object served without either — the cases above, whose data
 * source has no `getObjectSchema` at all.
 *
 * Direction, written before the run: with both sites put back to the bundle
 * alone, the rename cells RED (`Tasks` / `任务清单`, `商机列表`); the
 * control, an object served without a label, GREEN on both sides.
 */
describe('record:reference_rail names untitled entries with the served name (objectstack#30486)', () => {
  const SERVED: Record<Lang, Record<string, { label?: string; pluralLabel?: string }>> = {
    en: {
      showcase_task: { label: 'Work item', pluralLabel: 'Work items' },
      showcase_opportunity: { label: 'Deal', pluralLabel: 'Deals' },
    },
    'zh-CN': {
      showcase_task: { label: '工作项', pluralLabel: '工作事项' },
      showcase_opportunity: { label: '交易' },
    },
  };

  function mountServed(lang: Lang) {
    const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
    expect(i18n.language).toBe(lang);
    i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
    const dataSource = {
      ...makeDataSource(),
      getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {}, ...SERVED[lang][name] })),
    };
    return render(
      <I18nProvider instance={i18n}>
        <MemoryRouter>
          <RecordContextProvider objectName="showcase_project" recordId="P-1" dataSource={dataSource as never}>
            <RecordReferenceRailRenderer schema={RAIL as never} />
          </RecordContextProvider>
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  it('en: the card and the empty line draw the served renames', async () => {
    mountServed('en');
    expect(await screen.findByText('Work items')).toBeInTheDocument();
    expect(await emptyLineNames()).toBe('Deals');
    expect(screen.queryByText('Tasks')).toBeNull();
  });

  it('zh-CN: the served plural, else the served label, drawn as given', async () => {
    mountServed('zh-CN');
    expect(await screen.findByText('工作事项')).toBeInTheDocument();
    expect(await emptyLineNames()).toBe('交易');
    expect(screen.queryByText('任务清单')).toBeNull();
  });

  it('CONTROL: an object served without a label keeps the bundle name', async () => {
    mountServed('zh-CN');
    expect(await screen.findByText('笔记')).toBeInTheDocument();
  });
});
