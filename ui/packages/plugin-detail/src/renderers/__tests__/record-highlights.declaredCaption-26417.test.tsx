/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The highlight strip's chip caption climbs the details body's label ladder
 * (objectstack#26417).
 *
 * The card's sighting: an AI-built object with no i18n bundle, whose record
 * drawer drew 「陈静 | 周明轩」 under the title with an EMPTY caption over each
 * value. The synthesized page hands `record:highlights` bare names, the
 * renderer turns each into `{ name }`, and the strip asked
 * `fieldLabel(objectName, name, field.label)`: with no bundle key and no
 * authored label that is `undefined`, a blank caption.
 *
 * The details body names the same fields through one ladder — bundle key, then
 * the entry's label (the authored one, else the label the OBJECT declares,
 * read with `pickLocalized`), then the field name (`withDeclaredLabel` in
 * `record-details.tsx`, `field.label || field.name` in `DetailSection`). The
 * strip now climbs that same ladder. Every leg reads a chip that is on screen
 * (its value is asserted first), so an empty caption cannot pass as a strip
 * that drew nothing.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { HighlightFieldsProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { HeaderHighlight } from '../../HeaderHighlight';
import { RecordDetailsRenderer } from '../record-details';
import { RecordHighlightsRenderer } from '../record-highlights';

const OBJECT = 'home_project';

/** An AI-built object: declared labels, and no bundle entry anywhere. */
const objectSchema = {
  name: OBJECT,
  label: '家装项目',
  fields: {
    owner: { type: 'text', label: '所有者' },
    customer: { type: 'text', label: '关联客户' },
    // An inline locale map, the other spelling a declared label may take.
    stage: { type: 'text', label: { en: 'Stage', 'zh-CN': '阶段' } },
  },
};

const record = {
  id: 'P1',
  owner: '陈静',
  customer: '周明轩',
  stage: 'design-stage',
  notes: 'notes-value',
};

type Provider = { language: string } | { instance: ReturnType<typeof createI18n> };

const withI18n = (provider: Provider, node: React.ReactNode) => (
  <I18nProvider
    {...('instance' in provider
      ? { instance: provider.instance }
      : { config: { defaultLanguage: provider.language, detectBrowserLanguage: false } })}
    persistLanguage={false}
  >
    {node}
  </I18nProvider>
);

/** The record page's strip, from the bare names the synthesized page hands it. */
function mountStrip(fields: unknown[], provider: Provider = { language: 'zh' }) {
  return render(
    withI18n(
      provider,
      <RecordContextProvider
        objectName={OBJECT}
        recordId={record.id}
        data={record}
        objectSchema={objectSchema as never}
      >
        <HighlightFieldsProvider>
          <div data-testid="strip">
            <RecordHighlightsRenderer schema={{ fields } as never} />
          </div>
        </HighlightFieldsProvider>
      </RecordContextProvider>,
    ),
  );
}

/** The caption over the chip that shows `value` — the chip's first span. */
function captionOf(value: string): string | null {
  const strip = within(screen.getByTestId('strip').querySelector('section') as HTMLElement);
  const chip = strip.getByText(value).closest('section > div > div') as HTMLElement | null;
  if (!chip) throw new Error(`HARNESS DEAD: no chip holds ${value}`);
  return chip.firstElementChild?.textContent ?? null;
}

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain`; a double keeps
  // the socket closed. Its answer is orthogonal to the captions.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a highlight chip with no bundle entry is captioned by its declared label (objectstack#26417)', () => {
  it('bare names on an object with no bundle: each chip reads the label the object declares', () => {
    mountStrip(['owner', 'customer']);
    expect(captionOf('陈静')).toBe('所有者');
    expect(captionOf('周明轩')).toBe('关联客户');
  });

  it('an inline locale map is read in the session language, never as an object', () => {
    mountStrip(['stage'], { language: 'zh' });
    expect(captionOf('design-stage')).toBe('阶段');
    cleanup();
    mountStrip(['stage'], { language: 'en' });
    expect(captionOf('design-stage')).toBe('Stage');
  });

  it('a field the object declares no label for falls back to its name, never a blank caption', () => {
    mountStrip(['notes']);
    expect(captionOf('notes-value')).toBe('notes');
  });

  it('a translated label still wins over the declared one', () => {
    const instance = createI18n({
      defaultLanguage: 'zh',
      detectBrowserLanguage: false,
      resources: { zh: { app: { fields: { [OBJECT]: { owner: '负责人' } } } } },
    });
    mountStrip(['owner', 'customer'], { instance });
    expect(captionOf('陈静')).toBe('负责人');
    // The bundle names one field; the other still climbs to its declared label.
    expect(captionOf('周明轩')).toBe('关联客户');
  });

  it('an authored label on the entry still wins over the declared one', () => {
    mountStrip([{ name: 'owner', label: 'Account Owner' }, 'customer']);
    expect(captionOf('陈静')).toBe('Account Owner');
    expect(captionOf('周明轩')).toBe('关联客户');
  });

  it('the strip and the details body name the same field the same way', async () => {
    mountStrip(['owner', 'customer']);
    const stripCaptions = [captionOf('陈静'), captionOf('周明轩')];
    cleanup();
    render(
      withI18n(
        { language: 'zh' },
        <RecordContextProvider
          objectName={OBJECT}
          recordId={record.id}
          data={record}
          objectSchema={objectSchema as never}
        >
          <div data-testid="body">
            <RecordDetailsRenderer schema={{ sections: [{ label: 'Main', fields: ['owner', 'customer'] }] } as never} />
          </div>
        </RecordContextProvider>,
      ),
    );
    const body = within(screen.getByTestId('body'));
    // Live control: the body drew the record's values.
    expect(await body.findByText('陈静')).toBeInTheDocument();
    for (const caption of stripCaptions) expect(body.getByText(caption as string)).toBeInTheDocument();
  });
});

describe('the caption follows an object definition that arrives after the record (objectstack#26417)', () => {
  it('names the field until the definition lands, then reads its declared label', () => {
    const strip = (schema: unknown) =>
      withI18n(
        { language: 'zh' },
        <div data-testid="strip">
          <HeaderHighlight
            fields={[{ name: 'owner' }] as never}
            data={record}
            objectName={OBJECT}
            objectSchema={schema}
          />
        </div>,
      );
    const { rerender } = render(strip(undefined));
    expect(captionOf('陈静')).toBe('owner');
    rerender(strip(objectSchema));
    expect(captionOf('陈静')).toBe('所有者');
  });
});
