/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13461 — two `@object-ui/components` renderers whose click target was
 * a mouse-only `div`.
 *
 *  - `tree-view`: the node row was a clickable `div` around the expand toggle's
 *    `button`. The toggle is now named (`common.expand` / `common.collapse`)
 *    and carries `aria-expanded`; the node itself is a `button` only when the
 *    host passes `onNodeClick`, and plain text otherwise.
 *  - `file-upload`: the dropzone opens the file picker from the keyboard
 *    (Enter / Space), and each file's remove button is named after its file
 *    (`fields.file.remove`).
 *
 * Names are read against the pack, never a literal, and the zh case first
 * proves the packs disagree.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
// Registers `tree-view` and `file-upload`.
import '../renderers/data-display/tree-view';
import '../renderers/form/file-upload';

afterEach(cleanup);

const NODES = [
  { id: 'docs', label: 'Docs', children: [{ id: 'readme', label: 'Readme' }] },
  { id: 'notes', label: 'Notes' },
];

function tree(schema: Record<string, unknown>) {
  const TreeView = ComponentRegistry.get('tree-view') as React.ComponentType<{ schema: unknown }>;
  return (
    <PredicateScopeProvider scope={{}}>
      <TreeView schema={{ type: 'tree-view', nodes: NODES, ...schema }} />
    </PredicateScopeProvider>
  );
}

describe('tree-view: the toggle and the node are separate, keyboard-reachable buttons (objectui#13461)', () => {
  it('names the toggle from the pack and reports its state', () => {
    render(tree({}));
    const toggle = screen.getByRole('button', { name: en.common.expand });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName(en.common.collapse);
    expect(screen.getByText('Readme')).toBeInTheDocument();
  });

  it('draws a node as a button only when the host passes onNodeClick', () => {
    const { unmount } = render(tree({}));
    // Without a handler the only buttons are the toggles: the labels are text.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull();
    unmount();

    const onNodeClick = vi.fn();
    render(tree({ onNodeClick }));
    const notes = screen.getByRole('button', { name: 'Notes' });
    expect(notes).toHaveAttribute('type', 'button');
    fireEvent.click(notes);
    expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'notes' }));
    // The toggle is not inside the node's button, and clicking it does not select.
    const toggle = screen.getByRole('button', { name: en.common.expand });
    expect(screen.getByRole('button', { name: 'Docs' }).contains(toggle)).toBe(false);
    onNodeClick.mockClear();
    fireEvent.click(toggle);
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('reads the toggle name from the zh pack under zh', () => {
    expect(zh.common.expand).not.toBe(en.common.expand);
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {tree({})}
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: zh.common.expand })).toBeInTheDocument();
  });
});

describe('file-upload: the dropzone is a keyboard control and remove buttons are named (objectui#13461)', () => {
  function upload() {
    const FileUpload = ComponentRegistry.get('file-upload') as React.ComponentType<{ schema: unknown; value?: File[] }>;
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    return render(
      <PredicateScopeProvider scope={{}}>
        <FileUpload schema={{ type: 'file-upload', id: 'up' }} value={[file]} />
      </PredicateScopeProvider>,
    );
  }

  it('opens the file picker on Enter and Space, and not on other keys', () => {
    const { container } = upload();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pick = vi.spyOn(input, 'click').mockImplementation(() => {});
    const zone = container.querySelector('[role="button"]') as HTMLElement;
    expect(zone).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(zone, { key: 'Enter' });
    fireEvent.keyDown(zone, { key: ' ' });
    fireEvent.keyDown(zone, { key: 'a' });
    expect(pick).toHaveBeenCalledTimes(2);
  });

  it("names each file's remove button after its file, from the pack", () => {
    upload();
    const name = en.fields.file.remove.replace('{{name}}', 'report.pdf');
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
});
