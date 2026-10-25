/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The lazy Monaco import must resolve to the EDITOR component (objectui#5440).
 *
 * `packages/app-shell/tsconfig.json` pins `moduleResolution: nodenext`, under
 * which `@monaco-editor/react`'s CommonJS default is the module namespace
 * rather than the component, so the lazy import reads the named `Editor`
 * export instead.
 *
 * The compiler covers more of that spelling than one might assume, and this
 * was measured rather than guessed: reverting the factory to the namespace
 * default is TS2345, and pointing it at the sibling `DiffEditor` is TS2353 on
 * the first option this call site passes that a diff editor does not take
 * (`tabSize`). So the wrong-component-but-typed case does NOT survive
 * `type-check` here, and this test is not what catches it.
 *
 * What nothing else covers is the editor resolving to NOTHING. Both Monaco
 * suites next door assert the textarea FALLBACK, and a lazy import that never
 * yields a component produces exactly that fallback — measured: remove
 * `Editor` from `JsonSourceEditor.fallback.test.tsx`'s stub, leaving the lazy
 * factory reading an export that is not there, and that suite still passes,
 * because the DOM-poll backstop flips to the textarea before the broken import
 * is ever rendered. Green there means "the fallback works", never "the editor
 * works". This is the test that renders the editor and asserts it painted.
 *
 * The stub mirrors the real module — `Editor` and `DiffEditor` distinguishable,
 * and `default` bound to the namespace-shaped object `nodenext` hands the code.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@monaco-editor/react', () => {
  const Editor = () => <div className="view-line" data-testid="monaco-editor" />;
  const DiffEditor = () => <div className="view-line" data-testid="monaco-diff-editor" />;
  return {
    Editor,
    DiffEditor,
    default: { Editor, DiffEditor },
    loader: { init: () => Promise.resolve({}) },
  };
});

import { JsonSourceEditor } from './JsonSourceEditor';

describe('JsonSourceEditor — lazy Monaco export shape', () => {
  it('renders the named `Editor` export, not `DiffEditor` and not the namespace default', async () => {
    // A long grace period so the textarea fallback cannot engage on a timer:
    // if it appears at all, it is because the editor never painted.
    render(
      <JsonSourceEditor
        value={{ name: 'work_order' }}
        onChange={() => {}}
        fallbackDelayMs={60_000}
      />,
    );

    expect(await screen.findByTestId('monaco-editor', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-diff-editor')).toBeNull();
    expect(screen.queryByLabelText('JSON source')).toBeNull();
  });
});
