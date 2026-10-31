/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524 (Target 5, 6) — `Esc` on an open face (the 动态 tab, a
 * related list's whole face) returns to the record's page, inside the record
 * pane too. Since the pane follows the width rule its record draws these
 * faces, and the pane has an `Esc` of its own: the drawer's dialog layer
 * dismisses (or, below the stack's root, goes back a level), and the split
 * pane beside a list closes on a document listener. The face takes the key
 * first; only an `Esc` pressed with no face open is the pane's.
 *
 * Driven through the real `NavigationOverlay` (its Radix sheet and its split
 * listener), with the page's blocks stubbed: what is measured is who answers
 * the key.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { NavigationOverlay, type NavigationOverlayProps } from '@object-ui/components';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => <div data-node={schema?.type} />,
}));

import { RecordPageColumns } from '../RecordPageColumns';
import { buildDefaultPageColumns, RECORD_PAGE_TIMELINE_PANEL } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';

const page = buildDefaultPageSchema(
  { name: 'lead', label: 'Lead', fields: { name: { name: 'name', type: 'text' } } },
  { related: [{ objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' }] },
);
const columns = buildDefaultPageColumns(page)!;

/** The record the pane draws, opened on its 动态 tab. */
function PaneRecord() {
  const [enlarged, setEnlarged] = React.useState<string | null>(RECORD_PAGE_TIMELINE_PANEL);
  return (
    <RecordPageColumns
      tier="stack"
      columns={columns}
      enlargedRelated={enlarged ?? undefined}
      onEnlargeRelated={setEnlarged}
      onCloseEnlargedRelated={() => setEnlarged(null)}
    />
  );
}

function pane(props: Partial<NavigationOverlayProps>) {
  return (
    <NavigationOverlay
      isOpen
      isOverlay
      selectedRecord={{ id: 'r1' }}
      mode="drawer"
      close={() => {}}
      setIsOpen={() => {}}
      title="Lead"
      width="720px"
      {...props}
    >
      {() => <PaneRecord />}
    </NavigationOverlay>
  );
}

const face = () => document.querySelector(`[data-related-enlarged="${RECORD_PAGE_TIMELINE_PANEL}"]`);
const pageColumns = () => document.querySelector('[data-record-columns]');
const escape = (target: Element) => fireEvent.keyDown(target, { key: 'Escape', code: 'Escape', bubbles: true });

afterEach(() => cleanup());

describe('Esc on an open face inside the record pane (objectstack#27524)', () => {
  it('the drawer: Esc on the 动态 tab returns to the record\'s page; the next Esc is the drawer\'s', () => {
    const setIsOpen = vi.fn();
    render(pane({ setIsOpen }));
    expect(document.querySelector('[role="dialog"]')?.contains(face())).toBe(true);

    escape(face()!);
    expect(face()).toBeNull();
    expect(pageColumns()).not.toBeNull();
    expect(setIsOpen).not.toHaveBeenCalled();

    // CONTROL: with no face open, Esc dismisses the drawer as it always did.
    escape(pageColumns()!);
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it('a level below the drawer\'s root: the face closes and the drawer stays on that level', () => {
    const onBack = vi.fn();
    const setIsOpen = vi.fn();
    render(pane({ onBack, setIsOpen }));
    escape(face()!);
    expect(face()).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    expect(setIsOpen).not.toHaveBeenCalled();
    escape(pageColumns()!);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the split pane beside a list: the face closes, the pane stays; the next Esc closes the pane', () => {
    const close = vi.fn();
    render(pane({ mode: 'split', mainContent: <div>list</div>, close }));
    expect(document.querySelector('[data-testid="record-split-pane"]')?.contains(face())).toBe(true);
    escape(face()!);
    expect(face()).toBeNull();
    expect(close).not.toHaveBeenCalled();
    escape(pageColumns()!);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('an open menu owns Esc: the face stays open under it', () => {
    render(pane({}));
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    escape(menu);
    expect(face()).not.toBeNull();
    menu.remove();
  });

  it('a text field in the face keeps its own Esc, and the drawer stays open around the face', () => {
    const setIsOpen = vi.fn();
    render(pane({ setIsOpen }));
    const input = document.createElement('input');
    face()!.appendChild(input);
    const fieldEsc = vi.fn();
    input.addEventListener('keydown', fieldEsc);
    escape(input);
    // The key reaches the field (a mention list, an inline edit's cancel), and
    // it is not the pane's: the face and the drawer stay.
    expect(fieldEsc).toHaveBeenCalledTimes(1);
    expect(face()).not.toBeNull();
    expect(setIsOpen).not.toHaveBeenCalled();
    escape(face()!);
    expect(face()).toBeNull();
    expect(setIsOpen).not.toHaveBeenCalled();
  });

  it('a text field in the face, in the split pane beside a list: the face and the pane stay', () => {
    const close = vi.fn();
    render(pane({ mode: 'split', mainContent: <div>list</div>, close }));
    const input = document.createElement('textarea');
    face()!.appendChild(input);
    escape(input);
    expect(face()).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
});
