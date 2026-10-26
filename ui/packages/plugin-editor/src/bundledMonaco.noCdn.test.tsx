/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With the bundled Monaco handed to the loader, nothing is fetched from the
 * loader's default CDN: the REAL `@monaco-editor/loader` answers `init()` with
 * the bundled instance and appends no `<script>`, and `MonacoImpl` mounts the
 * editor only after that config landed.
 *
 * `monaco-editor` and its five `?worker` modules are replaced by markers (the
 * real core does not load in a DOM-less test runner); the loader and
 * `MonacoImpl` are real. `<Editor>` is stubbed and records whether the loader
 * already held the bundled instance when it mounted.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const bundled = vi.hoisted(() => ({ editor: {}, languages: {}, marker: 'bundled-monaco' }));
const editorSawConfig = vi.hoisted(() => ({ value: undefined as boolean | undefined }));
const isBundled = vi.hoisted(
  () => (instance: unknown) => (instance as { marker?: unknown } | null)?.marker === 'bundled-monaco',
);

vi.mock('monaco-editor', () => bundled);
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class EditorWorker {} }));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: class JsonWorker {} }));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({ default: class CssWorker {} }));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({ default: class HtmlWorker {} }));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({ default: class TsWorker {} }));

vi.mock('@monaco-editor/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@monaco-editor/react')>();
  const EditorStub = () => {
    // `__getMonacoInstance` is the loader's synchronous read of the instance it
    // holds: the bundled module's namespace, which carries the marker.
    editorSawConfig.value ??= isBundled(actual.loader.__getMonacoInstance());
    return <div data-testid="monaco-editor-stub" />;
  };
  return { ...actual, default: EditorStub, Editor: EditorStub };
});

import { loader } from '@monaco-editor/react';
import MonacoImpl from './MonacoImpl';

function cdnScripts(): string[] {
  return [...document.querySelectorAll('script')]
    .map((script) => script.src)
    .filter((src) => /jsdelivr|\/vs\/loader\.js/.test(src));
}

describe('bundled Monaco — no CDN', () => {
  it('mounts the editor only once the loader holds the bundled Monaco, and the loader appends no script', async () => {
    render(<MonacoImpl value="let x = 1;" language="typescript" />);

    await screen.findByTestId('monaco-editor-stub', {}, { timeout: 5000 });
    expect(editorSawConfig.value, 'the loader held the bundled Monaco when <Editor> mounted').toBe(true);

    expect(isBundled(await loader.init()), 'loader.init() answers with the bundled Monaco').toBe(true);
    expect(cdnScripts()).toEqual([]);
  });

  it('starts the worker Monaco names for each language from the bundled modules', async () => {
    const getWorker = self.MonacoEnvironment?.getWorker;
    expect(getWorker).toBeTypeOf('function');
    const nameOf = async (label: string) => ((await getWorker!('id', label)) as object).constructor.name;
    expect(await nameOf('json')).toBe('JsonWorker');
    expect(await nameOf('scss')).toBe('CssWorker');
    expect(await nameOf('html')).toBe('HtmlWorker');
    expect(await nameOf('javascript')).toBe('TsWorker');
    expect(await nameOf('typescript')).toBe('TsWorker');
    expect(await nameOf('editorWorkerService')).toBe('EditorWorker');
  });
});
