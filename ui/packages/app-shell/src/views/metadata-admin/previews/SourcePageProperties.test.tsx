// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12522 — `SourcePageProperties`, the Properties tab of an html /
 * react page: what it shows, and that it writes only the page's `label`.
 *
 * - label, identifier and kind are shown, the kind in the create dialog's words;
 * - a label edit patches `label` alone: a plain string is replaced, a
 *   per-language map changes only the designer locale's entry;
 * - read-only (no `onPatch`), the label is text, not an input;
 * - no navigation entry opens the page → it says so.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SourcePageProperties } from './SourcePageProperties';
import { t } from '../i18n';

afterEach(cleanup);

const LABEL = t('engine.studio.if.pageProps.label', 'en');

describe('SourcePageProperties (objectui#12522)', () => {
  it('shows the label, the identifier, the kind and the entries that open the page', () => {
    render(
      <SourcePageProperties
        draft={{ name: 'guide', label: 'Guide', kind: 'react', source: 'function Page() {}' }}
        name="guide"
        navEntries={[
          { id: 'n1', label: 'Guide', trail: [] },
          { id: 'n2', label: 'Read me', trail: ['Docs', 'Start'] },
        ]}
        onPatch={() => {}}
        locale="en"
      />,
    );
    expect(screen.getByLabelText(LABEL)).toHaveValue('Guide');
    expect(screen.getByTestId('source-page-identifier')).toHaveTextContent('guide');
    expect(screen.getByTestId('source-page-kind')).toHaveTextContent(t('engine.studio.interfaces.create.pageKindReact', 'en'));
    const items = within(screen.getByTestId('source-page-nav-entries')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Guide', 'Docs › Start › Read me']);
  });

  it('a label edit patches `label` alone, replacing a plain string', () => {
    const onPatch = vi.fn();
    render(<SourcePageProperties draft={{ label: 'Guide', kind: 'html' }} name="guide" navEntries={[]} onPatch={onPatch} locale="en" />);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'Handbook' } });
    expect(onPatch).toHaveBeenCalledWith({ label: 'Handbook' });
  });

  it('a label edit on a per-language map changes only the designer locale entry', () => {
    const onPatch = vi.fn();
    render(
      <SourcePageProperties
        draft={{ label: { en: 'Guide', 'zh-CN': '指南' }, kind: 'html' }}
        name="guide"
        navEntries={[]}
        onPatch={onPatch}
        locale="zh-CN"
      />,
    );
    const input = screen.getByLabelText(t('engine.studio.if.pageProps.label', 'zh-CN'));
    expect(input).toHaveValue('指南');
    fireEvent.change(input, { target: { value: '手册' } });
    expect(onPatch).toHaveBeenCalledWith({ label: { en: 'Guide', 'zh-CN': '手册' } });
  });

  it('read-only, the label is text and nothing is editable', () => {
    render(<SourcePageProperties draft={{ label: 'Guide', kind: 'html' }} name="guide" navEntries={[]} readOnly locale="en" />);
    expect(screen.getByTestId('source-page-label').tagName).toBe('SPAN');
    expect(screen.getByTestId('source-page-label')).toHaveTextContent('Guide');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says so when no navigation entry opens the page', () => {
    render(<SourcePageProperties draft={{ label: 'Guide', kind: 'html' }} name="guide" navEntries={[]} locale="en" />);
    expect(screen.getByTestId('source-page-nav-none')).toHaveTextContent(t('engine.studio.if.pageProps.noNavEntries', 'en'));
  });
});
