// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12522 — the source editor's textarea fallback (no Monaco: offline,
 * air-gapped, a strict CSP) numbers its lines and wraps long ones, as the
 * Monaco editor it stands in for does (`lineNumbers: 'on'`, `wordWrap: 'on'`).
 *
 * The gutter is one number per SOURCE line, so it follows an edit; the
 * textarea itself wraps (`whitespace-pre-wrap`), and the invisible rows that
 * set the numbers' places wrap the same way.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});

import { SourcePageEditor } from './SourcePageEditor';

afterEach(cleanup);

const SOURCE = ['<flex direction="col" gap={4}>', '  <p>One</p>', '', '</flex>'].join('\n');

describe('SourcePageEditor textarea fallback (objectui#12522)', () => {
  it('numbers every source line, wraps long lines, and renumbers after an edit', async () => {
    const onPatch = vi.fn();
    render(<SourcePageEditor mode="editor" draft={{ kind: 'html', source: SOURCE }} onPatch={onPatch} locale="en" />);

    const editor = await screen.findByRole('textbox', { name: 'Page source' });
    expect(editor).toHaveClass('whitespace-pre-wrap', 'font-mono', 'text-xs');
    expect(screen.getAllByTestId('source-line-number').map((n) => n.textContent)).toEqual(['1', '2', '3', '4']);

    fireEvent.change(editor, { target: { value: `${SOURCE}\n<p>Two</p>` } });
    expect(onPatch).toHaveBeenLastCalledWith({ source: `${SOURCE}\n<p>Two</p>` });
    expect(screen.getAllByTestId('source-line-number')).toHaveLength(5);
  });
});
