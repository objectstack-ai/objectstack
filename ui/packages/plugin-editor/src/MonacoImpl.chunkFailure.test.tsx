/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The bundled Monaco chunk cannot be loaded (the host could not fetch it):
 * `MonacoImpl` edits the same text in a plain textarea instead of staying on a
 * "Loading..." that never ends, and says why once.
 *
 * The failure is made where it happens in a browser: importing `monaco-editor`
 * rejects. `bundledMonaco.ts` and `MonacoImpl` run unmocked; only `<Editor>` is
 * stubbed, so a test that wrongly mounted it would see the stub.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('monaco-editor', () => {
  throw new Error('Failed to fetch dynamically imported module: /assets/editor.main.js');
});

vi.mock('@monaco-editor/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@monaco-editor/react')>();
  const EditorStub = () => <div data-testid="monaco-editor-stub" />;
  return { ...actual, default: EditorStub, Editor: EditorStub };
});

import MonacoImpl from './MonacoImpl';

describe('MonacoImpl — the editor chunk fails to load', () => {
  it('renders an editable textarea holding the value, and reports the failure once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();

    render(<MonacoImpl value="const answer = 42;" language="javascript" onChange={onChange} />);

    const textarea = (await screen.findByLabelText('javascript source', {}, { timeout: 5000 })) as HTMLTextAreaElement;
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('const answer = 42;');
    expect(screen.queryByTestId('monaco-editor-stub')).toBeNull();

    fireEvent.change(textarea, { target: { value: 'const answer = 43;' } });
    expect(onChange).toHaveBeenLastCalledWith('const answer = 43;');

    const reports = warn.mock.calls.map((args) => args.map(String).join(' ')).filter((line) => /monaco/i.test(line));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('falls back to a plain textarea');
    warn.mockRestore();
  });

  it('keeps a read-only value read-only in the fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<MonacoImpl value="{}" language="json" readOnly />);
    const textarea = await screen.findByLabelText('json source', {}, { timeout: 5000 });
    expect(textarea).toHaveAttribute('readonly');
  });
});
